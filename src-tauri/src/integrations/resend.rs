use serde::{Deserialize, Serialize};
use std::env;

const RESEND_EMAILS_URI: &str = "https://api.resend.com/emails";
const VELODENT_REPLY_TO: &str = "velodent@hotmail.com";

#[derive(Debug, Clone)]
pub struct ResendConfig {
    api_key: String,
    from_email: String,
}

#[derive(Debug, Serialize)]
struct ResendEmailPayload<'a> {
    from: &'a str,
    to: &'a str,
    subject: &'a str,
    html: &'a str,
    reply_to: &'a str,
}

#[derive(Debug, Deserialize)]
struct ResendEmailResponse {
    id: String,
}

#[derive(Debug)]
pub enum ResendError {
    MissingApiKey,
    MissingFromEmail,
    MissingRecipient,
    Request(String),
    HttpStatus(u16, String),
    MissingMessageId,
}

impl std::fmt::Display for ResendError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MissingApiKey => write!(f, "RESEND_API_KEY is not configured"),
            Self::MissingFromEmail => write!(f, "RESEND_FROM_EMAIL is not configured"),
            Self::MissingRecipient => write!(f, "email recipient is missing"),
            Self::Request(message) => write!(f, "resend api request failed: {message}"),
            Self::HttpStatus(status, message) => {
                write!(f, "resend api returned HTTP {status}: {message}")
            }
            Self::MissingMessageId => write!(f, "resend api response did not include message id"),
        }
    }
}

impl std::error::Error for ResendError {}

pub async fn send_transactional_email(
    recipient: &str,
    subject: &str,
    html: &str,
    idempotency_key: Option<&str>,
) -> Result<String, ResendError> {
    let config = load_config()?;
    let recipient = recipient.trim();
    if recipient.is_empty() {
        return Err(ResendError::MissingRecipient);
    }

    let payload = build_payload(&config, recipient, subject, html);
    let client = reqwest::Client::new();
    let mut request = client
        .post(RESEND_EMAILS_URI)
        .bearer_auth(config.api_key.as_str())
        .json(&payload);
    if let Some(key) = idempotency_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        request = request.header("Idempotency-Key", key);
    }
    let response = request
        .send()
        .await
        .map_err(|error| ResendError::Request(error.to_string()))?;
    let status = response.status();
    if !status.is_success() {
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "redacted resend error".to_owned());
        return Err(ResendError::HttpStatus(
            status.as_u16(),
            sanitize_resend_error(&body),
        ));
    }

    let response = response
        .json::<ResendEmailResponse>()
        .await
        .map_err(|error| ResendError::Request(error.to_string()))?;
    if response.id.trim().is_empty() {
        Err(ResendError::MissingMessageId)
    } else {
        Ok(response.id)
    }
}

fn load_config() -> Result<ResendConfig, ResendError> {
    let _ = dotenvy::dotenv();
    let api_key = env::var("RESEND_API_KEY")
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .ok_or(ResendError::MissingApiKey)?;
    let from_email = env::var("RESEND_FROM_EMAIL")
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .ok_or(ResendError::MissingFromEmail)?;
    Ok(ResendConfig {
        api_key,
        from_email,
    })
}

fn build_payload<'a>(
    config: &'a ResendConfig,
    recipient: &'a str,
    subject: &'a str,
    html: &'a str,
) -> ResendEmailPayload<'a> {
    ResendEmailPayload {
        from: config.from_email.as_str(),
        to: recipient,
        subject,
        html,
        reply_to: VELODENT_REPLY_TO,
    }
}

fn sanitize_resend_error(message: &str) -> String {
    message
        .chars()
        .filter(|character| !character.is_control())
        .take(240)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resend_payload_uses_official_reply_to() {
        let config = ResendConfig {
            api_key: "re_test".to_owned(),
            from_email: "VeloDent <noreply@velodent.app>".to_owned(),
        };
        let payload = build_payload(&config, "studio@example.test", "Oggetto", "<p>ok</p>");
        assert_eq!(RESEND_EMAILS_URI, "https://api.resend.com/emails");
        assert_eq!(payload.from, "VeloDent <noreply@velodent.app>");
        assert_eq!(payload.to, "studio@example.test");
        assert_eq!(payload.reply_to, "velodent@hotmail.com");
        assert_eq!(payload.subject, "Oggetto");
        assert_eq!(payload.html, "<p>ok</p>");
    }
}
