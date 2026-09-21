//! Desktop entry-point bootstrap: preflight → start services → wait for the
//! web runtime handshake → open the app. Every failure is surfaced through a
//! native dialog because a GUI process has no visible stdout.

use crate::cli::{
    is_local_open_url, open_url, readiness_timeout, start_services, wait_for_web_runtime,
    web_port_for,
};
use crate::config::{resolve_config, ConfigOverrides, SquadConfig};
use crate::preflight::{run_preflight, PreflightReport};
use crate::state::StatePaths;
use crate::telemetry::{append_telemetry_event, launcher_event};
use anyhow::{Context, Result};
use serde_json::json;
use std::path::Path;
use std::process::{Command, Stdio};
use tokio::runtime::Runtime;

const MAX_ATTEMPTS: usize = 5;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DialogChoice {
    Retry,
    OpenLogs,
    Quit,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BootstrapOutcome {
    /// Services are up and the app URL was opened; continue into the tray loop.
    Ready { url: String },
    /// The user chose Quit from a failure dialog.
    Quit,
}

pub struct BootstrapFailure {
    pub title: String,
    pub body: String,
}

pub fn run_desktop_bootstrap(
    runtime: &Runtime,
    paths: &StatePaths,
    overrides: &ConfigOverrides,
) -> Result<BootstrapOutcome> {
    run_desktop_bootstrap_with(runtime, paths, overrides, true)
}

/// Same as [`run_desktop_bootstrap`], but a host that owns its own window
/// (the Tauri shell) passes `open_browser = false` and navigates to the
/// returned URL itself.
pub fn run_desktop_bootstrap_with(
    runtime: &Runtime,
    paths: &StatePaths,
    overrides: &ConfigOverrides,
    open_browser: bool,
) -> Result<BootstrapOutcome> {
    let config = resolve_config(paths, overrides.clone())?;
    let mut attempt = 0usize;
    loop {
        attempt += 1;
        match bootstrap_once(runtime, paths, &config, open_browser) {
            Ok(url) => {
                record(
                    paths,
                    &config,
                    "desktop.ready",
                    json!({ "attempt": attempt, "url": url }),
                );
                return Ok(BootstrapOutcome::Ready { url });
            }
            Err(failure) => {
                record(
                    paths,
                    &config,
                    "desktop.blocked",
                    json!({ "attempt": attempt, "title": failure.title }),
                );
                append_bootstrap_log(paths, &failure);
                match show_failure_dialog(&failure, paths) {
                    DialogChoice::Retry if attempt < MAX_ATTEMPTS => continue,
                    DialogChoice::Retry => return Ok(BootstrapOutcome::Quit),
                    DialogChoice::OpenLogs => {
                        let _ = open_path(&paths.root);
                        // Opening the logs is not a resolution; ask again.
                        match show_failure_dialog(&failure, paths) {
                            DialogChoice::Retry if attempt < MAX_ATTEMPTS => continue,
                            _ => return Ok(BootstrapOutcome::Quit),
                        }
                    }
                    DialogChoice::Quit => return Ok(BootstrapOutcome::Quit),
                }
            }
        }
    }
}

fn bootstrap_once(
    runtime: &Runtime,
    paths: &StatePaths,
    config: &SquadConfig,
    open_browser: bool,
) -> std::result::Result<String, BootstrapFailure> {
    let report = run_preflight(paths, config);
    if !report.ok {
        return Err(preflight_failure(&report, paths));
    }

    let start = runtime
        .block_on(start_services(paths, config))
        .map_err(|error| BootstrapFailure {
            title: "Autohand Squad could not start its local services".to_string(),
            body: format!("{error:#}\n\nLogs: {}", paths.root.display()),
        })?;
    let web_port = web_port_for(config);
    // Hosted-UI deployments do not run the local web server; only wait for
    // the handshake when the configured URL is served by this machine.
    let ready = !is_local_open_url(&config.open_url)
        || runtime.block_on(wait_for_web_runtime(
            config.host.as_str(),
            web_port,
            readiness_timeout(),
        ));
    if !ready {
        let mut body = String::new();
        let output = format!("{}{}", start.stdout, start.stderr);
        if !output.trim().is_empty() {
            body.push_str(output.trim());
            body.push_str("\n\n");
        }
        body.push_str(&format!(
            "The web app at http://{}:{} did not answer within {} seconds.\n\nLogs: {}\nweb-server.log, server.log, and analytics.log contain the details.",
            config.host,
            web_port,
            readiness_timeout().as_secs(),
            paths.root.display()
        ));
        return Err(BootstrapFailure {
            title: "Autohand Squad started but the app did not become ready".to_string(),
            body,
        });
    }
    if start.code != 0 {
        // Services came up late; keep going but keep the diagnostics on disk.
        append_bootstrap_log(
            paths,
            &BootstrapFailure {
                title: "Services became ready after the launcher readiness window".to_string(),
                body: format!("{}{}", start.stdout, start.stderr),
            },
        );
    }

    let url = config.open_url.clone();
    if open_browser {
        open_url(&url).map_err(|error| BootstrapFailure {
            title: "Autohand Squad could not open the app".to_string(),
            body: format!("{error:#}\n\nOpen {url} in your browser manually."),
        })?;
    }
    Ok(url)
}

fn preflight_failure(report: &PreflightReport, paths: &StatePaths) -> BootstrapFailure {
    let mut body = report.summary_lines().join("\n");
    body.push_str(&format!(
        "\n\nRun `squad doctor` for the full report.\nLogs: {}",
        paths.root.display()
    ));
    BootstrapFailure {
        title: "Autohand Squad cannot start".to_string(),
        body,
    }
}

fn record(paths: &StatePaths, config: &SquadConfig, name: &str, data: serde_json::Value) {
    if config.telemetry_enabled() {
        let _ = append_telemetry_event(paths, launcher_event(name.to_string(), Some(data)));
    }
}

fn append_bootstrap_log(paths: &StatePaths, failure: &BootstrapFailure) {
    let _ = paths.ensure();
    crate::otel::launcher_log(
        paths,
        crate::otel::Severity::Fatal,
        &failure.title,
        &[(
            "autohand.launch.detail",
            serde_json::Value::String(failure.body.clone()),
        )],
    );
    let line = format!(
        "[{}] {}\n{}\n\n",
        crate::state::now_string(),
        failure.title,
        failure.body
    );
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&paths.tray_log)
    {
        use std::io::Write;
        let _ = file.write_all(line.as_bytes());
    }
}

/// Show a blocking three-button dialog. Retry / Open Logs / Quit.
pub fn show_failure_dialog(failure: &BootstrapFailure, paths: &StatePaths) -> DialogChoice {
    eprintln!("{}\n{}", failure.title, failure.body);
    native_dialog(&failure.title, &failure.body, paths).unwrap_or(DialogChoice::Quit)
}

#[cfg(target_os = "macos")]
fn native_dialog(title: &str, body: &str, _paths: &StatePaths) -> Result<DialogChoice> {
    let script = format!(
        "set choice to button returned of (display alert {} message {} as critical buttons {{\"Quit\", \"Open Logs\", \"Retry\"}} default button \"Retry\" cancel button \"Quit\")\nreturn choice",
        apple_script_string(title),
        apple_script_string(body)
    );
    let output = Command::new("osascript")
        .args(["-e", &script])
        .stdin(Stdio::null())
        .output()
        .context("show startup dialog")?;
    let choice = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(match choice.as_str() {
        "Retry" => DialogChoice::Retry,
        "Open Logs" => DialogChoice::OpenLogs,
        _ => DialogChoice::Quit,
    })
}

#[cfg(target_os = "windows")]
fn native_dialog(title: &str, body: &str, _paths: &StatePaths) -> Result<DialogChoice> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let script = format!(
        r#"
Add-Type -AssemblyName System.Windows.Forms
$result = [System.Windows.Forms.MessageBox]::Show(
  {message},
  {title},
  [System.Windows.Forms.MessageBoxButtons]::AbortRetryIgnore,
  [System.Windows.Forms.MessageBoxIcon]::Error
)
if ($result -eq [System.Windows.Forms.DialogResult]::Retry) {{ exit 10 }}
if ($result -eq [System.Windows.Forms.DialogResult]::Ignore) {{ exit 11 }}
exit 12
"#,
        message = powershell_string(&format!(
            "{body}\n\nRetry = try again · Ignore = open the log folder · Abort = quit"
        )),
        title = powershell_string(title),
    );
    let status = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-STA", "-Command", &script])
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .context("show startup dialog")?;
    Ok(match status.code() {
        Some(10) => DialogChoice::Retry,
        Some(11) => DialogChoice::OpenLogs,
        _ => DialogChoice::Quit,
    })
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn native_dialog(title: &str, body: &str, _paths: &StatePaths) -> Result<DialogChoice> {
    // zenity ships with GNOME; kdialog with KDE. Fall back to stderr.
    if let Ok(status) = Command::new("zenity")
        .args([
            "--question",
            "--title",
            title,
            "--text",
            body,
            "--ok-label",
            "Retry",
            "--cancel-label",
            "Quit",
            "--extra-button",
            "Open Logs",
            "--width",
            "520",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
    {
        let stdout = String::from_utf8_lossy(&status.stdout);
        if stdout.trim() == "Open Logs" {
            return Ok(DialogChoice::OpenLogs);
        }
        return Ok(if status.status.success() {
            DialogChoice::Retry
        } else {
            DialogChoice::Quit
        });
    }
    if let Ok(status) = Command::new("kdialog")
        .args([
            "--title",
            title,
            "--warningyesnocancel",
            &format!("{body}\n\nYes = Retry, No = Open Logs, Cancel = Quit"),
        ])
        .stdin(Stdio::null())
        .status()
    {
        return Ok(match status.code() {
            Some(0) => DialogChoice::Retry,
            Some(1) => DialogChoice::OpenLogs,
            _ => DialogChoice::Quit,
        });
    }
    Ok(DialogChoice::Quit)
}

#[cfg(target_os = "macos")]
fn apple_script_string(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

#[cfg(target_os = "windows")]
fn powershell_string(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

pub fn open_path(path: &Path) -> Result<()> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(path);
        command
    };
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("explorer");
        command.arg(path);
        command
    };
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(path);
        command
    };
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .context("open log folder")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::preflight::{CheckResult, CheckStatus};

    #[test]
    fn preflight_failure_mentions_doctor_and_logs() {
        let paths = StatePaths::from_root("/tmp/squad-bootstrap-test");
        let report = PreflightReport {
            ok: false,
            generated_at: "t".into(),
            state_dir: "s".into(),
            log_dir: "s".into(),
            web_url: "http://127.0.0.1:19821".into(),
            daemon_url: "http://127.0.0.1:19822".into(),
            checks: vec![CheckResult {
                id: "node-runtime".into(),
                label: "Node.js runtime".into(),
                status: CheckStatus::Fail,
                detail: "missing".into(),
                hint: "reinstall".into(),
            }],
        };
        let failure = preflight_failure(&report, &paths);
        assert_eq!(failure.title, "Autohand Squad cannot start");
        assert!(failure.body.contains("Node.js runtime: missing"));
        assert!(failure.body.contains("squad doctor"));
        assert!(failure.body.contains("/tmp/squad-bootstrap-test"));
    }
}
