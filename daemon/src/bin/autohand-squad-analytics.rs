use autohand_squad_runtime::analytics::{run_analytics_daemon, DEFAULT_ANALYTICS_PORT};
use autohand_squad_runtime::state::DEFAULT_HOST;
use clap::Parser;

#[derive(Debug, Parser)]
#[command(name = "autohand-squad-analytics")]
#[command(about = "Autohand Squad local analytics collector")]
struct AnalyticsArgs {
    #[arg(long, default_value = DEFAULT_HOST)]
    host: String,
    #[arg(long, default_value_t = DEFAULT_ANALYTICS_PORT)]
    port: u16,
}

#[tokio::main]
async fn main() {
    let args = AnalyticsArgs::parse();
    if let Err(error) = run_analytics_daemon(args.host, args.port).await {
        eprintln!("{error:#}");
        std::process::exit(1);
    }
}
