use serde::Serialize;
use std::{
    sync::mpsc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

const CLOUDFLARED_TIMEOUT: Duration = Duration::from_secs(25);
const FRONTEND_LOCAL_URL: &str = "http://localhost:1420";

#[derive(Debug, Clone, Serialize)]
pub struct MobileTunnelInfo {
    pub public_url: String,
    pub local_url: String,
    pub started_at_epoch_ms: u128,
}

pub(crate) struct MobileTunnelProcess {
    pub info: MobileTunnelInfo,
    child: Option<CommandChild>,
    running: bool,
}

impl MobileTunnelProcess {
    pub fn is_running(&mut self) -> bool {
        self.running
    }

    pub fn stop(&mut self) {
        if let Some(child) = self.child.take() {
            let _ = child.kill();
        }
        self.running = false;
    }
}

impl Drop for MobileTunnelProcess {
    fn drop(&mut self) {
        self.stop();
    }
}

pub fn start_cloudflare_quick_tunnel(
    app: &tauri::AppHandle,
) -> Result<MobileTunnelProcess, String> {
    let sidecar = app
        .shell()
        .sidecar("cloudflared")
        .map_err(|error| {
            format!("sidecar cloudflared non risolto dal pacchetto VeloDent: {error}")
        })?
        .args(["tunnel", "--url", FRONTEND_LOCAL_URL]);
    let (mut events, child) = sidecar.spawn().map_err(|error| {
        format!("sidecar cloudflared non avviato dal pacchetto VeloDent: {error}")
    })?;
    let (tx, rx) = mpsc::channel::<String>();

    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(line_bytes) | CommandEvent::Stderr(line_bytes) => {
                    let line = String::from_utf8_lossy(&line_bytes);
                    if let Some(url) = extract_trycloudflare_url(&line) {
                        let _ = tx.send(url);
                        return;
                    }
                }
                _ => {}
            }
        }
    });

    let public_url = match rx.recv_timeout(CLOUDFLARED_TIMEOUT) {
        Ok(url) => url,
        Err(_) => {
            let _ = child.kill();
            return Err(
                "sidecar cloudflared avviato ma nessun URL trycloudflare ricevuto entro 25 secondi"
                    .to_owned(),
            );
        }
    };

    Ok(MobileTunnelProcess {
        info: MobileTunnelInfo {
            public_url,
            local_url: FRONTEND_LOCAL_URL.to_owned(),
            started_at_epoch_ms: now_epoch_ms()?,
        },
        child: Some(child),
        running: true,
    })
}

fn extract_trycloudflare_url(line: &str) -> Option<String> {
    line.split_whitespace()
        .map(|part| {
            part.trim_matches(|character: char| {
                matches!(character, '"' | '\'' | ',' | ';' | ')' | '(' | '[' | ']')
            })
        })
        .find(|part| part.starts_with("https://") && part.contains(".trycloudflare.com"))
        .map(str::to_owned)
}

fn now_epoch_ms() -> Result<u128, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::extract_trycloudflare_url;

    #[test]
    fn extracts_trycloudflare_url_from_cloudflared_output() {
        let line = "INF +--------------------------------------------------------------------------------------------+ https://velodent-demo.trycloudflare.com";
        assert_eq!(
            extract_trycloudflare_url(line).as_deref(),
            Some("https://velodent-demo.trycloudflare.com")
        );
    }
}
