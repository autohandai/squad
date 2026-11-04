//! Reset owns a native quit/close guard until the bridge proves its outcome.
use crate::{default_paths, lock, Shell, MAIN_WINDOW};
#[cfg(test)]
use serde_json::json;
use serde_json::Value;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, WebviewWindow};

#[derive(Clone, Debug, PartialEq)]
pub struct Pending {
    request_id: String,
    previous_pid: u32,
}

#[derive(Default, Debug)]
pub enum ResetGuard {
    #[default]
    Idle,
    Confirm,
    Working(Pending),
    Complete(Pending),
}

impl ResetGuard {
    pub fn blocks_quit(&self) -> bool {
        matches!(self, Self::Confirm | Self::Working(_))
    }
    fn confirm(&mut self) -> Result<(), String> {
        if !matches!(self, Self::Idle | Self::Confirm) {
            return Err("Finish the current reset before starting another.".into());
        }
        *self = Self::Confirm;
        Ok(())
    }
    fn cancel(&mut self) -> Result<(), String> {
        if !matches!(self, Self::Idle | Self::Confirm) {
            return Err("Reset has started. Keep Squad open until it finishes.".into());
        }
        *self = Self::Idle;
        Ok(())
    }
    fn working(&mut self, pending: Pending) -> Result<(), String> {
        if !matches!(self, Self::Confirm) {
            return Err("Open the reset confirmation first.".into());
        }
        *self = Self::Working(pending);
        Ok(())
    }
    fn complete(&mut self, pending: Pending) -> Result<(), String> {
        if matches!(self, Self::Confirm) {
            return Err("Confirm or cancel this reset first.".into());
        }
        if matches!(self, Self::Working(active) | Self::Complete(active) if active != &pending) {
            return Err("Another reset is still in progress.".into());
        }
        *self = Self::Complete(pending);
        Ok(())
    }
}

pub fn blocked(app: &AppHandle) -> bool {
    app.try_state::<Arc<Shell>>()
        .is_some_and(|shell| lock(&shell.reset).blocks_quit())
}

fn authorize(window: &WebviewWindow, shell: &Shell) -> Result<String, String> {
    let base = lock(&shell.app_url)
        .clone()
        .ok_or("Squad is still starting.")?;
    let expected = reqwest::Url::parse(&base)
        .map_err(|e| e.to_string())?
        .origin();
    if window.label() != MAIN_WINDOW
        || window.url().map_err(|e| e.to_string())?.origin() != expected
    {
        return Err("Reset is only available from Squad's main window.".into());
    }
    Ok(base)
}

fn pending(request_id: Option<String>, previous_pid: Option<u32>) -> Result<Pending, String> {
    let request_id = request_id.ok_or("The reset request is missing.")?;
    if request_id.len() != 36
        || !request_id
            .bytes()
            .all(|c| c.is_ascii_hexdigit() || c == b'-')
    {
        return Err("The reset request is invalid.".into());
    }
    let previous_pid = previous_pid
        .filter(|pid| *pid > 0)
        .ok_or("The reset service is missing.")?;
    Ok(Pending {
        request_id,
        previous_pid,
    })
}

fn terminal(receipt: &Value, pending: &Pending) -> bool {
    receipt["requestId"] == pending.request_id
        && receipt["previousPid"].as_u64() == Some(u64::from(pending.previous_pid))
        && matches!(
            receipt["phase"].as_str(),
            Some("complete" | "failed" | "not-started")
        )
}

async fn status(base: &str, pending: &Pending) -> Result<Value, String> {
    // A receipt survives the archive and can be read while Node is restarting.
    if let Ok(bytes) = std::fs::read(default_paths().root.join("reset-progress.json")) {
        if let Ok(receipt) = serde_json::from_slice::<Value>(&bytes) {
            if terminal(&receipt, pending) {
                return Ok(receipt);
            }
        }
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())?;
    let mut url = reqwest::Url::parse(&format!(
        "{}/api/system/reset/status",
        base.trim_end_matches('/')
    ))
    .map_err(|e| e.to_string())?;
    url.query_pairs_mut()
        .append_pair("requestId", &pending.request_id)
        .append_pair("previousPid", &pending.previous_pid.to_string());
    let response: Value = client
        .get(url)
        .send()
        .await
        .map_err(|_| "Squad is still checking reset progress.")?
        .error_for_status()
        .map_err(|_| "Squad is still checking reset progress.")?
        .json()
        .await
        .map_err(|_| "Squad could not read reset progress.")?;
    Ok(response["data"].clone())
}

#[tauri::command]
pub async fn squad_set_system_reset_stage(
    window: WebviewWindow,
    shell: tauri::State<'_, Arc<Shell>>,
    stage: String,
    request_id: Option<String>,
    previous_pid: Option<u32>,
) -> Result<(), String> {
    let base = authorize(&window, &shell)?;
    match stage.as_str() {
        "confirm" => lock(&shell.reset).confirm(),
        "idle" => lock(&shell.reset).cancel(),
        "working" => lock(&shell.reset).working(pending(request_id, previous_pid)?),
        "complete" => {
            let pending = pending(request_id, previous_pid)?;
            if !terminal(&status(&base, &pending).await?, &pending) {
                return Err("Keep Squad open until reset is confirmed finished.".into());
            }
            lock(&shell.reset).complete(pending)
        }
        _ => Err("Unknown reset stage.".into()),
    }
}

#[tauri::command]
pub async fn squad_system_reset_status(
    window: WebviewWindow,
    shell: tauri::State<'_, Arc<Shell>>,
    request_id: String,
    previous_pid: u32,
) -> Result<Value, String> {
    let base = authorize(&window, &shell)?;
    status(&base, &pending(Some(request_id), Some(previous_pid))?).await
}

#[tauri::command]
pub async fn squad_restart_after_system_reset(
    app: AppHandle,
    window: WebviewWindow,
    shell: tauri::State<'_, Arc<Shell>>,
    request_id: String,
    previous_pid: u32,
) -> Result<(), String> {
    let base = authorize(&window, &shell)?;
    let pending = pending(Some(request_id), Some(previous_pid))?;
    let receipt = status(&base, &pending).await?;
    if !terminal(&receipt, &pending) {
        return Err("Reset has not finished. Keep Squad open.".into());
    }
    lock(&shell.reset).complete(pending.clone())?;
    // Bootstrap deliberately reuses healthy services at the same origin.
    // Wait for the fresh bridge, then restart the shell without a global
    // process-name cleanup which could stop another Squad profile.
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(30);
    while Instant::now() < deadline {
        if let Ok(response) = client
            .get(format!("{}/api/health", base.trim_end_matches('/')))
            .send()
            .await
        {
            if let Ok(health) = response.json::<Value>().await {
                if health["service"] == "autohand-squad-bridge"
                    && health["stateDir"] == default_paths().root.to_string_lossy().as_ref()
                    && health["pid"].as_u64().is_some_and(|pid| {
                        pid > 0
                            && (receipt["phase"] != "complete"
                                || pid != u64::from(pending.previous_pid))
                    })
                {
                    app.restart();
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    Err("Squad's local service has not restarted yet. Your dated backups are kept. Try Restart Squad again.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request(id: &str) -> Pending {
        Pending {
            request_id: id.into(),
            previous_pid: 123,
        }
    }
    #[test]
    fn confirmation_can_cancel_but_working_requires_matching_completion() {
        let mut guard = ResetGuard::default();
        assert!(!guard.blocks_quit());
        guard.confirm().unwrap();
        assert!(guard.blocks_quit());
        assert!(guard.complete(request("old")).is_err());
        assert!(guard.blocks_quit());
        guard.cancel().unwrap();
        assert!(!guard.blocks_quit());
        guard.confirm().unwrap();
        guard.working(request("one")).unwrap();
        assert!(guard.blocks_quit());
        assert!(guard.cancel().is_err());
        assert!(guard.confirm().is_err());
        assert!(guard.complete(request("two")).is_err());
        assert!(guard.blocks_quit());
        guard.complete(request("one")).unwrap();
        assert!(!guard.blocks_quit());
    }
    #[test]
    fn only_same_request_service_and_terminal_phase_prove_completion() {
        let p = request("one");
        for phase in ["complete", "failed", "not-started"] {
            assert!(terminal(
                &json!({"requestId":"one","previousPid":123,"phase":phase}),
                &p
            ));
        }
        for receipt in [
            json!({"requestId":"two","previousPid":123,"phase":"complete"}),
            json!({"requestId":"one","previousPid":456,"phase":"complete"}),
            json!({"requestId":"one","previousPid":123,"phase":"working"}),
        ] {
            assert!(!terminal(&receipt, &p));
        }
    }
}
