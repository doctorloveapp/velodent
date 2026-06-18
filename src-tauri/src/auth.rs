use argon2::{
    password_hash::{
        rand_core::{OsRng, RngCore},
        PasswordHash, PasswordHasher, PasswordVerifier, SaltString,
    },
    Argon2,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    Admin,
    Odontoiatra,
    Aso,
}

impl Role {
    pub fn as_db_value(self) -> &'static str {
        match self {
            Self::Admin => "admin",
            Self::Odontoiatra => "odontoiatra",
            Self::Aso => "aso",
        }
    }

    pub fn from_db_value(value: &str) -> Option<Self> {
        match value {
            "admin" => Some(Self::Admin),
            "odontoiatra" => Some(Self::Odontoiatra),
            "aso" => Some(Self::Aso),
            _ => None,
        }
    }

    pub fn is_admin(self) -> bool {
        matches!(self, Self::Admin)
    }
}

pub fn hash_password(password: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|error| error.to_string())
}

pub fn verify_password(password: &str, password_hash: &str) -> bool {
    PasswordHash::new(password_hash)
        .ok()
        .and_then(|parsed_hash| {
            Argon2::default()
                .verify_password(password.as_bytes(), &parsed_hash)
                .ok()
        })
        .is_some()
}

pub struct GeneratedDeviceToken {
    pub plaintext: String,
    pub hash: String,
}

pub fn generate_device_token() -> GeneratedDeviceToken {
    let mut token_bytes = [0_u8; 32];
    OsRng.fill_bytes(&mut token_bytes);
    let plaintext = URL_SAFE_NO_PAD.encode(token_bytes);
    let hash = hash_device_token(&plaintext);

    GeneratedDeviceToken { plaintext, hash }
}

pub fn hash_device_token(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    hex::encode(digest)
}
