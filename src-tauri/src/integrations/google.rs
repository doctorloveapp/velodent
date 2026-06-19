use serde::{Deserialize, Serialize};
use std::{
    env,
    time::{SystemTime, UNIX_EPOCH},
};

const DEFAULT_REDIRECT_URI: &str = "http://127.0.0.1:1420/google/oauth/callback";
const GOOGLE_AUTH_URI: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URI: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URI: &str = "https://www.googleapis.com/oauth2/v3/userinfo";
const GOOGLE_CALENDAR_EVENTS_URI: &str = "https://www.googleapis.com/calendar/v3/calendars";
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

#[derive(Debug, Serialize)]
pub struct GoogleAuthorizationUrl {
    pub authorization_url: String,
    pub redirect_uri: String,
    pub scopes: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct GoogleCalendarToken {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub token_type: String,
    pub scope: Option<String>,
    pub expires_at_epoch_seconds: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GoogleCalendarEventDateTime {
    #[serde(rename = "dateTime")]
    pub date_time: String,
    #[serde(rename = "timeZone")]
    pub time_zone: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct GoogleCalendarEventPayload {
    pub summary: String,
    pub description: String,
    pub start: GoogleCalendarEventDateTime,
    pub end: GoogleCalendarEventDateTime,
}

#[derive(Debug, Deserialize)]
struct GoogleTokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    token_type: Option<String>,
    scope: Option<String>,
    expires_in: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct GoogleEventResponse {
    id: String,
}

#[derive(Debug, Deserialize)]
pub struct GoogleUserInfo {
    pub email: String,
    pub email_verified: Option<bool>,
}

#[derive(Debug)]
pub enum GoogleConfigError {
    MissingClientId,
    MissingClientSecret,
}

#[derive(Debug)]
pub enum GoogleApiError {
    Config(GoogleConfigError),
    Request(String),
    HttpStatus(u16, String),
    MissingEventId,
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

impl std::fmt::Display for GoogleApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Config(error) => write!(f, "{error}"),
            Self::Request(message) => write!(f, "google calendar request failed: {message}"),
            Self::HttpStatus(status, message) => {
                write!(f, "google calendar returned HTTP {status}: {message}")
            }
            Self::MissingEventId => write!(f, "google calendar response did not include event id"),
        }
    }
}

impl std::error::Error for GoogleApiError {}

impl From<GoogleConfigError> for GoogleApiError {
    fn from(value: GoogleConfigError) -> Self {
        Self::Config(value)
    }
}

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

pub fn authorization_url(state: &str) -> Result<GoogleAuthorizationUrl, GoogleConfigError> {
    let config = load_oauth_config()?;
    let scopes = scopes();
    let scope_value = scopes.join(" ");
    let state = if state.trim().is_empty() {
        "velodent-local"
    } else {
        state.trim()
    };
    let authorization_url = format!(
        "{GOOGLE_AUTH_URI}?client_id={}&redirect_uri={}&response_type=code&scope={}&access_type=offline&prompt=consent&state={}",
        encode_url_component(&config.client_id),
        encode_url_component(&config.redirect_uri),
        encode_url_component(&scope_value),
        encode_url_component(state),
    );

    Ok(GoogleAuthorizationUrl {
        authorization_url,
        redirect_uri: config.redirect_uri,
        scopes,
    })
}

pub async fn exchange_authorization_code(
    code: &str,
) -> Result<GoogleCalendarToken, GoogleApiError> {
    let config = load_oauth_config()?;
    let client = reqwest::Client::new();
    let body = format!(
        "code={}&client_id={}&client_secret={}&redirect_uri={}&grant_type=authorization_code",
        encode_url_component(code.trim()),
        encode_url_component(&config.client_id),
        encode_url_component(&config.client_secret),
        encode_url_component(&config.redirect_uri),
    );
    let response = client
        .post(GOOGLE_TOKEN_URI)
        .header("content-type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|error| GoogleApiError::Request(error.to_string()))?;

    let status = response.status();
    if !status.is_success() {
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "redacted google error".to_owned());
        return Err(GoogleApiError::HttpStatus(
            status.as_u16(),
            sanitize_google_error(&body),
        ));
    }

    let token = response
        .json::<GoogleTokenResponse>()
        .await
        .map_err(|error| GoogleApiError::Request(error.to_string()))?;
    let expires_at_epoch_seconds = token
        .expires_in
        .and_then(|seconds| current_epoch_seconds().map(|now| now + seconds));

    Ok(GoogleCalendarToken {
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        token_type: token.token_type.unwrap_or_else(|| "Bearer".to_owned()),
        scope: token.scope,
        expires_at_epoch_seconds,
    })
}

pub async fn user_info(access_token: &str) -> Result<GoogleUserInfo, GoogleApiError> {
    let response = reqwest::Client::new()
        .get(GOOGLE_USERINFO_URI)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|error| GoogleApiError::Request(error.to_string()))?;

    let status = response.status();
    if !status.is_success() {
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "redacted google error".to_owned());
        return Err(GoogleApiError::HttpStatus(
            status.as_u16(),
            sanitize_google_error(&body),
        ));
    }

    response
        .json::<GoogleUserInfo>()
        .await
        .map_err(|error| GoogleApiError::Request(error.to_string()))
}

pub async fn upsert_calendar_event(
    access_token: &str,
    calendar_id: &str,
    existing_event_id: Option<&str>,
    payload: &GoogleCalendarEventPayload,
) -> Result<String, GoogleApiError> {
    let calendar_id = if calendar_id.trim().is_empty() {
        "primary"
    } else {
        calendar_id.trim()
    };
    let client = reqwest::Client::new();
    let url = if let Some(event_id) = existing_event_id.filter(|value| !value.trim().is_empty()) {
        format!(
            "{GOOGLE_CALENDAR_EVENTS_URI}/{}/events/{}",
            encode_url_component(calendar_id),
            encode_url_component(event_id.trim()),
        )
    } else {
        format!(
            "{GOOGLE_CALENDAR_EVENTS_URI}/{}/events",
            encode_url_component(calendar_id),
        )
    };

    let request = if existing_event_id
        .filter(|value| !value.trim().is_empty())
        .is_some()
    {
        client.patch(url)
    } else {
        client.post(url)
    };

    let response = request
        .bearer_auth(access_token)
        .json(payload)
        .send()
        .await
        .map_err(|error| GoogleApiError::Request(error.to_string()))?;
    let status = response.status();

    if !status.is_success() {
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "redacted google error".to_owned());
        return Err(GoogleApiError::HttpStatus(
            status.as_u16(),
            sanitize_google_error(&body),
        ));
    }

    let event = response
        .json::<GoogleEventResponse>()
        .await
        .map_err(|error| GoogleApiError::Request(error.to_string()))?;

    if event.id.trim().is_empty() {
        Err(GoogleApiError::MissingEventId)
    } else {
        Ok(event.id)
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

pub fn scopes() -> Vec<String> {
    GOOGLE_SCOPES
        .iter()
        .flat_map(|scope| scope.split_whitespace())
        .map(str::to_owned)
        .collect()
}

fn current_epoch_seconds() -> Option<u64> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs())
}

fn encode_url_component(value: &str) -> String {
    value
        .bytes()
        .flat_map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                vec![byte as char]
            }
            _ => format!("%{byte:02X}").chars().collect(),
        })
        .collect()
}

fn sanitize_google_error(message: &str) -> String {
    message
        .chars()
        .filter(|character| !character.is_control())
        .take(240)
        .collect()
}
