use autohand_squad_runtime::config::PartialSquadConfig;
use autohand_squad_runtime::daemon::run_daemon;
use clap::Parser;

#[derive(Debug, Parser)]
#[command(name = "autohand-squad-daemon")]
#[command(about = "Autohand Squad background orchestrator")]
struct DaemonArgs {
    #[arg(long)]
    host: Option<String>,
    #[arg(long)]
    port: Option<u16>,
    #[arg(long)]
    fixed_port: Option<u16>,
    #[arg(long)]
    open_url: Option<String>,
    #[arg(long)]
    hosted_ui_url: Option<String>,
    #[arg(long)]
    proxy_url: Option<String>,
    #[arg(long)]
    api_gateway_url: Option<String>,
    #[arg(long)]
    api_base_url: Option<String>,
    #[arg(long)]
    api_auth_token: Option<String>,
    #[arg(long)]
    company_secret: Option<String>,
    #[arg(long)]
    update_channel: Option<String>,
    #[arg(long)]
    launch_at_login_policy: Option<String>,
    #[arg(long)]
    telemetry_policy: Option<String>,
    #[arg(long)]
    account_email: Option<String>,
    #[arg(long)]
    plan_state: Option<String>,
}

#[tokio::main]
async fn main() {
    let args = DaemonArgs::parse();
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

    if let Err(error) = run_daemon(overrides).await {
        eprintln!("{error:#}");
        std::process::exit(1);
    }
}
