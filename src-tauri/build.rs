fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "squad_setup_computer_use",
            "squad_confirm_computer_use",
            "squad_revoke_computer_use",
            "squad_set_attention_badge",
            "squad_notification_permission",
            "squad_notification_test",
            "squad_notification_settings",
            "squad_quit_for_update",
            "squad_set_system_reset_stage",
            "squad_system_reset_status",
            "squad_restart_after_system_reset",
            "squad_open_artifact_in_browser",
        ]),
    ))
    .expect("build Squad native permissions")
}
