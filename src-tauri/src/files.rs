use sha2::{Digest, Sha256};
use std::{
    env, fs,
    io::Read,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Debug, Clone)]
pub struct StoredClinicalFile {
    pub relative_path: String,
    pub mime_type: String,
    pub sha256_hex: String,
    pub size_bytes: i64,
    pub original_filename: String,
}

pub fn patients_root() -> Result<PathBuf, String> {
    let appdata = env::var("APPDATA")
        .map(PathBuf::from)
        .map_err(|_| "%APPDATA% is not available".to_owned())?;
    let root = appdata.join("VeloDent").join("patients");
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    Ok(root)
}

pub fn store_patient_rx_file(
    patient_id: i64,
    source_path: &str,
) -> Result<StoredClinicalFile, String> {
    if patient_id <= 0 {
        return Err("invalid patient id".to_owned());
    }

    let source = Path::new(source_path.trim());
    if !source.is_file() {
        return Err("source clinical file not found".to_owned());
    }

    let extension = normalized_extension(source)?;
    let mime_type = mime_type_for_extension(&extension).to_owned();
    let original_filename = source
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("rx")
        .to_owned();
    let safe_stem = sanitize_filename_component(
        source
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("rx"),
    );
    let unique_name = format!("{}-{}.{}", unix_nanos()?, safe_stem, extension);
    let patient_segment = patient_id.to_string();
    let relative_path = format!("patients/{patient_segment}/rx/{unique_name}");
    let destination = patients_root()?
        .join(&patient_segment)
        .join("rx")
        .join(&unique_name);

    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    fs::copy(source, &destination).map_err(|error| error.to_string())?;
    let (sha256_hex, size_bytes) = hash_and_size(&destination)?;

    Ok(StoredClinicalFile {
        relative_path,
        mime_type,
        sha256_hex,
        size_bytes,
        original_filename,
    })
}

pub fn store_patient_document_bytes(
    patient_id: i64,
    file_kind: &str,
    filename_stem: &str,
    bytes: &[u8],
) -> Result<StoredClinicalFile, String> {
    if patient_id <= 0 {
        return Err("invalid patient id".to_owned());
    }
    if bytes.is_empty() {
        return Err("generated document is empty".to_owned());
    }
    if !matches!(file_kind, "quote" | "invoice" | "consent" | "other") {
        return Err("unsupported generated document kind".to_owned());
    }

    let safe_stem = sanitize_filename_component(filename_stem);
    let unique_name = format!("{}-{}.pdf", unix_nanos()?, safe_stem);
    let patient_segment = patient_id.to_string();
    let relative_path = format!("patients/{patient_segment}/documents/{unique_name}");
    let destination = patients_root()?
        .join(&patient_segment)
        .join("documents")
        .join(&unique_name);

    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    fs::write(&destination, bytes).map_err(|error| error.to_string())?;
    let (sha256_hex, size_bytes) = hash_and_size(&destination)?;

    Ok(StoredClinicalFile {
        relative_path,
        mime_type: "application/pdf".to_owned(),
        sha256_hex,
        size_bytes,
        original_filename: unique_name,
    })
}

pub fn read_patient_file(relative_path: &str) -> Result<Vec<u8>, String> {
    let relative = relative_path.replace('\\', "/");
    if relative.contains("..") || relative.starts_with('/') || relative.starts_with('\\') {
        return Err("invalid clinical file path".to_owned());
    }

    let path = patients_root()?
        .parent()
        .ok_or_else(|| "invalid VeloDent data directory".to_owned())?
        .join(relative);
    fs::read(path).map_err(|error| error.to_string())
}

pub fn delete_patient_file(relative_path: &str) -> Result<(), String> {
    let path = absolute_patient_file_path(relative_path)?;
    if path.is_file() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn export_patient_file_to_downloads_and_open(
    relative_path: &str,
    filename: &str,
) -> Result<PathBuf, String> {
    let source = absolute_patient_file_path(relative_path)?;
    let userprofile = env::var("USERPROFILE")
        .map(PathBuf::from)
        .map_err(|_| "%USERPROFILE% is not available".to_owned())?;
    let downloads = userprofile.join("Downloads");
    fs::create_dir_all(&downloads).map_err(|error| error.to_string())?;
    let destination = downloads.join(sanitize_download_filename(filename));
    fs::copy(&source, &destination).map_err(|error| error.to_string())?;
    opener::open(&destination).map_err(|error| error.to_string())?;
    Ok(destination)
}

pub fn export_document_bytes_to_downloads_and_open(
    bytes: &[u8],
    filename: &str,
) -> Result<PathBuf, String> {
    if bytes.is_empty() {
        return Err("document is empty".to_owned());
    }
    let userprofile = env::var("USERPROFILE")
        .map(PathBuf::from)
        .map_err(|_| "%USERPROFILE% is not available".to_owned())?;
    let downloads = userprofile.join("Downloads");
    fs::create_dir_all(&downloads).map_err(|error| error.to_string())?;
    let destination = downloads.join(sanitize_download_filename(filename));
    fs::write(&destination, bytes).map_err(|error| error.to_string())?;
    opener::open(&destination).map_err(|error| error.to_string())?;
    Ok(destination)
}

fn absolute_patient_file_path(relative_path: &str) -> Result<PathBuf, String> {
    let relative = relative_path.replace('\\', "/");
    if relative.contains("..") || relative.starts_with('/') || relative.starts_with('\\') {
        return Err("invalid clinical file path".to_owned());
    }

    Ok(patients_root()?
        .parent()
        .ok_or_else(|| "invalid VeloDent data directory".to_owned())?
        .join(relative))
}

fn sanitize_download_filename(filename: &str) -> String {
    let path = Path::new(filename);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("velodent-document");
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| {
            value
                .chars()
                .all(|character| character.is_ascii_alphanumeric())
        })
        .unwrap_or_else(|| "pdf".to_owned());
    format!(
        "{}.{}",
        sanitize_filename_component(stem).replace('_', "-"),
        extension
    )
}

pub fn sanitize_filename_component(value: &str) -> String {
    let mut sanitized = String::new();
    let mut previous_separator = false;

    for character in value.trim().chars() {
        let next = if character.is_ascii_alphanumeric() {
            previous_separator = false;
            Some(character.to_ascii_lowercase())
        } else if matches!(character, ' ' | '-' | '_' | '.') {
            if previous_separator {
                None
            } else {
                previous_separator = true;
                Some('_')
            }
        } else {
            None
        };

        if let Some(character) = next {
            sanitized.push(character);
        }
    }

    let sanitized = sanitized.trim_matches('_').to_owned();
    if sanitized.is_empty() {
        "rx".to_owned()
    } else {
        sanitized
    }
}

fn normalized_extension(source: &Path) -> Result<String, String> {
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.trim().to_ascii_lowercase())
        .ok_or_else(|| "clinical file extension is required".to_owned())?;

    match extension.as_str() {
        "jpg" | "jpeg" | "png" | "dcm" | "dicom" => Ok(extension),
        _ => Err("unsupported clinical file type".to_owned()),
    }
}

fn mime_type_for_extension(extension: &str) -> &'static str {
    match extension {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "dcm" | "dicom" => "application/dicom",
        _ => "application/octet-stream",
    }
}

fn hash_and_size(path: &Path) -> Result<(String, i64), String> {
    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut size_bytes = 0_i64;
    let mut buffer = [0_u8; 8192];

    loop {
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        size_bytes += read as i64;
        hasher.update(&buffer[..read]);
    }

    Ok((hex::encode(hasher.finalize()), size_bytes))
}

fn unix_nanos() -> Result<u128, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::{sanitize_download_filename, sanitize_filename_component, store_patient_rx_file};
    use std::{
        env, fs,
        sync::Mutex,
        time::{SystemTime, UNIX_EPOCH},
    };

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn sanitizes_rx_filenames_with_spaces_and_special_characters() {
        assert_eq!(
            sanitize_filename_component("RX paziente 16 # prova finale"),
            "rx_paziente_16_prova_finale"
        );
        assert_eq!(sanitize_filename_component("  À??  "), "rx");
    }

    #[test]
    fn preserves_pdf_extension_for_download_exports() {
        assert_eq!(
            sanitize_download_filename("Preventivo Paziente 1.PDF"),
            "preventivo-paziente-1.pdf"
        );
        assert_eq!(sanitize_download_filename("??"), "rx.pdf");
    }

    #[test]
    fn imports_rx_file_with_spaces_and_special_characters() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        let previous_appdata = env::var("APPDATA").ok();
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let root = env::temp_dir().join(format!("velodent-rx-import-test-{suffix}"));
        let appdata = root.join("appdata");
        let source_dir = root.join("source folder");
        fs::create_dir_all(&source_dir).expect("source dir");
        let source = source_dir.join("RX paziente 16 # prova finale.PNG");
        fs::write(&source, [137_u8, 80, 78, 71]).expect("source file");
        env::set_var("APPDATA", &appdata);

        let stored =
            store_patient_rx_file(42, source.to_string_lossy().as_ref()).expect("store rx file");

        assert!(stored.relative_path.starts_with("patients/42/rx/"));
        assert!(stored
            .relative_path
            .ends_with("-rx_paziente_16_prova_finale.png"));
        assert_eq!(stored.mime_type, "image/png");
        assert_eq!(stored.size_bytes, 4);

        if let Some(previous_appdata) = previous_appdata {
            env::set_var("APPDATA", previous_appdata);
        } else {
            env::remove_var("APPDATA");
        }
    }
}
