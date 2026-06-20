use serde::{Deserialize, Serialize};
use std::env;

const SUMUP_CHECKOUTS_URI: &str = "https://api.sumup.com/v0.1/checkouts";

#[derive(Debug, Clone)]
struct SumupConfig {
    api_key: String,
    merchant_code: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SumupCheckout {
    pub checkout_id: String,
    pub checkout_reference: String,
    pub amount_cents: i64,
    pub currency: String,
    pub checkout_url: Option<String>,
}

#[derive(Debug, Serialize)]
struct SumupCheckoutRequest {
    checkout_reference: String,
    amount: String,
    currency: String,
    merchant_code: String,
    description: String,
}

#[derive(Debug, Deserialize)]
struct SumupCheckoutResponse {
    id: Option<String>,
    checkout_reference: Option<String>,
    amount: Option<f64>,
    currency: Option<String>,
    checkout_url: Option<String>,
}

#[derive(Debug)]
pub enum SumupError {
    MissingApiKey,
    MissingMerchantCode,
    InvalidAmount,
    Request(String),
    HttpStatus(u16, String),
    MissingCheckoutId,
}

impl std::fmt::Display for SumupError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MissingApiKey => write!(f, "SUMUP_API_KEY is not configured"),
            Self::MissingMerchantCode => write!(f, "SUMUP_MERCHANT_CODE is not configured"),
            Self::InvalidAmount => write!(f, "sumup amount is not valid"),
            Self::Request(message) => write!(f, "sumup request failed: {message}"),
            Self::HttpStatus(status, message) => {
                write!(f, "sumup returned HTTP {status}: {message}")
            }
            Self::MissingCheckoutId => write!(f, "sumup response did not include checkout id"),
        }
    }
}

impl std::error::Error for SumupError {}

pub async fn create_checkout(
    invoice_id: i64,
    amount_cents: i64,
    description: &str,
) -> Result<SumupCheckout, SumupError> {
    let config = load_config()?;
    if amount_cents <= 0 {
        return Err(SumupError::InvalidAmount);
    }
    let checkout_reference = format!("VD-INVOICE-{invoice_id}");
    let payload = SumupCheckoutRequest {
        checkout_reference: checkout_reference.clone(),
        amount: format_cents_for_sumup(amount_cents),
        currency: "EUR".to_owned(),
        merchant_code: config.merchant_code,
        description: description.chars().take(120).collect(),
    };
    let client = reqwest::Client::new();
    let response = client
        .post(SUMUP_CHECKOUTS_URI)
        .bearer_auth(config.api_key)
        .json(&payload)
        .send()
        .await
        .map_err(|error| SumupError::Request(error.to_string()))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| SumupError::Request(error.to_string()))?;
    if !status.is_success() {
        return Err(SumupError::HttpStatus(
            status.as_u16(),
            sanitize_body(&body),
        ));
    }
    let parsed = serde_json::from_str::<SumupCheckoutResponse>(&body)
        .map_err(|error| SumupError::Request(error.to_string()))?;
    let checkout_id = parsed.id.ok_or(SumupError::MissingCheckoutId)?;
    Ok(SumupCheckout {
        checkout_id,
        checkout_reference: parsed.checkout_reference.unwrap_or(checkout_reference),
        amount_cents: parsed
            .amount
            .map(|amount| (amount * 100.0).round() as i64)
            .unwrap_or(amount_cents),
        currency: parsed.currency.unwrap_or_else(|| "EUR".to_owned()),
        checkout_url: parsed.checkout_url,
    })
}

fn load_config() -> Result<SumupConfig, SumupError> {
    let _ = dotenvy::dotenv();
    let api_key = env::var("SUMUP_API_KEY")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or(SumupError::MissingApiKey)?;
    let merchant_code = env::var("SUMUP_MERCHANT_CODE")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or(SumupError::MissingMerchantCode)?;
    Ok(SumupConfig {
        api_key,
        merchant_code,
    })
}

fn format_cents_for_sumup(amount_cents: i64) -> String {
    let euros = amount_cents / 100;
    let cents = amount_cents.abs() % 100;
    format!("{euros}.{cents:02}")
}

fn sanitize_body(body: &str) -> String {
    body.chars()
        .filter(|character| !character.is_control())
        .take(240)
        .collect()
}
