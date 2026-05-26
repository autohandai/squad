use autohand_squad_runtime::cli::run_squad_cli;

#[tokio::main]
async fn main() {
    match run_squad_cli().await {
        Ok(code) => std::process::exit(code),
        Err(error) => {
            eprintln!("{error:#}");
            std::process::exit(1);
        }
    }
}
