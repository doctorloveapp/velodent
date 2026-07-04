use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::OnceLock;

const LICENSE_PUBLIC_KEY_B64: &str = "QJr2NdjByJ72nc8H4LPp0hH46Q-NvOz8Lpl2Z8Uwf88";
const LICENSE_KEY_PREFIX: &str = "VDLK1";
const LICENSE_PRODUCT: &str = "velodent-enterprise";
const REQUEST_CODE_PREFIX: &str = "VDRQ1";
const REQUEST_CODE_MASK: &[u8] = b"velodent-database-dna-request-v1";

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct LicensePayload {
    pub version: u8,
    pub product: String,
    pub hwid: String,
    pub email: String,
    pub database_identity_id: Option<String>,
    pub issued_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct RequestCodePayload {
    v: u8,
    h: String,
    d: String,
    m: i64,
}

#[derive(Debug)]
pub enum LicenseError {
    InvalidFormat,
    InvalidPublicKey,
    InvalidSignature,
    InvalidPayload,
    HardwareMismatch,
    HardwareIdUnavailable(String),
    ProductMismatch,
}

impl std::fmt::Display for LicenseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidFormat => write!(f, "activation key format is invalid"),
            Self::InvalidPublicKey => write!(f, "license public key is invalid"),
            Self::InvalidSignature => write!(f, "activation key signature is invalid"),
            Self::InvalidPayload => write!(f, "activation key payload is invalid"),
            Self::HardwareMismatch => write!(f, "activation key is not valid for this PC"),
            Self::HardwareIdUnavailable(message) => write!(f, "hardware id unavailable: {message}"),
            Self::ProductMismatch => write!(f, "activation key is not valid for this product"),
        }
    }
}

impl std::error::Error for LicenseError {}

pub fn hardware_id() -> Result<String, LicenseError> {
    static HARDWARE_ID: OnceLock<Result<String, String>> = OnceLock::new();
    HARDWARE_ID
        .get_or_init(|| {
            let material = hardware_material()?;
            let digest = Sha256::digest(material.as_bytes());
            let hex = hex::encode_upper(&digest);
            Ok(format!("VD-{}-{}-{}", &hex[0..4], &hex[4..8], &hex[8..12]))
        })
        .clone()
        .map_err(LicenseError::HardwareIdUnavailable)
}

#[cfg(windows)]
fn hardware_material() -> Result<String, String> {
    use winreg::{enums::HKEY_LOCAL_MACHINE, RegKey};

    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let cryptography = hklm
        .open_subkey("SOFTWARE\\Microsoft\\Cryptography")
        .map_err(|error| format!("impossibile aprire HKLM\\SOFTWARE\\Microsoft\\Cryptography: {error}"))?;
    let machine_guid: String = cryptography
        .get_value("MachineGuid")
        .map_err(|error| format!("impossibile leggere MachineGuid dal registro Windows: {error}"))?;
    let machine_guid = machine_guid.trim();
    if machine_guid.is_empty() {
        return Err("MachineGuid Windows vuoto".to_owned());
    }

    Ok(format!("windows-machine-guid:{machine_guid}"))
}

#[cfg(not(windows))]
fn hardware_material() -> Result<String, String> {
    let hostname = std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("COMPUTERNAME"))
        .map_err(|_| "nome macchina non disponibile".to_owned())?;
    let hostname = hostname.trim();
    if hostname.is_empty() {
        return Err("nome macchina vuoto".to_owned());
    }
    Ok(format!("host:{hostname}"))
}

pub fn request_code(hardware_id: &str, database_identity_id: &str, migration_count: i64) -> String {
    let payload = RequestCodePayload {
        v: 1,
        h: hardware_id.trim().to_owned(),
        d: database_identity_id.trim().to_owned(),
        m: migration_count.max(0),
    };
    let payload_json = serde_json::to_vec(&payload).unwrap_or_default();
    let masked_payload = xor_bytes(&payload_json, REQUEST_CODE_MASK);
    let body = URL_SAFE_NO_PAD.encode(masked_payload);
    let checksum_material = format!("{REQUEST_CODE_PREFIX}.{body}.velodent");
    let checksum = Sha256::digest(checksum_material.as_bytes());
    let checksum_b64 = URL_SAFE_NO_PAD.encode(&checksum[..6]);
    format!("{REQUEST_CODE_PREFIX}.{body}.{checksum_b64}")
}

pub fn verify_activation_key(
    activation_key: &str,
    expected_hwid: &str,
) -> Result<LicensePayload, LicenseError> {
    let mut parts = activation_key.trim().split('.');
    let prefix = parts.next().ok_or(LicenseError::InvalidFormat)?;
    let payload_b64 = parts.next().ok_or(LicenseError::InvalidFormat)?;
    let signature_b64 = parts.next().ok_or(LicenseError::InvalidFormat)?;
    if parts.next().is_some() || prefix != LICENSE_KEY_PREFIX {
        return Err(LicenseError::InvalidFormat);
    }

    let public_key_bytes = URL_SAFE_NO_PAD
        .decode(LICENSE_PUBLIC_KEY_B64)
        .map_err(|_| LicenseError::InvalidPublicKey)?;
    let public_key_array: [u8; 32] = public_key_bytes
        .try_into()
        .map_err(|_| LicenseError::InvalidPublicKey)?;
    let verifying_key =
        VerifyingKey::from_bytes(&public_key_array).map_err(|_| LicenseError::InvalidPublicKey)?;

    let signature_bytes = URL_SAFE_NO_PAD
        .decode(signature_b64)
        .map_err(|_| LicenseError::InvalidFormat)?;
    let signature =
        Signature::from_slice(&signature_bytes).map_err(|_| LicenseError::InvalidFormat)?;
    verifying_key
        .verify(payload_b64.as_bytes(), &signature)
        .map_err(|_| LicenseError::InvalidSignature)?;

    let payload_bytes = URL_SAFE_NO_PAD
        .decode(payload_b64)
        .map_err(|_| LicenseError::InvalidPayload)?;
    let payload = serde_json::from_slice::<LicensePayload>(&payload_bytes)
        .map_err(|_| LicenseError::InvalidPayload)?;

    if payload.product != LICENSE_PRODUCT || payload.version != 1 {
        return Err(LicenseError::ProductMismatch);
    }
    if payload.hwid != expected_hwid {
        return Err(LicenseError::HardwareMismatch);
    }
    if payload.email.trim().is_empty() {
        return Err(LicenseError::InvalidPayload);
    }
    if let Some(database_identity_id) = payload.database_identity_id.as_deref() {
        if database_identity_id.trim().is_empty() {
            return Err(LicenseError::InvalidPayload);
        }
    }

    Ok(payload)
}

fn xor_bytes(input: &[u8], mask: &[u8]) -> Vec<u8> {
    input
        .iter()
        .enumerate()
        .map(|(index, byte)| byte ^ mask[index % mask.len()])
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hardware_id_is_readable() {
        let hwid = hardware_id().expect("hardware id");
        assert!(hwid.starts_with("VD-"));
        assert_eq!(hwid.len(), 17);
    }

    #[test]
    fn request_code_obfuscates_hardware_database_and_migration_count() {
        let code = request_code("VD-ABCD-EF12-3456", "VDDB-ABCDEF123456", 2);
        assert!(code.starts_with("VDRQ1."));
        assert!(!code.contains("VD-ABCD-EF12-3456"));
        assert!(!code.contains("VDDB-ABCDEF123456"));
        assert!(!code.ends_with(".2"));
    }
}
