use crate::{db::Database, files, license};
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use argon2::Argon2;
use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const BACKUP_MAGIC: &[u8] = b"VDBK1\n";
const DATABASE_ENTRY: &str = "database/velodent.sqlite";

#[derive(Debug, Clone, Serialize)]
pub struct BackupResult {
    pub backup_path: String,
    pub sha256_hex: String,
    pub size_bytes: i64,
}

#[derive(Debug, Clone)]
pub struct DecryptedBackup {
    pub root: PathBuf,
    pub database_path: PathBuf,
    pub patients_path: PathBuf,
}

#[derive(Debug, Serialize, Deserialize)]
struct BackupHeader {
    version: u8,
    cipher: String,
    kdf: String,
    salt_b64: String,
    nonce_b64: String,
    created_at_epoch: u64,
    source_hwid: String,
    migration_count: i64,
    payload_sha256_hex: String,
}

pub fn create_encrypted_backup(
    database: &Database,
    admin_password: &str,
    destination_path: &Path,
) -> Result<BackupResult, String> {
    if !database
        .verify_admin_password(admin_password)
        .map_err(|error| error.to_string())?
    {
        return Err("password admin non valida".to_owned());
    }

    if destination_path.extension().and_then(|value| value.to_str()) != Some("vdbk") {
        return Err("il backup deve usare estensione .vdbk".to_owned());
    }
    if let Some(parent) = destination_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let temp_root = unique_temp_dir("velodent-backup-build")?;
    let temp_db = temp_root.join("velodent.sqlite");
    database
        .vacuum_into(&temp_db)
        .map_err(|error| error.to_string())?;

    let payload = build_archive_payload(&temp_db)?;
    let payload_sha256_hex = sha256_hex(&payload);
    let mut salt = [0_u8; 16];
    let mut nonce = [0_u8; 12];
    OsRng.fill_bytes(&mut salt);
    OsRng.fill_bytes(&mut nonce);
    let key = derive_key(admin_password, &salt)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|error| error.to_string())?;
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce), payload.as_slice())
        .map_err(|error| error.to_string())?;

    let status = database.license_status().map_err(|error| error.to_string())?;
    let header = BackupHeader {
        version: 1,
        cipher: "AES-256-GCM".to_owned(),
        kdf: "Argon2id".to_owned(),
        salt_b64: STANDARD_NO_PAD.encode(salt),
        nonce_b64: STANDARD_NO_PAD.encode(nonce),
        created_at_epoch: unix_seconds()?,
        source_hwid: license::hardware_id(),
        migration_count: status.migration_count,
        payload_sha256_hex,
    };
    let header_json = serde_json::to_vec(&header).map_err(|error| error.to_string())?;
    let header_len = u32::try_from(header_json.len())
        .map_err(|_| "backup header troppo grande".to_owned())?;

    let mut output = Vec::with_capacity(BACKUP_MAGIC.len() + 4 + header_json.len() + ciphertext.len());
    output.extend_from_slice(BACKUP_MAGIC);
    output.extend_from_slice(&header_len.to_le_bytes());
    output.extend_from_slice(&header_json);
    output.extend_from_slice(&ciphertext);
    fs::write(destination_path, &output).map_err(|error| error.to_string())?;
    let sha256_hex = sha256_hex(&output);
    let size_bytes = i64::try_from(output.len()).map_err(|error| error.to_string())?;
    let _ = fs::remove_dir_all(&temp_root);

    Ok(BackupResult {
        backup_path: destination_path.to_string_lossy().into_owned(),
        sha256_hex,
        size_bytes,
    })
}

pub fn decrypt_backup_to_temp(
    backup_path: &Path,
    admin_password: &str,
) -> Result<DecryptedBackup, String> {
    let bytes = fs::read(backup_path).map_err(|error| error.to_string())?;
    let (header, ciphertext) = parse_backup_file(&bytes)?;
    let salt = STANDARD_NO_PAD
        .decode(header.salt_b64.as_bytes())
        .map_err(|error| error.to_string())?;
    let nonce = STANDARD_NO_PAD
        .decode(header.nonce_b64.as_bytes())
        .map_err(|error| error.to_string())?;
    if nonce.len() != 12 {
        return Err("nonce backup non valido".to_owned());
    }
    let key = derive_key(admin_password, &salt)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|error| error.to_string())?;
    let payload = cipher
        .decrypt(Nonce::from_slice(&nonce), ciphertext)
        .map_err(|_| "password admin non valida o backup corrotto".to_owned())?;
    if sha256_hex(&payload) != header.payload_sha256_hex {
        return Err("integrita' payload backup non valida".to_owned());
    }

    let root = unique_temp_dir("velodent-backup-restore")?;
    extract_archive_payload(&payload, &root)?;
    let database_path = root.join(DATABASE_ENTRY);
    if !database_path.is_file() {
        return Err("backup senza database".to_owned());
    }
    Ok(DecryptedBackup {
        patients_path: root.join("patients"),
        root,
        database_path,
    })
}

pub fn replace_patients_folder_from_backup(source_patients: &Path) -> Result<(), String> {
    let destination = files::patients_root()?;
    if destination.exists() {
        fs::remove_dir_all(&destination).map_err(|error| error.to_string())?;
    }
    if source_patients.is_dir() {
        copy_dir_recursive(source_patients, &destination)?;
    } else {
        fs::create_dir_all(&destination).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn build_archive_payload(database_path: &Path) -> Result<Vec<u8>, String> {
    let mut output = Vec::new();
    append_archive_entry(&mut output, DATABASE_ENTRY, &fs::read(database_path).map_err(|error| error.to_string())?)?;
    let patients_root = files::patients_root()?;
    if patients_root.is_dir() {
        append_directory_entries(&mut output, &patients_root, "patients", &patients_root)?;
    }
    output.extend_from_slice(&0_u32.to_le_bytes());
    Ok(output)
}

fn append_directory_entries(
    output: &mut Vec<u8>,
    root: &Path,
    prefix: &str,
    current: &Path,
) -> Result<(), String> {
    for entry in fs::read_dir(current).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            append_directory_entries(output, root, prefix, &path)?;
            continue;
        }
        if !path.is_file() {
            continue;
        }
        let relative = path.strip_prefix(root).map_err(|error| error.to_string())?;
        let relative = relative_path_string(relative)?;
        let archive_path = format!("{prefix}/{relative}");
        append_archive_entry(output, &archive_path, &fs::read(&path).map_err(|error| error.to_string())?)?;
    }
    Ok(())
}

fn append_archive_entry(output: &mut Vec<u8>, relative_path: &str, bytes: &[u8]) -> Result<(), String> {
    validate_archive_path(relative_path)?;
    let path_bytes = relative_path.as_bytes();
    let path_len = u32::try_from(path_bytes.len()).map_err(|_| "path backup troppo lungo".to_owned())?;
    let data_len = u64::try_from(bytes.len()).map_err(|error| error.to_string())?;
    output.extend_from_slice(&path_len.to_le_bytes());
    output.extend_from_slice(&data_len.to_le_bytes());
    output.extend_from_slice(path_bytes);
    output.extend_from_slice(bytes);
    Ok(())
}

fn extract_archive_payload(payload: &[u8], root: &Path) -> Result<(), String> {
    let mut cursor = 0_usize;
    loop {
        if cursor + 4 > payload.len() {
            return Err("payload backup troncato".to_owned());
        }
        let path_len = u32::from_le_bytes(payload[cursor..cursor + 4].try_into().unwrap()) as usize;
        cursor += 4;
        if path_len == 0 {
            break;
        }
        if cursor + 8 > payload.len() {
            return Err("payload backup troncato".to_owned());
        }
        let data_len = u64::from_le_bytes(payload[cursor..cursor + 8].try_into().unwrap()) as usize;
        cursor += 8;
        if cursor + path_len > payload.len() {
            return Err("payload backup troncato".to_owned());
        }
        let relative_path = std::str::from_utf8(&payload[cursor..cursor + path_len])
            .map_err(|error| error.to_string())?;
        cursor += path_len;
        validate_archive_path(relative_path)?;
        if cursor + data_len > payload.len() {
            return Err("payload backup troncato".to_owned());
        }
        let destination = root.join(relative_path);
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::write(destination, &payload[cursor..cursor + data_len]).map_err(|error| error.to_string())?;
        cursor += data_len;
    }
    Ok(())
}

fn parse_backup_file(bytes: &[u8]) -> Result<(BackupHeader, &[u8]), String> {
    if !bytes.starts_with(BACKUP_MAGIC) {
        return Err("file .vdbk non valido".to_owned());
    }
    let offset = BACKUP_MAGIC.len();
    if bytes.len() < offset + 4 {
        return Err("file .vdbk troncato".to_owned());
    }
    let header_len = u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize;
    let header_start = offset + 4;
    let header_end = header_start + header_len;
    if bytes.len() < header_end {
        return Err("header .vdbk troncato".to_owned());
    }
    let header = serde_json::from_slice::<BackupHeader>(&bytes[header_start..header_end])
        .map_err(|error| error.to_string())?;
    if header.version != 1 || header.cipher != "AES-256-GCM" {
        return Err("versione backup non supportata".to_owned());
    }
    Ok((header, &bytes[header_end..]))
}

fn derive_key(password: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    if password.trim().is_empty() {
        return Err("password admin richiesta".to_owned());
    }
    let mut key = [0_u8; 32];
    Argon2::default()
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|error| error.to_string())?;
    Ok(key)
}

fn relative_path_string(path: &Path) -> Result<String, String> {
    let mut segments = Vec::new();
    for component in path.components() {
        let std::path::Component::Normal(value) = component else {
            return Err("path backup non valido".to_owned());
        };
        let value = value
            .to_str()
            .ok_or_else(|| "path backup non UTF-8".to_owned())?;
        segments.push(value.to_owned());
    }
    Ok(segments.join("/"))
}

fn validate_archive_path(relative_path: &str) -> Result<(), String> {
    if relative_path.is_empty()
        || relative_path.starts_with('/')
        || relative_path.starts_with('\\')
        || relative_path.contains("..")
        || relative_path.contains('\\')
        || !(relative_path == DATABASE_ENTRY || relative_path.starts_with("patients/"))
    {
        return Err("path interno backup non valido".to_owned());
    }
    Ok(())
}

fn copy_dir_recursive(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        if source_path.is_dir() {
            copy_dir_recursive(&source_path, &destination_path)?;
        } else if source_path.is_file() {
            if let Some(parent) = destination_path.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            fs::copy(&source_path, &destination_path).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn unique_temp_dir(prefix: &str) -> Result<PathBuf, String> {
    let path = std::env::temp_dir().join(format!("{prefix}-{}", unix_nanos()?));
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    Ok(path)
}

fn unix_seconds() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())
        .map(|duration| duration.as_secs())
}

fn unix_nanos() -> Result<u128, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())
        .map(|duration| duration.as_nanos())
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    hex::encode(digest)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn archive_payload_rejects_path_traversal() {
        assert!(validate_archive_path("patients/1/rx/file.png").is_ok());
        assert!(validate_archive_path("patients/../secret").is_err());
        assert!(validate_archive_path("../database/velodent.sqlite").is_err());
    }
}
