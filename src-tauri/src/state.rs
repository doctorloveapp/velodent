#[cfg(feature = "mobile-tunnel")]
use crate::tunnel::{self, MobileTunnelInfo, MobileTunnelProcess};
use crate::{
    auth,
    db::{Database, DbError},
};
use rand_core::{OsRng, RngCore};
use serde::Serialize;
use std::{
    sync::{Mutex, MutexGuard},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const PAIRING_CODE_TTL: Duration = Duration::from_secs(300);

pub struct AppState {
    database: Mutex<Database>,
    #[cfg(feature = "mobile-tunnel")]
    mobile_tunnel: Mutex<Option<MobileTunnelProcess>>,
    pairing_code: Mutex<Option<PairingCode>>,
}

struct PairingCode {
    code_hash: String,
    user_id: i64,
    expires_at: Instant,
}

#[derive(Debug, Clone, Serialize)]
pub struct PairingCodeInfo {
    pub code: String,
    pub expires_at_epoch_ms: u128,
    pub public_url: Option<String>,
    pub server_port: u16,
    pub tunnel_error: Option<String>,
}

impl AppState {
    pub fn initialize() -> Result<Self, DbError> {
        Ok(Self {
            database: Mutex::new(Database::open_default()?),
            #[cfg(feature = "mobile-tunnel")]
            mobile_tunnel: Mutex::new(None),
            pairing_code: Mutex::new(None),
        })
    }

    pub fn database(&self) -> Result<MutexGuard<'_, Database>, String> {
        self.database
            .lock()
            .map_err(|_| "database lock poisoned".to_owned())
    }

    pub fn create_pairing_code(
        &self,
        user_id: i64,
        server_port: u16,
    ) -> Result<PairingCodeInfo, String> {
        let code = generate_pairing_pin();
        let expires_at = Instant::now() + PAIRING_CODE_TTL;
        let expires_at_epoch_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_millis()
            + PAIRING_CODE_TTL.as_millis();
        let record = PairingCode {
            code_hash: auth::hash_device_token(&code),
            user_id,
            expires_at,
        };
        let mut pairing_code = self
            .pairing_code
            .lock()
            .map_err(|_| "pairing lock poisoned".to_owned())?;
        *pairing_code = Some(record);

        Ok(PairingCodeInfo {
            code,
            expires_at_epoch_ms,
            public_url: None,
            server_port,
            tunnel_error: None,
        })
    }

    #[cfg(feature = "mobile-tunnel")]
    pub fn ensure_mobile_tunnel(&self, app: &tauri::AppHandle) -> Result<MobileTunnelInfo, String> {
        let mut tunnel_process = self
            .mobile_tunnel
            .lock()
            .map_err(|_| "mobile tunnel lock poisoned".to_owned())?;
        if let Some(process) = tunnel_process.as_mut() {
            if process.is_running() {
                return Ok(process.info.clone());
            }
            process.stop();
        }
        let next_process = tunnel::start_cloudflare_quick_tunnel(app)?;
        let info = next_process.info.clone();
        *tunnel_process = Some(next_process);
        Ok(info)
    }

    pub fn consume_pairing_code(&self, code: &str) -> Result<i64, String> {
        let mut pairing_code = self
            .pairing_code
            .lock()
            .map_err(|_| "pairing lock poisoned".to_owned())?;
        let Some(record) = pairing_code.as_ref() else {
            return Err("pairing code unavailable".to_owned());
        };
        if Instant::now() > record.expires_at {
            *pairing_code = None;
            return Err("pairing code expired".to_owned());
        }
        if auth::hash_device_token(code.trim()) != record.code_hash {
            return Err("pairing code invalid".to_owned());
        }
        let user_id = record.user_id;
        *pairing_code = None;
        Ok(user_id)
    }
}

fn generate_pairing_pin() -> String {
    let mut bytes = [0_u8; 4];
    OsRng.fill_bytes(&mut bytes);
    let raw = u32::from_le_bytes(bytes) % 1_000_000;
    format!("{raw:06}")
}
