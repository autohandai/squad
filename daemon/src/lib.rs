pub mod account_usage;
pub mod analytics;
pub mod api;
pub mod auth;
pub mod cli;
pub mod config;
pub mod daemon;
pub mod desktop_tray;
pub mod gui_bootstrap;
pub mod install;
pub mod live_status;
pub mod memory_index;
#[cfg(feature = "native-tray")]
pub mod native_tray;
mod native_work_intents;
pub mod otel;
#[cfg(windows)]
pub mod owned_windows;
pub mod ownership;
mod ownership_activity;
pub mod preflight;
pub mod squad_api;
pub mod startup_ports;
pub mod state;
pub mod telemetry;
pub mod ui;

pub const VERSION: &str = match option_env!("AUTOHAND_SQUAD_RELEASE_VERSION") {
    Some(version) => version,
    None => env!("CARGO_PKG_VERSION"),
};
