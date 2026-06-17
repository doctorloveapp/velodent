use serde::Serialize;

#[derive(Serialize)]
pub struct HealthStatus {
    status: &'static str,
    message_key: &'static str,
}

#[tauri::command]
pub fn health_check() -> HealthStatus {
    HealthStatus {
        status: "ready",
        message_key: "healthReady",
    }
}

