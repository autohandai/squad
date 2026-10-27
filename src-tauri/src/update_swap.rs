//! A headless atomic bundle swap. No webview, AppKit, or tray is created.
#[path = "update_transaction.rs"]
mod transaction;
#[cfg(target_os = "macos")]
fn swap_paths(left: &std::path::Path, right: &std::path::Path) -> std::io::Result<()> {
    transaction::exchange(
        left,
        right,
        |a, b| rename_paths(a, b, libc::RENAME_SWAP),
        |a, b| rename_paths(a, b, libc::RENAME_EXCL),
    )
}

#[cfg(target_os = "macos")]
fn rename_paths(
    left: &std::path::Path,
    right: &std::path::Path,
    flags: u32,
) -> std::io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let left = CString::new(left.as_os_str().as_bytes())?;
    let right = CString::new(right.as_os_str().as_bytes())?;
    let result = unsafe {
        libc::renameatx_np(
            libc::AT_FDCWD,
            left.as_ptr(),
            libc::AT_FDCWD,
            right.as_ptr(),
            flags,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

pub fn run_from_args() -> bool {
    let args: Vec<_> = std::env::args_os().collect();
    if args.get(1).map_or(true, |arg| arg != "--squad-swap-update") {
        return false;
    }
    #[cfg(target_os = "macos")]
    let result = (|| -> anyhow::Result<()> {
        anyhow::ensure!(args.len() == 4, "An app and staged update are required.");
        let app = std::path::PathBuf::from(&args[2]);
        let staged = std::path::PathBuf::from(&args[3]);
        let current = std::env::current_exe()?;
        let own_app = current
            .parent()
            .and_then(std::path::Path::parent)
            .and_then(std::path::Path::parent)
            .ok_or_else(|| anyhow::anyhow!("This executable is not installed in a bundle."))?;
        anyhow::ensure!(
            app == own_app
                && app
                    .file_name()
                    .is_some_and(|name| name == "Autohand Squad.app"),
            "Only this installed app can be swapped."
        );
        let staging_dir = staged
            .parent()
            .ok_or_else(|| anyhow::anyhow!("Missing staging directory."))?;
        anyhow::ensure!(
            staged
                .file_name()
                .is_some_and(|name| name == "Autohand Squad.app")
                && staging_dir.parent() == app.parent()
                && staging_dir.file_name().is_some_and(|name| name
                    .to_string_lossy()
                    .starts_with(".Autohand-Squad-update-")),
            "Update staging must be beside the installed app."
        );
        anyhow::ensure!(
            !app.symlink_metadata()?.file_type().is_symlink()
                && !staged.symlink_metadata()?.file_type().is_symlink(),
            "App bundles cannot be links."
        );
        swap_paths(&app, &staged)?;
        Ok(())
    })();
    #[cfg(not(target_os = "macos"))]
    let result: anyhow::Result<()> = Err(anyhow::anyhow!(
        "Atomic app replacement is only supported on macOS."
    ));
    if let Err(error) = result {
        eprintln!("{error:#}");
        std::process::exit(1);
    }
    true
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    #[test]
    fn exchanges_bundles_and_can_restore_them() {
        let dir = std::env::temp_dir().join(format!("squad-swap-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let old = dir.join("old");
        let new = dir.join("new");
        std::fs::create_dir(&old).unwrap();
        std::fs::create_dir(&new).unwrap();
        std::fs::write(old.join("version"), "old").unwrap();
        std::fs::write(new.join("version"), "new").unwrap();
        super::swap_paths(&old, &new).unwrap();
        assert_eq!(std::fs::read_to_string(old.join("version")).unwrap(), "new");
        assert_eq!(std::fs::read_to_string(new.join("version")).unwrap(), "old");
        super::swap_paths(&old, &new).unwrap();
        assert_eq!(std::fs::read_to_string(old.join("version")).unwrap(), "old");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
