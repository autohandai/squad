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
        ]),
    ))
    .expect("build Squad native permissions")
}
