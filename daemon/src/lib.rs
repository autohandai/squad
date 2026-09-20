pub mod analytics;
pub mod api;
pub mod auth;
pub mod cli;
pub mod config;
pub mod daemon;
pub mod gui_bootstrap;
pub mod install;
pub mod live_status;
pub mod native_tray;
pub mod preflight;
pub mod state;
pub mod telemetry;
pub mod ui;

pub const VERSION: &str = match option_env!("AUTOHAND_SQUAD_RELEASE_VERSION") {
    Some(version) => version,
    None => env!("CARGO_PKG_VERSION"),
};
