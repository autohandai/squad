//! Launch preflight: the checks the desktop entry point and `squad doctor`
//! run before starting services. Every check produces a stable id, a
//! human-readable detail line, and a remediation hint so the GUI dialog, the
//! CLI, and support tickets all describe the same failure the same way.

use crate::analytics::DEFAULT_ANALYTICS_PORT;
use crate::cli::{
    bundled_autohand_cli, fetch_analytics_blocking, fetch_status_blocking,
    fetch_web_runtime_blocking, gui_path_env, locate_analytics_binary, locate_daemon_binary,
    locate_node_runtime, locate_tray_binary, locate_web_server, stack_daemon_config,
    web_port_from_open_url, DEFAULT_WEB_PORT,
};
use crate::config::SquadConfig;
use crate::state::{now_string, read_tray_record, StatePaths};
use serde::{Deserialize, Serialize};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

pub const MIN_NODE_MAJOR: u32 = 18;
pub const MIN_NODE_MINOR: u32 = 17;
const PROBE_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CheckStatus {
    Ok,
    Warn,
    Fail,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    pub id: String,
    pub label: String,
    pub status: CheckStatus,
    pub detail: String,
    pub hint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PreflightReport {
    pub ok: bool,
    pub generated_at: String,
    pub state_dir: String,
    pub log_dir: String,
    pub web_url: String,
    pub daemon_url: String,
    pub checks: Vec<CheckResult>,
}

impl PreflightReport {
    pub fn failures(&self) -> Vec<&CheckResult> {
        self.checks
            .iter()
            .filter(|check| check.status == CheckStatus::Fail)
            .collect()
    }

    pub fn warnings(&self) -> Vec<&CheckResult> {
        self.checks
            .iter()
            .filter(|check| check.status == CheckStatus::Warn)
            .collect()
    }

    /// One short paragraph per failure, suitable for a native dialog body.
    pub fn summary_lines(&self) -> Vec<String> {
        let mut lines = Vec::new();
        for check in self.failures() {
            lines.push(format!("• {}: {}", check.label, check.detail));
            if !check.hint.is_empty() {
                lines.push(format!("   {}", check.hint));
            }
        }
        if lines.is_empty() {
            for check in self.warnings() {
                lines.push(format!("• {} (warning): {}", check.label, check.detail));
            }
        }
        lines
    }
}

fn check(
    id: &str,
    label: &str,
    status: CheckStatus,
    detail: impl Into<String>,
    hint: impl Into<String>,
) -> CheckResult {
    CheckResult {
        id: id.to_string(),
        label: label.to_string(),
        status,
        detail: detail.into(),
        hint: hint.into(),
    }
}

pub fn run_preflight(paths: &StatePaths, config: &SquadConfig) -> PreflightReport {
    let web_port = web_port_from_open_url(&config.open_url).unwrap_or(DEFAULT_WEB_PORT);
    let daemon_config = stack_daemon_config(config, Some(web_port));
    let mut checks = Vec::new();

    checks.push(check_state_dir(paths));
    checks.push(check_binary(
        "daemon-binary",
        "Squad daemon",
        locate_daemon_binary(paths),
        "Reinstall Autohand Squad so autohand-squad-daemon sits next to the app binary.",
    ));
    checks.push(check_binary(
        "analytics-binary",
        "Squad analytics",
        locate_analytics_binary(paths),
        "Reinstall Autohand Squad so autohand-squad-analytics sits next to the app binary.",
    ));
    checks.push(match crate::cli::desktop_shell_binary() {
        Some(shell) => check(
            "tray-binary",
            "Desktop controller",
            CheckStatus::Ok,
            format!("desktop app {}", shell.display()),
            "",
        ),
        None => check_binary(
            "tray-binary",
            "Desktop controller",
            locate_tray_binary(paths),
            "Reinstall Autohand Squad so autohand-squad-tray sits next to the app binary.",
        ),
    });

    let (node_check, node_path) = check_node_runtime();
    checks.push(node_check);

    let server_path = locate_web_server(paths, None).ok();
    checks.push(match &server_path {
        Some(path) => check(
            "web-server",
            "Web bridge (server.mjs)",
            CheckStatus::Ok,
            path.display().to_string(),
            "",
        ),
        None => check(
            "web-server",
            "Web bridge (server.mjs)",
            CheckStatus::Fail,
            "server.mjs was not found in the app resources",
            "Reinstall Autohand Squad, or set AUTOHAND_SQUAD_WEB_SERVER to a server.mjs path.",
        ),
    });

    checks.push(match &server_path {
        Some(path) => {
            let dist_index = path
                .parent()
                .unwrap_or_else(|| Path::new("."))
                .join("dist")
                .join("index.html");
            if dist_index.exists() {
                check(
                    "web-build",
                    "Web app build",
                    CheckStatus::Ok,
                    dist_index.display().to_string(),
                    "",
                )
            } else {
                check(
                    "web-build",
                    "Web app build",
                    CheckStatus::Fail,
                    format!("{} is missing", dist_index.display()),
                    "Run `bun run build` in a source checkout, or reinstall the packaged app.",
                )
            }
        }
        None => check(
            "web-build",
            "Web app build",
            CheckStatus::Fail,
            "cannot look for dist/index.html without server.mjs",
            "",
        ),
    });

    checks.push(match server_path.as_deref().and_then(bundled_autohand_cli) {
        Some(cli) => check("autohand-cli", "Bundled Autohand CLI", CheckStatus::Ok, cli.display().to_string(), ""),
        None => match find_on_gui_path(if cfg!(windows) { "autohand.exe" } else { "autohand" }) {
            Some(system) => check(
                "autohand-cli",
                "Bundled Autohand CLI",
                CheckStatus::Warn,
                format!("bundled CLI missing; using system CLI at {}", system.display()),
                "Reinstall Autohand Squad to restore the bundled Autohand CLI.",
            ),
            None => check(
                "autohand-cli",
                "Bundled Autohand CLI",
                CheckStatus::Warn,
                "no bundled or system Autohand CLI was found; Autohand members cannot run until one exists",
                "Reinstall Autohand Squad, or install the Autohand CLI and sign in with `autohand login`.",
            ),
        },
    });

    checks.push(check_port(
        "web-port",
        "Web app port",
        &config.host,
        web_port,
        || fetch_web_runtime_blocking(&config.host, web_port).is_ok(),
    ));
    checks.push(check_port(
        "daemon-port",
        "Daemon API port",
        &daemon_config.host,
        daemon_config.port,
        || fetch_status_blocking(&daemon_config).is_ok(),
    ));
    checks.push(check_port(
        "analytics-port",
        "Analytics port",
        &daemon_config.host,
        DEFAULT_ANALYTICS_PORT,
        || fetch_analytics_blocking(&daemon_config, DEFAULT_ANALYTICS_PORT).is_ok(),
    ));

    checks.push(match read_tray_record(paths) {
        Ok(Some(record))
            if record.pid != std::process::id() && crate::cli::process_is_running(record.pid) =>
        {
            check(
                "tray",
                "Desktop controller instance",
                CheckStatus::Warn,
                format!(
                    "another Autohand Squad controller is already running (pid {})",
                    record.pid
                ),
                "The existing menu bar / tray instance will be reused.",
            )
        }
        _ => check(
            "tray",
            "Desktop controller instance",
            CheckStatus::Ok,
            "no other controller running",
            "",
        ),
    });

    let _ = node_path;
    let ok = !checks.iter().any(|item| item.status == CheckStatus::Fail);
    PreflightReport {
        ok,
        generated_at: now_string(),
        state_dir: paths.root.display().to_string(),
        log_dir: paths.root.display().to_string(),
        web_url: format!("http://{}:{web_port}", config.host),
        daemon_url: daemon_config.base_url(),
        checks,
    }
}

fn check_state_dir(paths: &StatePaths) -> CheckResult {
    if let Err(error) = paths.ensure() {
        return check(
            "state-dir",
            "State directory",
            CheckStatus::Fail,
            format!("{error:#}"),
            "Make sure your home directory is writable, or set AUTOHAND_SQUAD_HOME to a writable folder.",
        );
    }
    let probe = paths.root.join(".write-probe");
    match std::fs::write(&probe, b"ok") {
        Ok(()) => {
            let _ = std::fs::remove_file(&probe);
            check("state-dir", "State directory", CheckStatus::Ok, paths.root.display().to_string(), "")
        }
        Err(error) => check(
            "state-dir",
            "State directory",
            CheckStatus::Fail,
            format!("{} is not writable: {error}", paths.root.display()),
            "Make sure your home directory is writable, or set AUTOHAND_SQUAD_HOME to a writable folder.",
        ),
    }
}

fn check_binary(
    id: &str,
    label: &str,
    located: anyhow::Result<PathBuf>,
    hint: &str,
) -> CheckResult {
    match located {
        Ok(path) => check(id, label, CheckStatus::Ok, path.display().to_string(), ""),
        Err(error) => check(id, label, CheckStatus::Fail, format!("{error:#}"), hint),
    }
}

fn check_node_runtime() -> (CheckResult, Option<PathBuf>) {
    let node = match locate_node_runtime() {
        Ok(path) => path,
        Err(error) => {
            return (
                check(
                    "node-runtime",
                    "Node.js runtime",
                    CheckStatus::Fail,
                    format!("{error:#}"),
                    "Reinstall Autohand Squad (installers bundle Node), or install Node.js 18.17+ and set AUTOHAND_SQUAD_NODE.",
                ),
                None,
            )
        }
    };
    match run_with_timeout(&node, &["--version"], PROBE_TIMEOUT) {
        Ok(output) => {
            let version = output.trim().to_string();
            match parse_node_version(&version) {
                Some((major, minor, _)) if (major, minor) >= (MIN_NODE_MAJOR, MIN_NODE_MINOR) => (
                    check(
                        "node-runtime",
                        "Node.js runtime",
                        CheckStatus::Ok,
                        format!("{version} at {}", node.display()),
                        "",
                    ),
                    Some(node),
                ),
                Some(_) => (
                    check(
                        "node-runtime",
                        "Node.js runtime",
                        CheckStatus::Fail,
                        format!("{version} at {} is older than {MIN_NODE_MAJOR}.{MIN_NODE_MINOR}", node.display()),
                        "Reinstall Autohand Squad or point AUTOHAND_SQUAD_NODE at Node.js 18.17 or newer.",
                    ),
                    Some(node),
                ),
                None => (
                    check(
                        "node-runtime",
                        "Node.js runtime",
                        CheckStatus::Fail,
                        format!("{} did not report a Node.js version (got {version:?})", node.display()),
                        "Reinstall Autohand Squad or point AUTOHAND_SQUAD_NODE at a Node.js executable.",
                    ),
                    Some(node),
                ),
            }
        }
        Err(error) => (
            check(
                "node-runtime",
                "Node.js runtime",
                CheckStatus::Fail,
                format!("{} could not be executed: {error}", node.display()),
                "On macOS, remove the quarantine flag with `xattr -dr com.apple.quarantine \"/Applications/Autohand Squad.app\"` and try again.",
            ),
            Some(node),
        ),
    }
}

fn check_port(
    id: &str,
    label: &str,
    host: &str,
    port: u16,
    owned_by_squad: impl Fn() -> bool,
) -> CheckResult {
    match TcpListener::bind((host, port)) {
        Ok(listener) => {
            drop(listener);
            check(id, label, CheckStatus::Ok, format!("{host}:{port} is free"), "")
        }
        Err(_) if owned_by_squad() => check(
            id,
            label,
            CheckStatus::Ok,
            format!("{host}:{port} is already served by Autohand Squad"),
            "",
        ),
        Err(error) => check(
            id,
            label,
            CheckStatus::Fail,
            format!("{host}:{port} is in use by another program ({error})"),
            format!("Stop the other program or run Autohand Squad with a different port (squad --port / --open-url). Port {port} must be free."),
        ),
    }
}

pub fn parse_node_version(value: &str) -> Option<(u32, u32, u32)> {
    let trimmed = value.trim().trim_start_matches('v');
    let mut parts = trimmed.split(['.', '-', '+']);
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next().and_then(|part| part.parse().ok()).unwrap_or(0);
    Some((major, minor, patch))
}

/// Run an executable with an argument array and a hard timeout. Never a shell.
pub fn run_with_timeout(
    program: &Path,
    args: &[&str],
    timeout: Duration,
) -> Result<String, String> {
    let mut child = Command::new(program)
        .args(args)
        .env("PATH", gui_path_env())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let output = child
                    .wait_with_output()
                    .map_err(|error| error.to_string())?;
                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                if status.success() {
                    return Ok(stdout);
                }
                return Err(format!(
                    "exit status {}: {}",
                    status
                        .code()
                        .map(|code| code.to_string())
                        .unwrap_or_else(|| "signal".to_string()),
                    if stderr.trim().is_empty() {
                        stdout.trim()
                    } else {
                        stderr.trim()
                    }
                ));
            }
            Ok(None) => {
                if started.elapsed() > timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!("timed out after {} ms", timeout.as_millis()));
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(error) => return Err(error.to_string()),
        }
    }
}

fn find_on_gui_path(name: &str) -> Option<PathBuf> {
    std::env::split_paths(&gui_path_env())
        .map(|dir| dir.join(name))
        .find(|candidate| candidate.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_node_versions() {
        assert_eq!(parse_node_version("v22.23.1"), Some((22, 23, 1)));
        assert_eq!(parse_node_version("v18.17.0\n"), Some((18, 17, 0)));
        assert_eq!(parse_node_version("v20.0.0-nightly"), Some((20, 0, 0)));
        assert_eq!(parse_node_version("nope"), None);
    }

    #[test]
    fn summary_lists_failures_before_warnings() {
        let report = PreflightReport {
            ok: false,
            generated_at: "t".into(),
            state_dir: "s".into(),
            log_dir: "s".into(),
            web_url: "http://127.0.0.1:19821".into(),
            daemon_url: "http://127.0.0.1:19822".into(),
            checks: vec![
                check("a", "A", CheckStatus::Warn, "warn detail", ""),
                check("b", "B", CheckStatus::Fail, "fail detail", "do this"),
            ],
        };
        let lines = report.summary_lines();
        assert_eq!(lines[0], "• B: fail detail");
        assert_eq!(lines[1], "   do this");
        assert_eq!(report.failures().len(), 1);
        assert_eq!(report.warnings().len(), 1);
    }

    #[test]
    fn free_port_is_ok_and_busy_port_is_reported() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let busy = check_port("web-port", "Web app port", "127.0.0.1", port, || false);
        assert_eq!(busy.status, CheckStatus::Fail);
        let owned = check_port("web-port", "Web app port", "127.0.0.1", port, || true);
        assert_eq!(owned.status, CheckStatus::Ok);
        drop(listener);
    }
}
