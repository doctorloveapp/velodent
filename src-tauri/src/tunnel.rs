use serde::Serialize;
use std::{
    io::{BufRead, BufReader},
    process::{Child, Command, Stdio},
    sync::mpsc,
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
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
    child: Child,
}

impl MobileTunnelProcess {
    pub fn is_running(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }

    pub fn stop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for MobileTunnelProcess {
    fn drop(&mut self) {
        self.stop();
    }
}

pub fn start_cloudflare_quick_tunnel() -> Result<MobileTunnelProcess, String> {
    let mut command = Command::new("cloudflared");
    command
        .args(["tunnel", "--url", FRONTEND_LOCAL_URL])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_windows_console(&mut command);

    let mut child = command.spawn().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            "cloudflared non trovato nel PATH. Installa Cloudflare Tunnel o aggiungi cloudflared al PATH.".to_owned()
        } else {
            format!("cloudflared non avviato: {error}")
        }
    })?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let (tx, rx) = mpsc::channel::<String>();
    if let Some(stdout) = stdout {
        read_cloudflared_output(stdout, tx.clone());
    }
    if let Some(stderr) = stderr {
        read_cloudflared_output(stderr, tx);
    }

    let public_url = match rx.recv_timeout(CLOUDFLARED_TIMEOUT) {
        Ok(url) => url,
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err("cloudflared avviato ma nessun URL trycloudflare ricevuto entro 25 secondi".to_owned());
        }
    };

    Ok(MobileTunnelProcess {
        info: MobileTunnelInfo {
            public_url,
            local_url: FRONTEND_LOCAL_URL.to_owned(),
            started_at_epoch_ms: now_epoch_ms()?,
        },
        child,
    })
}

fn read_cloudflared_output<R>(reader: R, sender: mpsc::Sender<String>)
where
    R: std::io::Read + Send + 'static,
{
    thread::spawn(move || {
        let reader = BufReader::new(reader);
        for line in reader.lines().map_while(Result::ok) {
            if let Some(url) = extract_trycloudflare_url(&line) {
                let _ = sender.send(url);
                return;
            }
        }
    });
}

fn extract_trycloudflare_url(line: &str) -> Option<String> {
    line.split_whitespace()
        .map(|part| part.trim_matches(|character: char| {
            matches!(character, '"' | '\'' | ',' | ';' | ')' | '(' | '[' | ']')
        }))
        .find(|part| part.starts_with("https://") && part.contains(".trycloudflare.com"))
        .map(str::to_owned)
}

fn now_epoch_ms() -> Result<u128, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .map_err(|error| error.to_string())
}

#[cfg(windows)]
fn hide_windows_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_windows_console(_command: &mut Command) {}

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
