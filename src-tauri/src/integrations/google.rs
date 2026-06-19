use serde::Serialize;
use std::env;

const DEFAULT_REDIRECT_URI: &str = "http://127.0.0.1:1420/google/oauth/callback";
const GOOGLE_AUTH_URI: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URI: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_SCOPES: [&str; 2] = [
    "openid email profile",
    "https://www.googleapis.com/auth/calendar.events",
];

#[derive(Debug)]
pub struct GoogleOAuthConfig {
    client_id: String,
    client_secret: String,
    redirect_uri: String,
}

#[derive(Debug, Serialize)]
pub struct GoogleOAuthStatus {
    pub configured: bool,
    pub client_id_present: bool,
    pub client_secret_present: bool,
    pub redirect_uri: String,
    pub auth_endpoint: String,
    pub token_endpoint: String,
    pub scopes: Vec<String>,
}

#[derive(Debug)]
pub enum GoogleConfigError {
    MissingClientId,
    MissingClientSecret,
}

impl std::fmt::Display for GoogleConfigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MissingClientId => write!(f, "GOOGLE_CLIENT_ID is not configured"),
            Self::MissingClientSecret => write!(f, "GOOGLE_CLIENT_SECRET is not configured"),
        }
    }
}

impl std::error::Error for GoogleConfigError {}

pub fn load_dotenv() {
    let _ = dotenvy::dotenv();
}

pub fn load_oauth_config() -> Result<GoogleOAuthConfig, GoogleConfigError> {
    load_dotenv();

    let client_id = env::var("GOOGLE_CLIENT_ID")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or(GoogleConfigError::MissingClientId)?;
    let client_secret = env::var("GOOGLE_CLIENT_SECRET")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or(GoogleConfigError::MissingClientSecret)?;
    let redirect_uri = env::var("GOOGLE_REDIRECT_URI")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_REDIRECT_URI.to_owned());

    Ok(GoogleOAuthConfig {
        client_id,
        client_secret,
        redirect_uri,
    })
}

pub fn oauth_status() -> GoogleOAuthStatus {
    load_dotenv();

    let loaded_config = load_oauth_config().ok();
    let client_id_present = env::var("GOOGLE_CLIENT_ID")
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    let client_secret_present = env::var("GOOGLE_CLIENT_SECRET")
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    let redirect_uri = env::var("GOOGLE_REDIRECT_URI")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_REDIRECT_URI.to_owned());
    let redirect_uri = loaded_config
        .as_ref()
        .map(|config| config.redirect_uri().to_owned())
        .unwrap_or(redirect_uri);
    let client_id_present = loaded_config
        .as_ref()
        .map(GoogleOAuthConfig::client_id_is_present)
        .unwrap_or(client_id_present);
    let client_secret_present = loaded_config
        .as_ref()
        .map(GoogleOAuthConfig::client_secret_is_present)
        .unwrap_or(client_secret_present);

    GoogleOAuthStatus {
        configured: client_id_present && client_secret_present,
        client_id_present,
        client_secret_present,
        redirect_uri,
        auth_endpoint: GOOGLE_AUTH_URI.to_owned(),
        token_endpoint: GOOGLE_TOKEN_URI.to_owned(),
        scopes: GOOGLE_SCOPES
            .iter()
            .map(|scope| (*scope).to_owned())
            .collect(),
    }
}

impl GoogleOAuthConfig {
    pub fn redirect_uri(&self) -> &str {
        &self.redirect_uri
    }

    pub fn client_id_is_present(&self) -> bool {
        !self.client_id.trim().is_empty()
    }

    pub fn client_secret_is_present(&self) -> bool {
        !self.client_secret.trim().is_empty()
    }
}
