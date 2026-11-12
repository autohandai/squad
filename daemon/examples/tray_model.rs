//! Print the desktop tray model for this machine (account, plan usage, squad
//! status, members): `cargo run --release --example tray_model`.

use autohand_squad_runtime::config::{resolve_config, PartialSquadConfig};
use autohand_squad_runtime::desktop_tray::{load_desktop_tray_model, refresh_account_usage};
use autohand_squad_runtime::ownership::read_active_context;
use autohand_squad_runtime::ui::default_paths;

fn main() {
    let paths = default_paths();
    let overrides = PartialSquadConfig::default();
    let generation = read_active_context(&paths)
        .ok()
        .flatten()
        .map(|context| context.generation);
    let (usage, error) = match resolve_config(&paths, overrides.clone())
        .map(|config| refresh_account_usage(&paths, &config))
    {
        Ok(Ok(usage)) => (usage, None),
        Ok(Err(error)) | Err(error) => (None, Some(format!("{error:#}"))),
    };
    let model = load_desktop_tray_model(
        &paths,
        &overrides,
        usage.as_ref(),
        error.as_deref(),
        generation.as_deref(),
    );
    println!("{model:#?}");
}
