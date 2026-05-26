pub mod analytics;
pub mod api;
pub mod cli;
pub mod config;
pub mod daemon;
pub mod install;
pub mod native_tray;
pub mod state;
pub mod telemetry;
pub mod ui;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
