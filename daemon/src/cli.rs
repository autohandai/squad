use crate::analytics::{collect_analytics_snapshot, AnalyticsSnapshot, DEFAULT_ANALYTICS_PORT};
use crate::config::{resolve_config, ConfigOverrides, PartialSquadConfig, SquadConfig};
use crate::daemon::{read_queue_items, QueueResponse, StatusResponse};
use crate::state::{
    default_state_paths, read_daemon_record, read_tray_record, read_web_server_record,
    remove_analytics_record, remove_daemon_record, remove_web_server_record, write_tray_record,
    write_web_server_record, StatePaths, TrayRecord, WebServerRecord, DEFAULT_PORT,
};
use crate::telemetry::{append_telemetry_event, launcher_event};
use anyhow::{anyhow, bail, Context, Result};
use clap::{Parser, Subcommand};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::net::TcpStream;
#[cfg(target_family = "unix")]
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;
use tokio::time::sleep;

#[derive(Debug, Parser)]
#[command(name = "squad")]
#[command(about = "Standalone Autohand Squad runtime launcher")]
pub struct SquadCli {
    #[arg(long, global = true)]
    pub host: Option<String>,
    #[arg(long, global = true)]
    pub port: Option<u16>,
    #[arg(long, global = true)]
    pub fixed_port: Option<u16>,
    #[arg(long, global = true)]
    pub open_url: Option<String>,
    #[arg(long, global = true)]
    pub hosted_ui_url: Option<String>,
    #[arg(long, global = true)]
    pub proxy_url: Option<String>,
    #[arg(long, global = true)]
    pub api_gateway_url: Option<String>,
    #[arg(long, global = true)]
    pub api_base_url: Option<String>,
    #[arg(long, global = true)]
    pub api_auth_token: Option<String>,
    #[arg(long, global = true)]
    pub company_secret: Option<String>,
    #[arg(long, global = true)]
    pub update_channel: Option<String>,
    #[arg(long, global = true)]
    pub launch_at_login_policy: Option<String>,
    #[arg(long, global = true)]
    pub telemetry_policy: Option<String>,
    #[arg(long, global = true)]
    pub account_email: Option<String>,
    #[arg(long, global = true)]
    pub plan_state: Option<String>,
    #[command(subcommand)]
    pub command: Option<SquadCommand>,
}

#[derive(Debug, Clone, Subcommand)]
pub enum SquadCommand {
    Start,
    Status,
    Restart,
    Stop,
    Queue,
    Open,
    Config,
    AnalyticsStart {
        #[arg(long, default_value_t = DEFAULT_ANALYTICS_PORT)]
        analytics_port: u16,
    },
    AnalyticsStatus {
        #[arg(long, default_value_t = DEFAULT_ANALYTICS_PORT)]
        analytics_port: u16,
    },
    AnalyticsStop {
        #[arg(long, default_value_t = DEFAULT_ANALYTICS_PORT)]
        analytics_port: u16,
    },
    Serve {
        #[arg(long)]
        server_path: Option<PathBuf>,
        #[arg(long)]
        dev: bool,
        #[arg(long, default_value_t = DEFAULT_PORT)]
        web_port: u16,
    },
    ServeStatus {
        #[arg(long, default_value_t = DEFAULT_PORT)]
        web_port: u16,
    },
    ServeStop {
        #[arg(long, default_value_t = DEFAULT_PORT)]
        web_port: u16,
    },
}

const DEFAULT_WEB_PORT: u16 = 19821;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandOutput {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

impl CommandOutput {
    fn ok(stdout: impl Into<String>) -> Self {
        Self {
            code: 0,
            stdout: stdout.into(),
            stderr: String::new(),
        }
    }

    fn error(stderr: impl Into<String>) -> Self {
        Self {
            code: 1,
            stdout: String::new(),
            stderr: stderr.into(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebShutdownResponse {
    data: Option<WebShutdownData>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebShutdownData {
    stopped_runs: usize,
}

pub async fn run_squad_cli() -> Result<i32> {
    let args = SquadCli::parse();
    let output = run_squad_command(args).await?;
    if !output.stdout.is_empty() {
        print!("{}", output.stdout);
    }
    if !output.stderr.is_empty() {
        eprint!("{}", output.stderr);
    }
    Ok(output.code)
}

pub async fn run_squad_command(args: SquadCli) -> Result<CommandOutput> {
    let paths = default_state_paths();
    run_squad_command_with_paths(args, paths).await
}

pub async fn run_squad_command_with_paths(
    args: SquadCli,
    paths: StatePaths,
) -> Result<CommandOutput> {
    run_squad_command_with_paths_inner(args, paths, true).await
}

pub async fn run_squad_service_command_with_paths(
    args: SquadCli,
    paths: StatePaths,
) -> Result<CommandOutput> {
    run_squad_command_with_paths_inner(args, paths, false).await
}

async fn run_squad_command_with_paths_inner(
    args: SquadCli,
    paths: StatePaths,
    tray_requested: bool,
) -> Result<CommandOutput> {
    paths.ensure()?;
    let config = resolve_config(&paths, overrides_from_args(&args))?;
    let command = args.command.unwrap_or(SquadCommand::Open);
    record_launcher_command(&paths, &config, command_name(&command));
    match command {
        SquadCommand::Start => start_stack(&paths, &config, false, tray_requested).await,
        SquadCommand::Status => stack_status(&paths, &config).await,
        SquadCommand::Restart => restart_stack(&paths, &config, tray_requested).await,
        SquadCommand::Stop => stop_stack(&paths, &config).await,
        SquadCommand::Queue => queue(&paths, &config).await,
        SquadCommand::Open => start_stack(&paths, &config, true, tray_requested).await,
        SquadCommand::Config => json_output(&config),
        SquadCommand::AnalyticsStart { analytics_port } => {
            analytics_start(&paths, &config, analytics_port).await
        }
        SquadCommand::AnalyticsStatus { analytics_port } => {
            analytics_status(&paths, &config, analytics_port).await
        }
        SquadCommand::AnalyticsStop { analytics_port } => {
            analytics_stop(&paths, &config, analytics_port).await
        }
        SquadCommand::Serve {
            server_path,
            dev,
            web_port,
        } => serve(&paths, &config, server_path, dev, web_port).await,
        SquadCommand::ServeStatus { web_port } => serve_status(&paths, &config, web_port).await,
        SquadCommand::ServeStop { web_port } => serve_stop(&paths, &config, web_port).await,
    }
}

fn overrides_from_args(args: &SquadCli) -> ConfigOverrides {
    PartialSquadConfig {
        host: args.host.clone(),
        port: args.port,
        fixed_port: args.fixed_port,
        open_url: args.open_url.clone(),
        hosted_ui_url: args.hosted_ui_url.clone(),
        proxy_url: args.proxy_url.clone(),
        api_gateway_url: args.api_gateway_url.clone(),
        api_base_url: args.api_base_url.clone(),
        api_auth_token: args.api_auth_token.clone(),
        company_secret: args.company_secret.clone(),
        update_channel: args.update_channel.clone(),
        launch_at_login_policy: args.launch_at_login_policy.clone(),
        telemetry_policy: args.telemetry_policy.clone(),
        account_email: args.account_email.clone(),
        plan_state: args.plan_state.clone(),
    }
}

fn command_name(command: &SquadCommand) -> &'static str {
    match command {
        SquadCommand::Start => "start",
        SquadCommand::Status => "status",
        SquadCommand::Restart => "restart",
        SquadCommand::Stop => "stop",
        SquadCommand::Queue => "queue",
        SquadCommand::Open => "open",
        SquadCommand::Config => "config",
        SquadCommand::AnalyticsStart { .. } => "analytics-start",
        SquadCommand::AnalyticsStatus { .. } => "analytics-status",
        SquadCommand::AnalyticsStop { .. } => "analytics-stop",
        SquadCommand::Serve { .. } => "serve",
        SquadCommand::ServeStatus { .. } => "serve-status",
        SquadCommand::ServeStop { .. } => "serve-stop",
    }
}

fn record_launcher_command(paths: &StatePaths, config: &SquadConfig, command: &str) {
    if config.telemetry_enabled() {
        let _ = append_telemetry_event(
            paths,
            launcher_event(
                format!("launcher.{command}"),
                Some(json!({
                    "command": command,
                    "openUrl": &config.open_url,
                    "host": &config.host,
                    "port": config.port
                })),
            ),
        );
    }
}

async fn start_stack(
    paths: &StatePaths,
    config: &SquadConfig,
    open_requested: bool,
    tray_requested: bool,
) -> Result<CommandOutput> {
    let web_port = web_port_from_open_url(&config.open_url).unwrap_or(DEFAULT_WEB_PORT);
    let daemon_config = stack_daemon_config(config, Some(web_port));
    let mut code = 0;
    let mut output = Vec::new();

    for result in [
        start(paths, &daemon_config).await?,
        analytics_start(paths, &daemon_config, DEFAULT_ANALYTICS_PORT).await?,
    ] {
        if result.code != 0 {
            code = result.code;
        }
        output.push(result.stdout);
        output.push(result.stderr);
    }

    if is_local_open_url(&config.open_url) {
        let result = serve(paths, config, None, false, web_port).await?;
        if result.code != 0 {
            code = result.code;
        }
        output.push(result.stdout);
        output.push(result.stderr);
    }

    if tray_requested {
        match spawn_tray(paths, &daemon_config, &config.open_url) {
            Ok(Some(message)) => output.push(message),
            Ok(None) => {}
            Err(error) => {
                code = 1;
                output.push(format!("Autohand Squad tray did not start: {error:#}\n"));
            }
        }
    }

    if open_requested {
        match open_url(&config.open_url) {
            Ok(()) => output.push(format!("Opened {}\n", config.open_url)),
            Err(error) => {
                code = 1;
                output.push(format!("Could not open {}: {error:#}\n", config.open_url));
            }
        }
    }

    Ok(CommandOutput {
        code,
        stdout: output
            .into_iter()
            .filter(|item| !item.is_empty())
            .collect::<String>(),
        stderr: String::new(),
    })
}

async fn stack_status(paths: &StatePaths, config: &SquadConfig) -> Result<CommandOutput> {
    let web_port = web_port_from_open_url(&config.open_url).unwrap_or(DEFAULT_WEB_PORT);
    let daemon_config =
        daemon_config_from_record(paths, &stack_daemon_config(config, Some(web_port)));
    let daemon = fetch_status(&daemon_config).await.ok();
    let analytics = fetch_analytics(&daemon_config, DEFAULT_ANALYTICS_PORT)
        .await
        .ok();
    let web = if is_local_open_url(&config.open_url) {
        fetch_web_runtime(config.host.as_str(), web_port).ok()
    } else {
        None
    };
    let tray = read_tray_record(paths)?.map(|record| {
        json!({
            "pid": record.pid,
            "host": record.host,
            "daemonPort": record.daemon_port,
            "openUrl": record.open_url,
            "running": process_is_running(record.pid),
            "startedAt": record.started_at
        })
    });

    json_output(&json!({
        "success": true,
        "openUrl": config.open_url,
        "web": {
            "url": if is_local_open_url(&config.open_url) { Some(format!("http://{}:{web_port}", config.host)) } else { None },
            "running": web.is_some(),
            "runtime": web
        },
        "daemon": {
            "url": daemon_config.base_url(),
            "running": daemon.is_some(),
            "status": daemon
        },
        "analytics": {
            "url": format!("http://{}:{}", daemon_config.host, DEFAULT_ANALYTICS_PORT),
            "running": analytics.is_some(),
            "snapshot": analytics
        },
        "tray": tray
    }))
}

async fn restart_stack(
    paths: &StatePaths,
    config: &SquadConfig,
    tray_requested: bool,
) -> Result<CommandOutput> {
    let stop_output = stop_stack(paths, config).await?;
    let start_output = start_stack(paths, config, false, tray_requested).await?;
    Ok(CommandOutput {
        code: stop_output.code.max(start_output.code),
        stdout: format!("{}{}", stop_output.stdout, start_output.stdout),
        stderr: format!("{}{}", stop_output.stderr, start_output.stderr),
    })
}

async fn stop_stack(paths: &StatePaths, config: &SquadConfig) -> Result<CommandOutput> {
    let web_port = web_port_from_open_url(&config.open_url).unwrap_or(DEFAULT_WEB_PORT);
    let daemon_config =
        daemon_config_from_record(paths, &stack_daemon_config(config, Some(web_port)));
    let mut code = 0;
    let mut output = Vec::new();

    if is_local_open_url(&config.open_url) {
        let result = serve_stop(paths, config, web_port).await?;
        if result.code != 0 {
            code = result.code;
        }
        output.push(result.stdout);
        output.push(result.stderr);
    }

    match terminate_squad_member_processes() {
        Ok(count) if count > 0 => output.push(format!(
            "Autohand Squad member processes stopped: {count}\n"
        )),
        Ok(_) => {}
        Err(error) => output.push(format!(
            "Autohand Squad member process cleanup skipped: {error:#}\n"
        )),
    }

    for result in [
        analytics_stop(paths, &daemon_config, DEFAULT_ANALYTICS_PORT).await?,
        stop(paths, &daemon_config).await?,
    ] {
        if result.code != 0 {
            code = result.code;
        }
        output.push(result.stdout);
        output.push(result.stderr);
    }

    match terminate_associated_squad_processes() {
        Ok(count) if count > 0 => output.push(format!(
            "Autohand Squad leftover processes stopped: {count}\n"
        )),
        Ok(_) => {}
        Err(error) => output.push(format!(
            "Autohand Squad leftover process cleanup skipped: {error:#}\n"
        )),
    }

    Ok(CommandOutput {
        code,
        stdout: output
            .into_iter()
            .filter(|item| !item.is_empty())
            .collect::<String>(),
        stderr: String::new(),
    })
}

async fn start(paths: &StatePaths, config: &SquadConfig) -> Result<CommandOutput> {
    if let Ok(status) = fetch_status(config).await {
        return Ok(CommandOutput::ok(format!(
            "Autohand Squad is already running at {}\nqueue: {}\n",
            status.url, status.queue_depth
        )));
    }

    let daemon = locate_daemon_binary(paths)?;
    spawn_daemon(paths, config, &daemon)?;
    for _ in 0..40 {
        if let Ok(status) = fetch_status(config).await {
            return Ok(CommandOutput::ok(format!(
                "Autohand Squad started at {}\nstate: {}\n",
                status.url,
                paths.root.display()
            )));
        }
        sleep(Duration::from_millis(100)).await;
    }

    Ok(CommandOutput::error(format!(
        "Autohand Squad daemon did not become ready. Logs: {}\n",
        paths.server_log.display()
    )))
}

async fn stop(paths: &StatePaths, config: &SquadConfig) -> Result<CommandOutput> {
    match post_lifecycle(config, "/stop").await {
        Ok(message) => Ok(CommandOutput::ok(format!("{}\n", message.message))),
        Err(_) => {
            if let Ok(Some(record)) = read_daemon_record(paths) {
                if record.host == config.host && record.port == config.port {
                    if terminate_process(record.pid) {
                        let _ = remove_daemon_record(paths);
                        return Ok(CommandOutput::ok("Autohand Squad daemon stopped\n"));
                    }
                    if !process_is_running(record.pid) {
                        let _ = remove_daemon_record(paths);
                    }
                }
            }
            Ok(CommandOutput::ok(
                "Autohand Squad daemon is already stopped\n",
            ))
        }
    }
}

async fn queue(paths: &StatePaths, config: &SquadConfig) -> Result<CommandOutput> {
    let daemon_config = daemon_config_from_record(paths, config);
    match fetch_queue(&daemon_config).await {
        Ok(queue) => json_output(&queue),
        Err(_) => {
            let items = read_queue_items(paths)?;
            json_output(&QueueResponse {
                success: true,
                items,
            })
        }
    }
}

async fn analytics_start(
    paths: &StatePaths,
    config: &SquadConfig,
    analytics_port: u16,
) -> Result<CommandOutput> {
    if let Ok(snapshot) = fetch_analytics(config, analytics_port).await {
        return Ok(CommandOutput::ok(format!(
            "Autohand Squad analytics is already running at http://{}:{}\ntracked events: {}\n",
            config.host, analytics_port, snapshot.telemetry.total_events
        )));
    }

    let analytics = locate_analytics_binary(paths)?;
    spawn_analytics(paths, config, analytics_port, &analytics)?;
    for _ in 0..40 {
        if let Ok(snapshot) = fetch_analytics(config, analytics_port).await {
            return Ok(CommandOutput::ok(format!(
                "Autohand Squad analytics started at http://{}:{}\nactive daemons: {}\n",
                config.host, analytics_port, snapshot.services.active_daemons
            )));
        }
        sleep(Duration::from_millis(100)).await;
    }

    Ok(CommandOutput::error(format!(
        "Autohand Squad analytics did not become ready. Logs: {}\n",
        paths.analytics_log.display()
    )))
}

async fn analytics_status(
    paths: &StatePaths,
    config: &SquadConfig,
    analytics_port: u16,
) -> Result<CommandOutput> {
    match fetch_analytics(config, analytics_port).await {
        Ok(snapshot) => json_output(&snapshot),
        Err(error) => {
            let snapshot = collect_analytics_snapshot(paths, "squad-cli-fallback");
            Ok(CommandOutput {
                code: 1,
                stdout: format!("{}\n", serde_json::to_string_pretty(&snapshot)?),
                stderr: format!(
                    "Autohand Squad analytics is not responding at http://{}:{}: {}\n",
                    config.host, analytics_port, error
                ),
            })
        }
    }
}

async fn analytics_stop(
    paths: &StatePaths,
    config: &SquadConfig,
    analytics_port: u16,
) -> Result<CommandOutput> {
    if post_to::<serde_json::Value>(
        config.host.as_str(),
        analytics_port,
        "POST",
        "/stop",
        Some(""),
    )
    .is_ok()
    {
        for _ in 0..30 {
            if fetch_analytics(config, analytics_port).await.is_err() {
                let _ = remove_analytics_record(paths);
                return Ok(CommandOutput::ok("Autohand Squad analytics stopped\n"));
            }
            sleep(Duration::from_millis(100)).await;
        }
    }

    if let Ok(Some(record)) = crate::state::read_analytics_record(paths) {
        if record.host == config.host
            && record.port == analytics_port
            && terminate_process(record.pid)
        {
            let _ = remove_analytics_record(paths);
            return Ok(CommandOutput::ok("Autohand Squad analytics stopped\n"));
        }
        if record.host == config.host
            && record.port == analytics_port
            && !process_is_running(record.pid)
        {
            let _ = remove_analytics_record(paths);
        }
    }

    Ok(CommandOutput::ok(
        "Autohand Squad analytics is already stopped\n",
    ))
}

async fn serve(
    paths: &StatePaths,
    config: &SquadConfig,
    server_path: Option<PathBuf>,
    dev: bool,
    web_port: u16,
) -> Result<CommandOutput> {
    if fetch_web_runtime(config.host.as_str(), web_port).is_ok() {
        return Ok(CommandOutput::ok(format!(
            "Autohand Squad web server is already running at http://{}:{}\n",
            config.host, web_port
        )));
    }

    let server_path = locate_web_server(paths, server_path)?;
    if !dev {
        let dist_index = server_path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join("dist")
            .join("index.html");
        if !dist_index.exists() {
            return Ok(CommandOutput::error(format!(
                "Autohand Squad web build was not found at {}. Build the app once, or run `squad serve --dev`.\n",
                dist_index.display()
            )));
        }
    }
    spawn_web_server(paths, config, &server_path, dev, web_port)?;
    for _ in 0..50 {
        if fetch_web_runtime(config.host.as_str(), web_port).is_ok() {
            return Ok(CommandOutput::ok(format!(
                "Autohand Squad web server started at http://{}:{}\n",
                config.host, web_port
            )));
        }
        sleep(Duration::from_millis(100)).await;
    }

    Ok(CommandOutput::error(format!(
        "Autohand Squad web server did not become ready. Logs: {}\n",
        paths.web_server_log.display()
    )))
}

async fn serve_status(
    paths: &StatePaths,
    config: &SquadConfig,
    web_port: u16,
) -> Result<CommandOutput> {
    match fetch_web_runtime(config.host.as_str(), web_port) {
        Ok(runtime) => json_output(&runtime),
        Err(_) => {
            let record = read_web_server_record(paths)?;
            let message = match record {
                Some(record) if record.port == web_port && record.host == config.host => format!(
                    "Autohand Squad web server is not responding at http://{}:{}. Last server pid: {}\n",
                    config.host, web_port, record.pid
                ),
                None => format!(
                    "Autohand Squad web server is not running at http://{}:{}\n",
                    config.host, web_port
                ),
                Some(_) => format!(
                    "Autohand Squad web server is not running at http://{}:{}\n",
                    config.host, web_port
                ),
            };
            Ok(CommandOutput::error(message))
        }
    }
}

async fn serve_stop(
    paths: &StatePaths,
    config: &SquadConfig,
    web_port: u16,
) -> Result<CommandOutput> {
    if let Ok(response) = post_to::<WebShutdownResponse>(
        config.host.as_str(),
        web_port,
        "POST",
        "/api/shutdown",
        Some(""),
    ) {
        let stopped_runs = response.data.map(|data| data.stopped_runs).unwrap_or(0);
        if wait_for_web_stop(config.host.as_str(), web_port).await {
            let _ = remove_web_server_record(paths);
            return Ok(CommandOutput::ok(format!(
                "Autohand Squad web server stopped at http://{}:{}\nAutohand Squad managed web runs stopped: {}\n",
                config.host, web_port, stopped_runs
            )));
        }
    }

    if let Ok(Some(record)) = read_web_server_record(paths) {
        if record.host == config.host && record.port == web_port && terminate_process(record.pid) {
            let _ = wait_for_web_stop(config.host.as_str(), web_port).await;
            let _ = remove_web_server_record(paths);
            return Ok(CommandOutput::ok(format!(
                "Autohand Squad web server stopped at http://{}:{}\n",
                config.host, web_port
            )));
        }
    }

    match fetch_web_runtime(config.host.as_str(), web_port) {
        Ok(runtime) if is_squad_web_runtime(&runtime) => {
            if terminate_squad_web_listener(web_port) {
                if wait_for_web_stop(config.host.as_str(), web_port).await {
                    let _ = remove_web_server_record(paths);
                    return Ok(CommandOutput::ok(format!(
                        "Autohand Squad web server stopped at http://{}:{}\n",
                        config.host, web_port
                    )));
                }
            }
        }
        Ok(_) => {}
        Err(_) => {
            let _ = remove_web_server_record(paths);
            return Ok(CommandOutput::ok(
                "Autohand Squad web server is already stopped\n",
            ));
        }
    }

    if fetch_web_runtime(config.host.as_str(), web_port).is_err() {
        let _ = remove_web_server_record(paths);
        return Ok(CommandOutput::ok(
            "Autohand Squad web server is already stopped\n",
        ));
    }

    Ok(CommandOutput::error(format!(
        "Autohand Squad web server is still responding at http://{}:{} but no managed pid was found\n",
        config.host, web_port
    )))
}

async fn fetch_status(config: &SquadConfig) -> Result<StatusResponse> {
    local_json_request(config, "GET", "/status", None)
}

async fn fetch_queue(config: &SquadConfig) -> Result<QueueResponse> {
    local_json_request(config, "GET", "/queue", None)
}

async fn post_lifecycle(
    config: &SquadConfig,
    path: &str,
) -> Result<crate::daemon::LifecycleResponse> {
    local_json_request(config, "POST", path, Some(""))
}

pub(crate) fn local_json_request<T>(
    config: &SquadConfig,
    method: &str,
    path: &str,
    body: Option<&str>,
) -> Result<T>
where
    T: DeserializeOwned,
{
    post_to(config.host.as_str(), config.port, method, path, body)
}

fn post_to<T>(host: &str, port: u16, method: &str, path: &str, body: Option<&str>) -> Result<T>
where
    T: DeserializeOwned,
{
    let mut stream = TcpStream::connect((host, port))
        .with_context(|| format!("connect http://{host}:{port}"))?;
    stream.set_read_timeout(Some(Duration::from_millis(800)))?;
    stream.set_write_timeout(Some(Duration::from_millis(800)))?;
    let body = body.unwrap_or("");
    let request = format!(
        "{method} {path} HTTP/1.1\r\nHost: {}:{}\r\nAccept: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        host,
        port,
        body.len(),
        body
    );
    stream.write_all(request.as_bytes())?;
    let mut response = String::new();
    stream.read_to_string(&mut response)?;
    let (headers, body) = response
        .split_once("\r\n\r\n")
        .ok_or_else(|| anyhow!("invalid HTTP response"))?;
    let status = headers
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(0);
    if !(200..300).contains(&status) {
        bail!("{path} request failed with HTTP {status}");
    }
    serde_json::from_str(body).with_context(|| format!("parse {path} response"))
}

async fn fetch_analytics(config: &SquadConfig, analytics_port: u16) -> Result<AnalyticsSnapshot> {
    post_to(
        config.host.as_str(),
        analytics_port,
        "GET",
        "/metrics",
        None,
    )
}

fn fetch_web_runtime(host: &str, web_port: u16) -> Result<serde_json::Value> {
    post_to(host, web_port, "GET", "/api/runtime", None)
}

async fn wait_for_web_stop(host: &str, web_port: u16) -> bool {
    for _ in 0..25 {
        if fetch_web_runtime(host, web_port).is_err() {
            return true;
        }
        sleep(Duration::from_millis(100)).await;
    }
    false
}

fn is_squad_web_runtime(value: &serde_json::Value) -> bool {
    value.get("success").and_then(|item| item.as_bool()) == Some(true)
        && value
            .pointer("/data/squadWorkspaceRoot")
            .and_then(|item| item.as_str())
            .is_some()
        && value
            .pointer("/data/autohandPath")
            .and_then(|item| item.as_str())
            .is_some()
}

fn terminate_squad_member_processes() -> Result<usize> {
    #[cfg(target_family = "unix")]
    {
        let output = Command::new("ps")
            .args(["-axo", "pid=,command="])
            .output()
            .context("list Squad member processes")?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut stopped = 0;
        for pid in squad_member_pids_from_process_list(&stdout, std::process::id()) {
            if terminate_process(pid) {
                stopped += 1;
            }
        }
        Ok(stopped)
    }

    #[cfg(target_os = "windows")]
    {
        let output = Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                r#"Get-CimInstance Win32_Process | ForEach-Object { if ($_.CommandLine) { "$($_.ProcessId)`t$($_.CommandLine)" } }"#,
            ])
            .output()
            .context("list Squad member processes")?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut stopped = 0;
        for pid in squad_member_pids_from_process_list(&stdout, std::process::id()) {
            if terminate_process(pid) {
                stopped += 1;
            }
        }
        Ok(stopped)
    }

    #[cfg(not(any(target_family = "unix", target_os = "windows")))]
    {
        Ok(0)
    }
}

fn terminate_associated_squad_processes() -> Result<usize> {
    #[cfg(target_family = "unix")]
    {
        let output = Command::new("ps")
            .args(["-axo", "pid=,command="])
            .output()
            .context("list Autohand Squad processes")?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut stopped = 0;
        for pid in associated_squad_pids_from_process_list(&stdout, std::process::id()) {
            if terminate_process(pid) {
                stopped += 1;
            }
        }
        Ok(stopped)
    }

    #[cfg(target_os = "windows")]
    {
        let output = Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                r#"Get-CimInstance Win32_Process | ForEach-Object { if ($_.CommandLine) { "$($_.ProcessId)`t$($_.CommandLine)" } }"#,
            ])
            .output()
            .context("list Autohand Squad processes")?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut stopped = 0;
        for pid in associated_squad_pids_from_process_list(&stdout, std::process::id()) {
            if terminate_process(pid) {
                stopped += 1;
            }
        }
        Ok(stopped)
    }

    #[cfg(not(any(target_family = "unix", target_os = "windows")))]
    {
        Ok(0)
    }
}

fn squad_member_pids_from_process_list(output: &str, current_pid: u32) -> Vec<u32> {
    output
        .lines()
        .filter_map(parse_ps_pid_and_command)
        .filter(|(pid, _)| *pid != current_pid)
        .filter(|(_, command)| is_squad_member_process(command))
        .map(|(pid, _)| pid)
        .collect()
}

fn associated_squad_pids_from_process_list(output: &str, current_pid: u32) -> Vec<u32> {
    output
        .lines()
        .filter_map(parse_ps_pid_and_command)
        .filter(|(pid, _)| *pid != current_pid)
        .filter(|(_, command)| is_associated_squad_process(command))
        .map(|(pid, _)| pid)
        .collect()
}

fn parse_ps_pid_and_command(line: &str) -> Option<(u32, &str)> {
    let trimmed = line.trim_start();
    let split_at = trimmed.find(char::is_whitespace)?;
    let pid = trimmed[..split_at].parse::<u32>().ok()?;
    Some((pid, trimmed[split_at..].trim_start()))
}

fn is_squad_member_process(command: &str) -> bool {
    let command = command.replace("\\012", "\n");
    let command = command.replace('\\', "/");
    let lower = command.to_ascii_lowercase().replace(['"', '\''], "");
    let is_autohand = is_autohand_cli_process(&lower);
    let is_squad_runtime = lower.contains("autohand-squad-daemon")
        || lower.contains("autohand-squad-analytics")
        || lower.contains("autohand-squad-tray")
        || lower.contains("autohand-squad-ui");
    is_autohand
        && !is_squad_runtime
        && (lower.contains(".autohand/agents/")
            || lower.contains(".autohandsquad/data/workers/")
            || lower.contains("autohand_client_name=autohand-squad-")
            || lower.contains("autohand squad member profile"))
}

fn is_autohand_cli_process(lower: &str) -> bool {
    lower.starts_with("autohand ")
        || lower.starts_with("autohand.exe ")
        || lower.starts_with("autohand.cmd ")
        || lower.ends_with("/autohand")
        || lower.ends_with("/autohand.exe")
        || lower.ends_with("/autohand.cmd")
        || lower.contains("/autohand ")
        || lower.contains("/autohand.exe ")
        || lower.contains("/autohand.cmd ")
        || lower.contains(" autohand ")
        || lower.contains(" autohand.exe ")
        || lower.contains(" autohand.cmd ")
        || lower.contains("/autohand-cli/")
        || lower.contains("\\autohand-cli\\")
        || lower.contains("@autohandai/autohand")
        || lower.contains("@autohandai/cli")
}

fn is_associated_squad_process(command: &str) -> bool {
    is_squad_member_process(command)
        || is_squad_runtime_process(command)
        || is_squad_web_process(command)
}

fn is_squad_runtime_process(command: &str) -> bool {
    let command = command.replace('\\', "/");
    let lower = command.to_ascii_lowercase().replace(['"', '\''], "");
    lower.contains("autohand-squad-daemon")
        || lower.contains("autohand-squad-analytics")
        || lower.contains("autohand-squad-tray")
        || lower.contains("autohand-squad-ui")
}

fn terminate_squad_web_listener(web_port: u16) -> bool {
    for pid in listener_pids_for_port(web_port) {
        if process_command(pid)
            .as_deref()
            .is_some_and(is_squad_web_process)
            && terminate_process(pid)
        {
            return true;
        }
    }
    false
}

fn listener_pids_for_port(web_port: u16) -> Vec<u32> {
    #[cfg(target_family = "unix")]
    {
        let port_filter = format!("-iTCP:{web_port}");
        Command::new("lsof")
            .args(["-nP", &port_filter, "-sTCP:LISTEN", "-t"])
            .output()
            .ok()
            .map(|output| listener_pids_from_lsof_output(&String::from_utf8_lossy(&output.stdout)))
            .unwrap_or_default()
    }

    #[cfg(not(target_family = "unix"))]
    {
        Vec::new()
    }
}

fn process_command(pid: u32) -> Option<String> {
    #[cfg(target_family = "unix")]
    {
        Command::new("ps")
            .args(["-p", &pid.to_string(), "-o", "command="])
            .output()
            .ok()
            .and_then(|output| {
                if output.status.success() {
                    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
                } else {
                    None
                }
            })
    }

    #[cfg(not(target_family = "unix"))]
    {
        None
    }
}

fn listener_pids_from_lsof_output(output: &str) -> Vec<u32> {
    output
        .lines()
        .filter_map(|line| line.trim().parse::<u32>().ok())
        .collect()
}

fn is_squad_web_process(command: &str) -> bool {
    let command = command.replace('\\', "/");
    let lower = command.to_ascii_lowercase();
    lower.contains("server.mjs")
        && (lower.contains("autohandswe")
            || lower.contains("autohand squad.app/contents/resources/server.mjs")
            || lower.contains("autohand squad/server.mjs"))
}

fn daemon_config_from_record(paths: &StatePaths, config: &SquadConfig) -> SquadConfig {
    let mut next = config.clone();
    if let Ok(Some(record)) = read_daemon_record(paths) {
        next.host = record.host;
        next.port = record.port;
    }
    next
}

fn stack_daemon_config(config: &SquadConfig, web_port: Option<u16>) -> SquadConfig {
    let mut next = config.clone();
    if web_port.is_some_and(|port| port == next.port) {
        next.port = next.port.saturating_add(1).max(1);
        next.fixed_port = Some(next.port);
    }
    next
}

fn web_port_from_open_url(open_url: &str) -> Option<u16> {
    let after_scheme = open_url
        .strip_prefix("http://")
        .or_else(|| open_url.strip_prefix("https://"))?;
    let authority = after_scheme.split('/').next().unwrap_or(after_scheme);
    let port = authority.rsplit_once(':')?.1;
    port.parse::<u16>().ok()
}

fn is_local_open_url(open_url: &str) -> bool {
    let Some(after_scheme) = open_url
        .strip_prefix("http://")
        .or_else(|| open_url.strip_prefix("https://"))
    else {
        return false;
    };
    let host = after_scheme
        .split('/')
        .next()
        .unwrap_or(after_scheme)
        .split(':')
        .next()
        .unwrap_or("");
    matches!(host, "127.0.0.1" | "localhost" | "[::1]")
}

fn locate_daemon_binary(paths: &StatePaths) -> Result<PathBuf> {
    if let Ok(value) = std::env::var("AUTOHAND_SQUAD_DAEMON") {
        let candidate = PathBuf::from(value);
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    let exe_name = if cfg!(windows) {
        "autohand-squad-daemon.exe"
    } else {
        "autohand-squad-daemon"
    };

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(dir) = current_exe.parent() {
            let sibling = dir.join(exe_name);
            if sibling.exists() {
                return Ok(sibling);
            }
        }
    }

    let installed = paths.bin_dir.join(exe_name);
    if installed.exists() {
        return Ok(installed);
    }

    find_on_path(exe_name).ok_or_else(|| {
        anyhow!(
            "autohand-squad-daemon was not found. Install the Squad runtime under {} or set AUTOHAND_SQUAD_DAEMON.",
            paths.bin_dir.display()
        )
    })
}

fn locate_analytics_binary(paths: &StatePaths) -> Result<PathBuf> {
    if let Ok(value) = std::env::var("AUTOHAND_SQUAD_ANALYTICS") {
        let candidate = PathBuf::from(value);
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    let exe_name = if cfg!(windows) {
        "autohand-squad-analytics.exe"
    } else {
        "autohand-squad-analytics"
    };

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(dir) = current_exe.parent() {
            let sibling = dir.join(exe_name);
            if sibling.exists() {
                return Ok(sibling);
            }
        }
    }

    let installed = paths.bin_dir.join(exe_name);
    if installed.exists() {
        return Ok(installed);
    }

    find_on_path(exe_name).ok_or_else(|| {
        anyhow!(
            "autohand-squad-analytics was not found. Install the Squad runtime under {} or set AUTOHAND_SQUAD_ANALYTICS.",
            paths.bin_dir.display()
        )
    })
}

fn locate_tray_binary(paths: &StatePaths) -> Result<PathBuf> {
    if let Ok(value) = std::env::var("AUTOHAND_SQUAD_TRAY") {
        let candidate = PathBuf::from(value);
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    let exe_name = if cfg!(windows) {
        "autohand-squad-tray.exe"
    } else {
        "autohand-squad-tray"
    };

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(dir) = current_exe.parent() {
            let sibling = dir.join(exe_name);
            if sibling.exists() {
                return Ok(sibling);
            }
        }
    }

    let installed = paths.bin_dir.join(exe_name);
    if installed.exists() {
        return Ok(installed);
    }

    find_on_path(exe_name).ok_or_else(|| {
        anyhow!(
            "autohand-squad-tray was not found. Install the Squad runtime under {} or set AUTOHAND_SQUAD_TRAY.",
            paths.bin_dir.display()
        )
    })
}

fn locate_web_server(paths: &StatePaths, server_path: Option<PathBuf>) -> Result<PathBuf> {
    if let Some(candidate) = server_path {
        if candidate.exists() {
            return candidate
                .canonicalize()
                .with_context(|| format!("resolve {}", candidate.display()));
        }
        bail!("web server file was not found at {}", candidate.display());
    }

    if let Ok(value) = std::env::var("AUTOHAND_SQUAD_WEB_SERVER") {
        let candidate = PathBuf::from(value);
        if candidate.exists() {
            return candidate
                .canonicalize()
                .with_context(|| format!("resolve {}", candidate.display()));
        }
    }

    web_server_candidates(paths)
        .into_iter()
        .find(|candidate| candidate.exists())
        .ok_or_else(|| anyhow!("server.mjs was not found. Run from the autohandSWE prototype directory or set AUTOHAND_SQUAD_WEB_SERVER."))?
        .canonicalize()
        .context("resolve server.mjs")
}

fn web_server_candidates(paths: &StatePaths) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    // Installed applications must prefer their immutable bundled resources
    // even when launched from a source checkout that also has server.mjs.
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            candidates.extend(packaged_resource_candidates_from(exe_dir));
        }
    }
    candidates.push(paths.root.join("web").join("server.mjs"));
    candidates.push(paths.root.join("server.mjs"));

    if let Ok(current_dir) = std::env::current_dir() {
        candidates.extend(server_candidates_from(&current_dir));
    }
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            candidates.extend(server_candidates_from(exe_dir));
        }
    }
    candidates
}

fn packaged_resource_candidates_from(exe_dir: &Path) -> Vec<PathBuf> {
    let mut candidates = vec![exe_dir.join("server.mjs")];
    if let Some(contents_dir) = exe_dir.parent() {
        candidates.push(contents_dir.join("Resources").join("server.mjs"));
    }
    candidates
}

fn server_candidates_from(root: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    for dir in root.ancestors().take(8) {
        candidates.push(dir.join("server.mjs"));
        candidates.push(
            dir.join("web")
                .join("prototypes")
                .join("autohandSWE")
                .join("server.mjs"),
        );
    }
    candidates
}

fn find_on_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(name))
        .find(|candidate| candidate.exists())
}

fn node_executable_name() -> &'static str {
    if cfg!(windows) {
        "node.exe"
    } else {
        "node"
    }
}

fn locate_node_runtime() -> Result<PathBuf> {
    if let Ok(value) = std::env::var("AUTOHAND_SQUAD_NODE") {
        let candidate = PathBuf::from(value);
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    let executable_name = node_executable_name();
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            let bundled = exe_dir.join(executable_name);
            if bundled.exists() {
                return Ok(bundled);
            }
        }
    }

    find_on_path(executable_name).ok_or_else(|| {
        anyhow!(
            "Node.js was not found. Reinstall Autohand Squad or set AUTOHAND_SQUAD_NODE to a Node.js 18.17+ executable."
        )
    })
}

fn is_bundled_node_runtime(node_runtime: &Path) -> bool {
    let Ok(current_exe) = std::env::current_exe() else {
        return false;
    };
    current_exe.parent() == node_runtime.parent()
}

fn bundled_autohand_cli_name() -> Option<&'static str> {
    if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        Some("autohand-macos-arm64")
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        Some("autohand-macos-x64")
    } else if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        Some("autohand-windows-x64.exe")
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        Some("autohand-linux-x64")
    } else {
        None
    }
}

fn bundled_autohand_cli(server_path: &Path) -> Option<PathBuf> {
    let name = bundled_autohand_cli_name()?;
    let server_dir = server_path.parent()?;
    let candidate = server_dir
        .join("node_modules")
        .join("@autohandai")
        .join("agent-sdk")
        .join("cli")
        .join(name);
    candidate.exists().then_some(candidate)
}

fn spawn_daemon(paths: &StatePaths, config: &SquadConfig, daemon: &Path) -> Result<()> {
    paths.ensure()?;
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&paths.server_log)
        .with_context(|| format!("open {}", paths.server_log.display()))?;
    let err = log.try_clone()?;
    let mut command = Command::new(daemon);
    command
        .arg("--host")
        .arg(&config.host)
        .arg("--port")
        .arg(config.port.to_string())
        .arg("--open-url")
        .arg(&config.open_url)
        .arg("--launch-at-login-policy")
        .arg(&config.launch_at_login_policy)
        .arg("--telemetry-policy")
        .arg(&config.telemetry_policy)
        .arg("--api-base-url")
        .arg(&config.api_base_url)
        .arg("--update-channel")
        .arg(&config.update_channel)
        .arg("--account-email")
        .arg(config.account_email.as_deref().unwrap_or(""))
        .arg("--plan-state")
        .arg(&config.plan_state)
        .env("AUTOHAND_SQUAD_HOME", &paths.root)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(err));
    if let Ok(server_path) = locate_web_server(paths, None) {
        command.env("AUTOHAND_SQUAD_WEB_SERVER", &server_path);
        if let Some(autohand) = bundled_autohand_cli(&server_path) {
            command.env("AUTOHAND_SQUAD_AUTOHAND_BIN", autohand);
        }
    }
    detach_background(&mut command);
    command
        .spawn()
        .with_context(|| format!("start {}", daemon.display()))?;
    Ok(())
}

fn spawn_analytics(
    paths: &StatePaths,
    config: &SquadConfig,
    analytics_port: u16,
    analytics: &Path,
) -> Result<()> {
    paths.ensure()?;
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&paths.analytics_log)
        .with_context(|| format!("open {}", paths.analytics_log.display()))?;
    let err = log.try_clone()?;
    let mut command = Command::new(analytics);
    command
        .arg("--host")
        .arg(&config.host)
        .arg("--port")
        .arg(analytics_port.to_string())
        .env("AUTOHAND_SQUAD_HOME", &paths.root)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(err));
    detach_background(&mut command);
    command
        .spawn()
        .with_context(|| format!("start {}", analytics.display()))?;
    Ok(())
}

fn spawn_tray(
    paths: &StatePaths,
    daemon_config: &SquadConfig,
    open_url: &str,
) -> Result<Option<String>> {
    if let Ok(Some(record)) = read_tray_record(paths) {
        if process_is_running(record.pid) {
            return Ok(None);
        }
    }

    let tray = locate_tray_binary(paths)?;
    paths.ensure()?;
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&paths.tray_log)
        .with_context(|| format!("open {}", paths.tray_log.display()))?;
    let err = log.try_clone()?;
    let mut command = Command::new(&tray);
    command
        .arg("--host")
        .arg(&daemon_config.host)
        .arg("--port")
        .arg(daemon_config.port.to_string())
        .arg("--open-url")
        .arg(open_url)
        .arg("--api-base-url")
        .arg(&daemon_config.api_base_url)
        .arg("--update-channel")
        .arg(&daemon_config.update_channel)
        .arg("--launch-at-login-policy")
        .arg(&daemon_config.launch_at_login_policy)
        .arg("--telemetry-policy")
        .arg(&daemon_config.telemetry_policy)
        .arg("--account-email")
        .arg(daemon_config.account_email.as_deref().unwrap_or(""))
        .arg("--plan-state")
        .arg(&daemon_config.plan_state)
        .env("AUTOHAND_SQUAD_HOME", &paths.root)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(err));
    if let Ok(server_path) = locate_web_server(paths, None) {
        command.env("AUTOHAND_SQUAD_WEB_SERVER", &server_path);
        if let Some(autohand) = bundled_autohand_cli(&server_path) {
            command.env("AUTOHAND_SQUAD_AUTOHAND_BIN", autohand);
        }
    }
    detach_background(&mut command);
    let child = command
        .spawn()
        .with_context(|| format!("start {}", tray.display()))?;
    let record = TrayRecord {
        pid: child.id(),
        host: daemon_config.host.clone(),
        daemon_port: daemon_config.port,
        open_url: open_url.to_string(),
        started_at: crate::state::now_string(),
    };
    write_tray_record(paths, &record)?;
    Ok(Some("Autohand Squad tray started\n".to_string()))
}

fn spawn_web_server(
    paths: &StatePaths,
    config: &SquadConfig,
    server_path: &Path,
    dev: bool,
    web_port: u16,
) -> Result<()> {
    paths.ensure()?;
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&paths.web_server_log)
        .with_context(|| format!("open {}", paths.web_server_log.display()))?;
    let err = log.try_clone()?;
    let server_dir = server_path.parent().unwrap_or_else(|| Path::new("."));
    let node_runtime = locate_node_runtime()?;
    let mut command = Command::new(&node_runtime);
    command
        .arg(server_path)
        .arg("--host")
        .arg(&config.host)
        .arg("--port")
        .arg(web_port.to_string())
        .current_dir(server_dir)
        .env("AUTOHAND_SQUAD_HOME", &paths.root)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(err));
    if is_bundled_node_runtime(&node_runtime) {
        command.env("AUTOHAND_SQUAD_APP_STATE_DIR", paths.root.join("web-state"));
    }
    if let Some(autohand) = bundled_autohand_cli(server_path) {
        command.env("AUTOHAND_SQUAD_AUTOHAND_BIN", autohand);
    }
    if let Ok(tray) = locate_tray_binary(paths) {
        command.env("AUTOHAND_SQUAD_TRAY", tray);
    }
    if dev {
        command.arg("--dev");
    }
    detach_background(&mut command);
    let child = command
        .spawn()
        .with_context(|| format!("start {} {}", node_runtime.display(), server_path.display()))?;
    let record = WebServerRecord {
        pid: child.id(),
        host: config.host.clone(),
        port: web_port,
        url: format!("http://{}:{}", config.host, web_port),
        server_path: server_path.display().to_string(),
        dev,
        started_at: crate::state::now_string(),
    };
    write_web_server_record(paths, &record)?;
    Ok(())
}

fn detach_background(command: &mut Command) {
    #[cfg(target_family = "unix")]
    unsafe {
        command.pre_exec(|| {
            if libc::setsid() == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
}

fn terminate_process(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }

    #[cfg(target_family = "unix")]
    {
        let signaled = Command::new("kill")
            .arg(pid.to_string())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false);
        if !signaled {
            return false;
        }
        if wait_for_process_exit(pid, 20) {
            return true;
        }
        let killed = Command::new("kill")
            .args(["-KILL", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false);
        killed && wait_for_process_exit(pid, 20)
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }

    #[cfg(not(any(target_family = "unix", target_os = "windows")))]
    {
        false
    }
}

fn wait_for_process_exit(pid: u32, attempts: usize) -> bool {
    for _ in 0..attempts {
        if !process_is_running(pid) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    false
}

fn process_is_running(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }

    #[cfg(target_family = "unix")]
    {
        Command::new("kill")
            .arg("-0")
            .arg(pid.to_string())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}")])
            .output()
            .map(|output| String::from_utf8_lossy(&output.stdout).contains(&pid.to_string()))
            .unwrap_or(false)
    }

    #[cfg(not(any(target_family = "unix", target_os = "windows")))]
    {
        true
    }
}

fn open_url(url: &str) -> Result<()> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(url);
        command
    };

    #[cfg(target_os = "linux")]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(url);
        command
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("cmd");
        command.args(["/C", "start", "", url]);
        command
    };

    command.spawn().context("open Squad URL")?;
    Ok(())
}

fn json_output<T: Serialize>(value: &T) -> Result<CommandOutput> {
    Ok(CommandOutput::ok(format!(
        "{}\n",
        serde_json::to_string_pretty(value)?
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::StatePaths;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_state_paths() -> StatePaths {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        StatePaths::from_root(std::env::temp_dir().join(format!(
            "autohand-squad-cli-test-{}-{nonce}",
            std::process::id()
        )))
    }

    fn cli(command: SquadCommand) -> SquadCli {
        SquadCli {
            host: None,
            port: None,
            fixed_port: None,
            open_url: None,
            hosted_ui_url: None,
            proxy_url: None,
            api_gateway_url: None,
            api_base_url: None,
            api_auth_token: None,
            company_secret: None,
            update_channel: None,
            launch_at_login_policy: None,
            telemetry_policy: None,
            account_email: None,
            plan_state: None,
            command: Some(command),
        }
    }

    #[tokio::test]
    async fn config_command_prints_resolved_config() {
        let paths = temp_state_paths();
        let mut args = cli(SquadCommand::Config);
        args.port = Some(19821);
        let cleanup_root = paths.root.clone();
        let output = run_squad_command_with_paths(args, paths).await.unwrap();

        assert_eq!(output.code, 0);
        assert!(output.stdout.contains("\"port\": 19821"));
        assert!(output.stdout.contains("\"updateChannel\": \"stable\""));
        let _ = fs::remove_dir_all(cleanup_root);
    }

    #[tokio::test]
    async fn queue_command_falls_back_to_local_queue_directory() {
        let paths = temp_state_paths();
        paths.ensure().unwrap();
        let cleanup_root = paths.root.clone();
        fs::write(
            paths.queue_dir.join("one.json"),
            r#"{"id":"one","status":"queued"}"#,
        )
        .unwrap();

        let mut args = cli(SquadCommand::Queue);
        args.host = Some("127.0.0.1".to_string());
        args.port = Some(0);
        let output = run_squad_command_with_paths(args, paths).await.unwrap();

        assert_eq!(output.code, 0);
        assert!(output.stdout.contains("\"id\": \"one\""));
        assert!(output.stdout.contains("\"success\": true"));
        let _ = fs::remove_dir_all(cleanup_root);
    }

    #[test]
    fn detects_squad_member_processes_without_matching_runtime_binaries() {
        assert!(is_squad_member_process(
            "autohand --path /tmp/work --config /repo/.autohand/agents/b3/config.json --prompt hi"
        ));
        assert!(is_squad_member_process(
            r#"C:\Users\me\.local\bin\autohand.exe --path C:\repo --config C:\repo\.autohand\agents\b3\config.json --prompt hi"#
        ));
        assert!(is_squad_member_process(
            r#""C:\Users\me\.local\bin\autohand.exe" --path C:\repo --config C:\repo\.autohand\agents\b3\config.json --prompt hi"#
        ));
        assert!(is_squad_member_process(
            "autohand --path /Users/me/.autohandsquad/data/workers/b3 --append-sys-prompt Autohand Squad member profile"
        ));
        assert!(is_squad_member_process(
            r#"cmd /C set AUTOHAND_CLIENT_NAME=autohand-squad-b3 && C:\bin\autohand.exe --path C:\repo"#
        ));
        assert!(is_squad_member_process(
            r#"C:\Users\me\AppData\Roaming\npm\autohand.cmd --path C:\repo --config C:\repo\.autohand\agents\b3\config.json --prompt hi"#
        ));
        assert!(is_squad_member_process(
            "node /Users/me/.npm/_npx/123/node_modules/autohand-cli/dist/index.js --path /repo --config /repo/.autohand/agents/b3/config.json --prompt hi"
        ));
        assert!(is_squad_member_process(
            "bun /Users/me/project/node_modules/@autohandai/cli/dist/index.js --path /repo --config /repo/.autohand/agents/b3/config.json --prompt hi"
        ));
        assert!(!is_squad_member_process(
            "/Users/me/.autohand/squad/bin/autohand-squad-tray --port 19822"
        ));
        assert!(!is_squad_member_process("node server.mjs --port 19821"));
        assert!(!is_squad_member_process(
            "node /Users/me/.npm/_npx/123/node_modules/autohand-cli/dist/index.js --path /tmp/other --prompt hi"
        ));
    }

    #[test]
    fn parses_squad_member_pids_from_ps_output() {
        let output = "\
 123 node server.mjs --port 19821
 456 autohand --path /tmp/work --config /repo/.autohand/agents/b3/config.json
 789 /Users/me/.autohand/squad/bin/autohand-squad-daemon --port 19822
 101 C:\\Users\\me\\.local\\bin\\autohand.exe --config C:\\repo\\.autohand\\agents\\b3\\config.json
 202 node /Users/me/node_modules/autohand-cli/dist/index.js --config /repo/.autohand/agents/b4/config.json
	";
        assert_eq!(
            squad_member_pids_from_process_list(output, 0),
            vec![456, 101, 202]
        );
    }

    #[test]
    fn detects_associated_squad_processes_for_quit_cleanup() {
        assert!(is_associated_squad_process(
            "/Users/me/.autohand/squad/bin/autohand-squad-daemon --port 19822"
        ));
        assert!(is_associated_squad_process(
            "C:\\Users\\me\\.autohand\\squad\\bin\\autohand-squad-analytics.exe --port 19823"
        ));
        assert!(is_associated_squad_process(
            "/Users/me/.autohand/squad/bin/autohand-squad-tray --port 19822"
        ));
        assert!(is_associated_squad_process(
            "node /Users/me/Documents/autohand/web/prototypes/autohandSWE/server.mjs --port 19821"
        ));
        assert!(is_associated_squad_process(
            "autohand --path /tmp/work --config /repo/.autohand/agents/b3/config.json --prompt hi"
        ));
        assert!(!is_associated_squad_process(
            "autohand --path /tmp/other --prompt not a squad member"
        ));
        assert!(!is_associated_squad_process(
            "/Users/me/.local/bin/not-autohand --prompt hi"
        ));
    }

    #[test]
    fn associated_cleanup_skips_current_process() {
        let output = "\
 111 /Users/me/.autohand/squad/bin/autohand-squad-tray --port 19822
 222 node /Users/me/Documents/autohand/web/prototypes/autohandSWE/server.mjs --port 19821
 333 autohand --path /tmp/work --config /repo/.autohand/agents/b3/config.json
";
        assert_eq!(
            associated_squad_pids_from_process_list(output, 111),
            vec![222, 333]
        );
    }

    #[test]
    fn detects_squad_web_runtime_payload() {
        let payload = json!({
            "success": true,
            "data": {
                "autohandPath": "/Users/me/.local/bin/autohand",
                "squadWorkspaceRoot": "/Users/me/.autohandsquad"
            }
        });
        assert!(is_squad_web_runtime(&payload));
        assert!(!is_squad_web_runtime(&json!({"success": true, "data": {}})));
        assert!(is_squad_web_process(
            "node /Applications/Autohand Squad.app/Contents/Resources/server.mjs --port 19821"
        ));
        assert!(is_squad_web_process(
            r#"node.exe C:\Users\me\AppData\Local\Autohand Squad\server.mjs --port 19821"#
        ));
    }

    #[test]
    fn web_server_candidates_cover_state_and_binary_ancestor_layouts() {
        let paths = StatePaths::from_root("/tmp/autohand-squad");
        let candidates = web_server_candidates(&paths);

        assert!(candidates.contains(&PathBuf::from("/tmp/autohand-squad/web/server.mjs")));
        assert!(server_candidates_from(Path::new(
            "/Users/me/Documents/autohand/web/prototypes/autohandSWE/daemon/target/debug"
        ))
        .contains(&PathBuf::from(
            "/Users/me/Documents/autohand/web/prototypes/autohandSWE/server.mjs"
        )));
        assert!(packaged_resource_candidates_from(Path::new(
            "/Applications/Autohand Squad.app/Contents/MacOS"
        ))
        .contains(&PathBuf::from(
            "/Applications/Autohand Squad.app/Contents/Resources/server.mjs"
        )));
    }

    #[test]
    fn packaged_node_runtime_name_matches_the_current_platform() {
        if cfg!(windows) {
            assert_eq!(node_executable_name(), "node.exe");
        } else {
            assert_eq!(node_executable_name(), "node");
        }
    }

    #[test]
    fn parses_listener_pids_from_lsof_output() {
        assert_eq!(listener_pids_from_lsof_output("123\n456\n"), vec![123, 456]);
    }
}
