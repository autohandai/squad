use autohand_squad_runtime::config::PartialSquadConfig;
use autohand_squad_runtime::native_tray::run_native_tray;
use autohand_squad_runtime::ui::{default_paths, describe_tray, run_tray_action, TrayAction};
use clap::Parser;
use std::path::Path;
use tokio::runtime::Runtime;

#[derive(Debug, Parser)]
#[command(about = "Autohand Squad desktop menu bar and tray controller")]
struct TrayArgs {
    #[arg(long)]
    describe: bool,
    #[arg(long)]
    action: Option<String>,
    #[arg(long)]
    platform: Option<String>,
    #[arg(long, global = true)]
    host: Option<String>,
    #[arg(long, global = true)]
    port: Option<u16>,
    #[arg(long, global = true)]
    fixed_port: Option<u16>,
    #[arg(long, global = true)]
    open_url: Option<String>,
    #[arg(long, global = true)]
    hosted_ui_url: Option<String>,
    #[arg(long, global = true)]
    proxy_url: Option<String>,
    #[arg(long, global = true)]
    api_gateway_url: Option<String>,
    #[arg(long, global = true)]
    api_base_url: Option<String>,
    #[arg(long, global = true)]
    api_auth_token: Option<String>,
    #[arg(long, global = true)]
    company_secret: Option<String>,
    #[arg(long, global = true)]
    update_channel: Option<String>,
    #[arg(long, global = true)]
    launch_at_login_policy: Option<String>,
    #[arg(long, global = true)]
    telemetry_policy: Option<String>,
    #[arg(long, global = true)]
    account_email: Option<String>,
    #[arg(long, global = true)]
    plan_state: Option<String>,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error:#}");
        std::process::exit(1);
    }
}

fn run() -> anyhow::Result<()> {
    let args = TrayArgs::parse();
    let paths = default_paths();
    let overrides = PartialSquadConfig {
        host: args.host,
        port: args.port,
        fixed_port: args.fixed_port,
        open_url: args.open_url,
        hosted_ui_url: args.hosted_ui_url,
        proxy_url: args.proxy_url,
        api_gateway_url: args.api_gateway_url,
        api_base_url: args.api_base_url,
        api_auth_token: args.api_auth_token,
        company_secret: args.company_secret,
        update_channel: args.update_channel,
        launch_at_login_policy: args.launch_at_login_policy,
        telemetry_policy: args.telemetry_policy,
        account_email: args.account_email,
        plan_state: args.plan_state,
    };

    if let Some(action) = args.action {
        let runtime = Runtime::new()?;
        let output = runtime.block_on(run_tray_action(
            paths,
            overrides,
            TrayAction::parse(&action)?,
        ))?;
        print!("{output}");
        return Ok(());
    }

    if !args.describe {
        if std::env::current_exe()
            .ok()
            .as_deref()
            .is_some_and(is_desktop_ui_executable)
        {
            let runtime = Runtime::new()?;
            let output = runtime.block_on(run_tray_action(
                paths.clone(),
                overrides.clone(),
                TrayAction::StartService,
            ))?;
            print!("{output}");
            let output = runtime.block_on(run_tray_action(
                paths.clone(),
                overrides.clone(),
                TrayAction::OpenSquad,
            ))?;
            print!("{output}");
        }
        return run_native_tray(paths, overrides);
    }

    let runtime = Runtime::new()?;
    let snapshot = runtime.block_on(describe_tray(paths, overrides, args.platform))?;
    println!("{}", serde_json::to_string_pretty(&snapshot)?);
    Ok(())
}

fn is_desktop_ui_executable(path: &Path) -> bool {
    path.file_stem()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case("autohand-squad-ui"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_ui_binary_bootstraps_the_stack() {
        assert!(is_desktop_ui_executable(Path::new(
            "/Applications/Autohand Squad.app/Contents/MacOS/autohand-squad-ui"
        )));
        assert!(is_desktop_ui_executable(Path::new("autohand-squad-ui.exe")));
        assert!(!is_desktop_ui_executable(Path::new(
            "/usr/local/bin/autohand-squad-tray"
        )));
    }
}
