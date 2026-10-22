//! Desktop port ownership and recovery. A port number alone is never permission
//! to stop a process. Healthy services are reused; foreign listeners stay alive.
use crate::analytics::DEFAULT_ANALYTICS_PORT;
use crate::cli::{
    analytics_is_ready, fetch_status_blocking, fetch_web_runtime, listener_pids_for_port,
    locate_analytics_binary, non_bridge_command, post_to, process_is_running, stack_daemon_config,
    terminate_process, web_port_for, web_runtime_is_ready,
};
use crate::config::SquadConfig;
use crate::state::{read_analytics_record, read_daemon_record, read_web_server_record, StatePaths};
use anyhow::{bail, Context, Result};
use std::net::TcpListener;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

pub struct DesktopStartup {
    pub config: SquadConfig,
    pub analytics_port: u16,
}

pub(crate) fn analytics_port_for(paths: &StatePaths, host: &str) -> u16 {
    read_analytics_record(paths)
        .ok()
        .flatten()
        .filter(|record| record.host == host)
        .map(|record| record.port)
        .unwrap_or(DEFAULT_ANALYTICS_PORT)
}

fn same_state(value: &serde_json::Value, paths: &StatePaths) -> bool {
    value["stateDir"]
        .as_str()
        .is_some_and(|root| Path::new(root) == paths.root)
}

pub(crate) fn own_web(paths: &StatePaths, host: &str, port: u16) -> bool {
    if !web_runtime_is_ready(host, port) {
        return false;
    }
    match post_to::<serde_json::Value>(host, port, "GET", "/api/health", None) {
        Ok(value) => same_state(&value, paths),
        Err(_) => fetch_web_runtime(host, port).is_ok_and(|value| {
            value
                .pointer("/data/observability/logsDir")
                .and_then(|value| value.as_str())
                .is_some_and(|root| Path::new(root).starts_with(&paths.root))
        }),
    }
}

pub(crate) fn own_daemon(paths: &StatePaths, config: &SquadConfig, port: u16) -> bool {
    let mut probe = config.clone();
    probe.port = port;
    fetch_status_blocking(&probe).is_ok_and(|status| {
        status.success
            && status.service == "autohand-squad-daemon"
            && Path::new(&status.state_dir) == paths.root
    })
}

fn recorded_listener(pid: u32, port: u16) -> bool {
    pid != 0 && process_is_running(pid) && listener_pids_for_port(port) == [pid]
}

// `ps` reports whole seconds. Matching process age also rejects a recycled PID
// running the same binary for a different state directory.
fn elapsed_seconds(text: &str) -> Option<u64> {
    let (days, clock) = match text.trim().split_once('-') {
        Some((days, clock)) => (days.parse::<u64>().ok()?, clock),
        None => (0, text.trim()),
    };
    let fields = clock
        .split(':')
        .map(str::parse::<u64>)
        .collect::<std::result::Result<Vec<_>, _>>()
        .ok()?;
    match fields.as_slice() {
        [minutes, seconds] => Some(days * 86400 + minutes * 60 + seconds),
        [hours, minutes, seconds] => Some(days * 86400 + hours * 3600 + minutes * 60 + seconds),
        _ => None,
    }
}

fn process_matches(executable: &Path, started_at: &str, evidence: &str, now_ms: u128) -> bool {
    let Some((elapsed, command)) = evidence.trim().split_once(char::is_whitespace) else {
        return false;
    };
    let Some(age) = elapsed_seconds(elapsed) else {
        return false;
    };
    let Some(started) = started_at
        .strip_prefix("unix-ms:")
        .and_then(|value| value.parse::<u128>().ok())
    else {
        return false;
    };
    Path::new(command.trim()) == executable
        && now_ms
            .saturating_sub(u128::from(age) * 1000)
            .abs_diff(started)
            < 3000
}

fn process_evidence(pid: u32) -> Option<String> {
    #[cfg(unix)]
    {
        #[cfg(target_os = "linux")]
        let evidence = {
            // Linux `comm` is only a basename; /proc provides the actual image.
            let image = std::fs::read_link(format!("/proc/{pid}/exe")).ok()?;
            let output = non_bridge_command("ps")
                .args(["-p", &pid.to_string(), "-o", "etime="])
                .output()
                .ok()?;
            if !output.status.success() {
                return None;
            }
            format!(
                "{} {}",
                String::from_utf8_lossy(&output.stdout).trim(),
                image.display()
            )
        };
        #[cfg(not(target_os = "linux"))]
        let evidence = {
            let output = non_bridge_command("ps")
                .args(["-p", &pid.to_string(), "-o", "etime=,comm="])
                .output()
                .ok()?;
            if !output.status.success() {
                return None;
            }
            String::from_utf8_lossy(&output.stdout).into_owned()
        };
        return Some(evidence);
    }
    #[cfg(not(unix))]
    None
}

fn owned_process(pid: u32, port: u16, started_at: &str, executable: &Path) -> Option<u32> {
    if pid == std::process::id() || !recorded_listener(pid, port) {
        return None;
    }
    let evidence = process_evidence(pid)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_millis();
    if process_matches(executable, started_at, &evidence, now) {
        return Some(pid);
    }
    None
}

fn recorded_daemon_may_have_work(paths: &StatePaths, config: &SquadConfig) -> bool {
    let Some(record) = read_daemon_record(paths).ok().flatten() else {
        return false;
    };
    if record.host != config.host
        || record.pid == std::process::id()
        || !process_is_running(record.pid)
    {
        return false;
    }
    // Preservation needs less evidence than termination. A slow cold start may
    // make the recorded birth time imprecise; an expected core image can still
    // hold work. A positively identified foreign image is a recycled PID.
    let Some(evidence) = process_evidence(record.pid) else {
        return true;
    };
    let Some((_, command)) = evidence.trim().split_once(char::is_whitespace) else {
        return true;
    };
    let Ok(expected) = crate::cli::locate_daemon_binary(paths) else {
        return true;
    };
    Path::new(command.trim()) == expected
}

pub(crate) fn owned_analytics(paths: &StatePaths, config: &SquadConfig, port: u16) -> Option<u32> {
    let record = read_analytics_record(paths).ok().flatten()?;
    if record.host != config.host || record.port != port {
        return None;
    }
    owned_process(
        record.pid,
        port,
        &record.started_at,
        &locate_analytics_binary(paths).ok()?,
    )
}

pub(crate) fn owned_daemon(paths: &StatePaths, config: &SquadConfig) -> Option<u32> {
    let record = read_daemon_record(paths).ok().flatten()?;
    if record.host != config.host || record.port != config.port {
        return None;
    }
    owned_process(
        record.pid,
        record.port,
        &record.started_at,
        &crate::cli::locate_daemon_binary(paths).ok()?,
    )
}

pub(crate) fn owned_web(paths: &StatePaths, config: &SquadConfig, port: u16) -> Option<u32> {
    let record = read_web_server_record(paths).ok().flatten()?;
    if record.host != config.host || record.port != port {
        return None;
    }
    if Path::new(&record.server_path) != crate::cli::locate_web_server(paths, None).ok()? {
        return None;
    }
    owned_process(
        record.pid,
        port,
        &record.started_at,
        &crate::cli::locate_node_runtime().ok()?,
    )
}

pub(crate) fn own_analytics(paths: &StatePaths, config: &SquadConfig, port: u16) -> bool {
    if !analytics_is_ready(config, port) {
        return false;
    }
    post_to::<serde_json::Value>(&config.host, port, "GET", "/health", None).is_ok_and(|value| {
        same_state(&value, paths)
            || (value.get("stateDir").is_none() && owned_analytics(paths, config, port).is_some())
    })
}

fn select_port(
    host: &str,
    preferred: u16,
    reserved: &[u16],
    healthy: bool,
    owned_busy: bool,
    fixed: bool,
) -> Result<u16> {
    if !reserved.contains(&preferred) {
        if healthy {
            return Ok(preferred);
        }
        if owned_busy {
            bail!("A Squad service at {host}:{preferred} is still responding to its process record but not its health check. Its work has been preserved; retry shortly.");
        }
        if let Ok(listener) = TcpListener::bind((host, preferred)) {
            return Ok(listener.local_addr()?.port());
        }
    }
    if fixed {
        bail!("Squad's required port {host}:{preferred} is occupied by another service. Its owner could not be verified as Squad, so it was left running.");
    }
    for _ in 0..16 {
        let listener = TcpListener::bind((host, 0)).context("find a free local port")?;
        let port = listener.local_addr()?.port();
        if !reserved.contains(&port) {
            return Ok(port);
        }
    }
    bail!("Could not find separate free ports for Squad's local services")
}

pub fn prepare_desktop_startup(paths: &StatePaths, config: &SquadConfig) -> Result<DesktopStartup> {
    let mut next = config.clone();
    let mut analytics_port = analytics_port_for(paths, &config.host);
    let original_web = web_port_for(config);
    if crate::cli::is_local_open_url(&config.open_url) {
        let record = read_web_server_record(paths)
            .ok()
            .flatten()
            .filter(|record| record.host == config.host);
        let preferred = original_web;
        // A different bridge origin would hide origin-scoped WebKit state.
        // Never trade apparently lost chats for a successful port bind.
        select_port(&config.host, preferred, &[], own_web(paths, &config.host, preferred), record.as_ref().is_some_and(|record| record.port == preferred && recorded_listener(record.pid, preferred)), true)
            .context("Close the app using Squad's web port and retry. Squad kept its saved desktop address and data")?;
    }
    let web = web_port_for(&next);
    let daemon = stack_daemon_config(config, Some(original_web));
    let daemon_record = read_daemon_record(paths)
        .ok()
        .flatten()
        .filter(|record| record.host == config.host);
    let recorded_owned = recorded_daemon_may_have_work(paths, config);
    let recorded_healthy = daemon_record
        .as_ref()
        .is_some_and(|record| own_daemon(paths, config, record.port));
    let preferred = daemon_record
        .as_ref()
        .filter(|_| recorded_owned || recorded_healthy)
        .map(|record| record.port)
        .unwrap_or(daemon.port);
    if config.fixed_port.is_some() && preferred != daemon.port {
        bail!("Squad is already running on recorded daemon port {preferred}. Stop its work before changing to the explicitly fixed port {}. The existing service was preserved.", daemon.port);
    }
    next.port = select_port(
        &config.host,
        preferred,
        &[web],
        own_daemon(paths, config, preferred),
        daemon_record
            .as_ref()
            .is_some_and(|record| record.port == preferred && recorded_owned),
        config.fixed_port.is_some(),
    )?;
    next.fixed_port = Some(next.port);

    if !own_analytics(paths, config, analytics_port) {
        if let Some(pid) = owned_analytics(paths, config, analytics_port) {
            // Analytics never executes agent work. Recheck ownership immediately
            // before signalling; never use the machine-wide `squad stop` path.
            if owned_analytics(paths, config, analytics_port) == Some(pid)
                && !terminate_process(pid)
            {
                bail!("Squad's stale analytics service did not stop; the app was left intact");
            }
        }
    }
    analytics_port = select_port(
        &config.host,
        analytics_port,
        &[web, next.port],
        own_analytics(paths, config, analytics_port),
        false,
        false,
    )?;
    Ok(DesktopStartup {
        config: next,
        analytics_port,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn foreign_listener_stays_alive_and_gets_a_different_port() {
        let foreign = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = foreign.local_addr().unwrap().port();
        assert_ne!(
            select_port("127.0.0.1", port, &[], false, false, false).unwrap(),
            port
        );
        assert!(TcpListener::bind(("127.0.0.1", port)).is_err());
        assert_eq!(
            select_port("127.0.0.1", port, &[], true, true, false).unwrap(),
            port
        );
        assert!(select_port("127.0.0.1", port, &[], false, true, false).is_err());
        assert!(select_port("127.0.0.1", port, &[], false, false, true).is_err());
    }
    #[test]
    fn recovery_rejects_pid_reuse_and_different_executables() {
        let exe =
            Path::new("/Applications/Autohand Squad.app/Contents/MacOS/autohand-squad-analytics");
        let record = "unix-ms:100000";
        assert!(process_matches(
            exe,
            record,
            &format!("00:10 {}", exe.display()),
            110500
        ));
        assert!(!process_matches(
            exe,
            record,
            &format!("00:02 {}", exe.display()),
            110500
        ));
        assert!(!process_matches(
            exe,
            record,
            "00:10 /usr/bin/python3",
            110500
        ));
        assert!(!process_matches(
            exe,
            "bad",
            &format!("00:10 {}", exe.display()),
            110500
        ));
        assert_eq!(elapsed_seconds("2-03:04:05"), Some(183845));
    }
    #[test]
    fn ports_do_not_overlap() {
        let port = select_port("127.0.0.1", 19821, &[19821], false, false, false).unwrap();
        assert_ne!(port, 19821);
    }

    #[test]
    fn desktop_bootstrap_moves_foreign_background_ports() {
        let root = std::env::temp_dir().join(format!(
            "squad-foreign-ports-{}-{}",
            std::process::id(),
            crate::state::now_string().replace(':', "-")
        ));
        let paths = StatePaths::from_root(&root);
        paths.ensure().unwrap();
        let web = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let daemon = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let analytics = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let web_port = web.local_addr().unwrap().port();
        let daemon_port = daemon.local_addr().unwrap().port();
        let analytics_port = analytics.local_addr().unwrap().port();
        crate::state::write_analytics_record(
            &paths,
            &crate::state::AnalyticsRecord {
                pid: std::process::id(),
                host: "127.0.0.1".into(),
                port: analytics_port,
                url: format!("http://127.0.0.1:{analytics_port}"),
                started_at: crate::state::now_string(),
            },
        )
        .unwrap();
        let mut config = SquadConfig::defaults();
        config.port = daemon_port;
        config.open_url = "https://squad.example.test/work?view=needs-you".into();
        let startup = prepare_desktop_startup(&paths, &config).unwrap();
        assert_ne!(startup.config.port, daemon_port);
        assert_ne!(startup.analytics_port, analytics_port);
        assert_eq!(startup.config.open_url, config.open_url);
        assert!(TcpListener::bind(("127.0.0.1", web_port)).is_err());
        assert!(TcpListener::bind(("127.0.0.1", daemon_port)).is_err());
        assert!(TcpListener::bind(("127.0.0.1", analytics_port)).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn foreign_web_listener_cannot_change_the_saved_desktop_origin() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let paths = StatePaths::from_root(std::env::temp_dir().join("squad-foreign-web-port"));
        let mut config = SquadConfig::defaults();
        config.open_url = format!("http://127.0.0.1:{port}/work");
        assert!(prepare_desktop_startup(&paths, &config).is_err());
        assert!(TcpListener::bind(("127.0.0.1", port)).is_err());
    }

    #[test]
    #[cfg(unix)]
    fn live_recorded_fallback_daemon_is_not_duplicated() {
        let (child, paths, port, started_at) = stalled_service("autohand-squad-daemon");
        crate::state::write_daemon_record(
            &paths,
            &crate::state::DaemonRecord {
                pid: child.0.lock().unwrap().id(),
                host: "127.0.0.1".into(),
                port,
                url: format!("http://127.0.0.1:{port}"),
                accepting_work: true,
                started_at,
                drain_requested_at: None,
            },
        )
        .unwrap();
        let mut config = SquadConfig::defaults();
        config.open_url = "https://squad.example.test/".into();
        config.port = TcpListener::bind(("127.0.0.1", 0))
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let result = prepare_desktop_startup(&paths, &config);
        config.fixed_port = Some(config.port);
        let fixed = prepare_desktop_startup(&paths, &config);
        assert!(
            result.is_err(),
            "an unresponsive live daemon on its recorded fallback port must be retained"
        );
        assert!(TcpListener::bind(("127.0.0.1", port)).is_err());
        assert!(fixed
            .err()
            .unwrap()
            .to_string()
            .contains("explicitly fixed port"));
    }

    #[test]
    fn recycled_daemon_pid_does_not_block_a_free_port() {
        let root =
            std::env::temp_dir().join(format!("squad-recycled-daemon-{}", std::process::id()));
        let paths = StatePaths::from_root(&root);
        paths.ensure().unwrap();
        let free = TcpListener::bind(("127.0.0.1", 0))
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        crate::state::write_daemon_record(
            &paths,
            &crate::state::DaemonRecord {
                pid: std::process::id(),
                host: "127.0.0.1".into(),
                port: free,
                url: format!("http://127.0.0.1:{free}"),
                accepting_work: true,
                started_at: "unix-ms:1".into(),
                drain_requested_at: None,
            },
        )
        .unwrap();
        let mut config = SquadConfig::defaults();
        config.port = free;
        config.open_url = "https://squad.example.test/".into();
        let result = prepare_desktop_startup(&paths, &config);
        std::fs::remove_dir_all(root).unwrap();
        assert!(
            result.is_ok(),
            "a recycled unrelated PID is not a running Squad daemon"
        );
    }

    #[test]
    #[cfg(unix)]
    fn stalled_analytics_child() {
        let Ok(port) = std::env::var("SQUAD_STALLED_ANALYTICS_PORT") else {
            return;
        };
        let _listener = TcpListener::bind(("127.0.0.1", port.parse::<u16>().unwrap())).unwrap();
        // Real owned listener, deliberately unable to answer health requests.
        loop {
            std::thread::park();
        }
    }

    #[cfg(unix)]
    struct StalledServiceCleanup(
        std::sync::Arc<std::sync::Mutex<std::process::Child>>,
        std::path::PathBuf,
        Option<std::thread::JoinHandle<()>>,
    );
    #[cfg(unix)]
    impl Drop for StalledServiceCleanup {
        fn drop(&mut self) {
            let mut child = self.0.lock().unwrap();
            let _ = child.kill();
            let _ = child.wait();
            drop(child);
            if let Some(reaper) = self.2.take() {
                let _ = reaper.join();
            }
            let _ = std::fs::remove_dir_all(&self.1);
        }
    }
    #[cfg(unix)]
    fn stalled_service(binary: &str) -> (StalledServiceCleanup, StatePaths, u16, String) {
        let root = std::env::temp_dir().join(format!(
            "squad-stalled-{binary}-{}-{}",
            std::process::id(),
            crate::state::now_string().replace(':', "-")
        ));
        let paths = StatePaths::from_root(&root);
        paths.ensure().unwrap();
        let executable = paths.bin_dir.join(binary);
        std::fs::copy(std::env::current_exe().unwrap(), &executable).unwrap();
        let port = TcpListener::bind(("127.0.0.1", 0))
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let child = std::process::Command::new(&executable)
            .args(["--exact", "startup_ports::tests::stalled_analytics_child"])
            .env("SQUAD_STALLED_ANALYTICS_PORT", port.to_string())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap();
        let pid = child.id();
        let started_at = crate::state::now_string();
        let child = std::sync::Arc::new(std::sync::Mutex::new(child));
        let reaping = child.clone();
        let reaper = std::thread::spawn(move || loop {
            if reaping.lock().unwrap().try_wait().unwrap().is_some() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        });
        let cleanup = StalledServiceCleanup(child, root, Some(reaper));
        for _ in 0..100 {
            if recorded_listener(pid, port) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        assert!(recorded_listener(pid, port));
        (cleanup, paths, port, started_at)
    }

    #[test]
    #[cfg(unix)]
    fn desktop_bootstrap_recovers_only_its_stalled_analytics_process() {
        let (cleanup, paths, port, started_at) = stalled_service("autohand-squad-analytics");
        let pid = cleanup.0.lock().unwrap().id();
        crate::state::write_analytics_record(
            &paths,
            &crate::state::AnalyticsRecord {
                pid,
                host: "127.0.0.1".into(),
                port,
                url: format!("http://127.0.0.1:{port}"),
                started_at,
            },
        )
        .unwrap();
        assert_eq!(
            owned_analytics(&paths, &SquadConfig::defaults(), port),
            Some(pid),
            "{}",
            String::from_utf8_lossy(
                &non_bridge_command("ps")
                    .args(["-p", &pid.to_string(), "-o", "etime=,comm="])
                    .output()
                    .unwrap()
                    .stdout
            )
        );
        let web = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let daemon = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let mut config = SquadConfig::defaults();
        config.port = daemon.local_addr().unwrap().port();
        config.open_url = format!("http://127.0.0.1:{}", web.local_addr().unwrap().port());
        drop((web, daemon));
        let startup = prepare_desktop_startup(&paths, &config).unwrap();
        assert_eq!(startup.analytics_port, port);
        assert!(
            cleanup.0.lock().unwrap().try_wait().unwrap().is_some(),
            "owned stale listener must exit"
        );
        assert!(TcpListener::bind(("127.0.0.1", port)).is_ok());
    }
}
