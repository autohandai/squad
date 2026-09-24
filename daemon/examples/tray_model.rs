//! Print the desktop tray model for this machine (account, plan usage, squad
//! status, members): `cargo run --release --example tray_model`.

use autohand_squad_runtime::config::{resolve_config, PartialSquadConfig};
use autohand_squad_runtime::desktop_tray::{load_desktop_tray_model, refresh_account_usage};
use autohand_squad_runtime::ui::default_paths;

fn main() {
    let paths = default_paths();
    let overrides = PartialSquadConfig::default();
    let (usage, error) = match resolve_config(&paths, overrides.clone())
        .map(|config| refresh_account_usage(&config))
    {
        Ok(Ok(usage)) => (usage, None),
        Ok(Err(error)) | Err(error) => (None, Some(format!("{error:#}"))),
    };
    let model = load_desktop_tray_model(&paths, &overrides, usage.as_ref(), error.as_deref());
    println!("{model:#?}");
}
