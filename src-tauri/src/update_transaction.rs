//! A journaled fallback for filesystems or macOS policies that refuse an exchange.
//! All moves remain on the same volume and the previous bundle is never deleted.
use std::fs::{self, File};
use std::io::{self, Write};
use std::path::Path;

pub fn exchange(
    installed: &Path,
    staged: &Path,
    atomic: impl FnOnce(&Path, &Path) -> io::Result<()>,
    mut move_path: impl FnMut(&Path, &Path) -> io::Result<()>,
) -> io::Result<()> {
    let parent = staged
        .parent()
        .ok_or_else(|| io::Error::other("Missing staging directory"))?;
    let recovery = parent.join(".swap-recovery");
    match recovery.symlink_metadata() {
        Ok(_) => {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "An interrupted update has retained recovery data. Restore it before retrying.",
            ))
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    match atomic(installed, staged) {
        Ok(()) => return Ok(()),
        Err(error)
            if error.kind() == io::ErrorKind::PermissionDenied
                || error.kind() == io::ErrorKind::Unsupported
                || matches!(error.raw_os_error(), Some(22 | 45)) => {}
        Err(error) => return Err(error),
    }
    // Refuse an earlier interrupted transaction, rather than overwriting its backup.
    let mut options = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        options.mode(0o700);
    }
    options.create(&recovery)?;
    let previous = recovery.join("Autohand Squad.app");
    let journal = recovery.join("phase");
    let record = |phase: &str| -> io::Result<()> {
        let mut file = File::create(&journal)?;
        file.write_all(phase.as_bytes())?;
        file.sync_all()
    };
    record("prepared")?;
    if let Err(error) = move_path(installed, &previous) {
        let _ = fs::remove_file(&journal);
        let _ = fs::remove_dir(&recovery);
        return Err(error);
    }
    // A failed journal write is treated like a failed installation and restored.
    let install = record("previous-saved").and_then(|()| move_path(staged, installed));
    if let Err(error) = install {
        return match move_path(&previous, installed) {
            Ok(()) => {
                let _ = fs::remove_file(&journal);
                let _ = fs::remove_dir(&recovery);
                Err(io::Error::new(error.kind(), format!("Replacement failed; the previous app was restored: {error}")))
            }
            Err(restore) => Err(io::Error::other(format!(
                "Replacement and restore failed ({error}; {restore}). The previous app is preserved at {}. The update is at {}.",
                previous.display(), staged.display()
            ))),
        };
    }
    let finish = record("replacement-installed").and_then(|()| move_path(&previous, staged));
    if let Err(error) = finish {
        // Restore the exact pre-install layout so the caller can safely retry.
        let restore = move_path(installed, staged).and_then(|()| move_path(&previous, installed));
        return match restore {
            Ok(()) => {
                let _ = fs::remove_file(&journal);
                let _ = fs::remove_dir(&recovery);
                Err(io::Error::new(error.kind(), format!("Backup placement failed; the previous app was restored: {error}")))
            }
            Err(restore) => Err(io::Error::other(format!(
                "Backup placement and restore failed ({error}; {restore}). Recovery bundles are preserved at {} and {}.",
                recovery.display(), staged.display()
            ))),
        };
    }
    // The old bundle now occupies the original staging path, as with RENAME_SWAP.
    let _ = fs::remove_file(&journal);
    let _ = fs::remove_dir(&recovery);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    fn fixture() -> (std::path::PathBuf, std::path::PathBuf, std::path::PathBuf) {
        let root = std::env::temp_dir().join(format!(
            "squad-replacement-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).unwrap();
        let old = root.join("installed");
        let new = root.join("staged");
        fs::create_dir(&old).unwrap();
        fs::create_dir(&new).unwrap();
        fs::write(old.join("version"), "old").unwrap();
        fs::write(new.join("version"), "new").unwrap();
        (root, old, new)
    }
    fn denied(_: &Path, _: &Path) -> io::Result<()> {
        Err(io::Error::from_raw_os_error(1))
    }
    #[test]
    fn permission_denied_exchange_uses_real_moves_and_can_restore() {
        let (root, old, new) = fixture();
        exchange(&old, &new, denied, |a, b| fs::rename(a, b)).unwrap();
        assert_eq!(fs::read_to_string(old.join("version")).unwrap(), "new");
        assert_eq!(fs::read_to_string(new.join("version")).unwrap(), "old");
        exchange(&old, &new, denied, |a, b| fs::rename(a, b)).unwrap();
        assert_eq!(fs::read_to_string(old.join("version")).unwrap(), "old");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn failed_second_or_third_move_restores_both_bundles() {
        for failure in [2, 3] {
            let (root, old, new) = fixture();
            let mut calls = 0;
            let error = exchange(&old, &new, denied, |a, b| {
                calls += 1;
                if calls == failure {
                    Err(io::Error::from_raw_os_error(1))
                } else {
                    fs::rename(a, b)
                }
            })
            .unwrap_err();
            assert!(error.to_string().contains("previous app was restored"));
            assert_eq!(fs::read_to_string(old.join("version")).unwrap(), "old");
            assert_eq!(fs::read_to_string(new.join("version")).unwrap(), "new");
            fs::remove_dir_all(root).unwrap();
        }
    }
    #[test]
    fn failed_restore_preserves_recovery_and_reports_it() {
        let (root, old, new) = fixture();
        let mut calls = 0;
        let error = exchange(&old, &new, denied, |a, b| {
            calls += 1;
            if calls >= 2 {
                Err(io::Error::from_raw_os_error(1))
            } else {
                fs::rename(a, b)
            }
        })
        .unwrap_err();
        assert!(error.to_string().contains("previous app is preserved at"));
        assert_eq!(
            fs::read_to_string(root.join(".swap-recovery/Autohand Squad.app/version")).unwrap(),
            "old"
        );
        assert_eq!(fs::read_to_string(new.join("version")).unwrap(), "new");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn unrelated_atomic_errors_do_not_move_anything() {
        let (root, old, new) = fixture();
        let error = exchange(
            &old,
            &new,
            |_, _| Err(io::Error::from_raw_os_error(2)),
            |_, _| panic!("must not move"),
        )
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::NotFound);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn retained_recovery_blocks_both_paths_before_any_mutation() {
        let (root, old, new) = fixture();
        fs::create_dir(root.join(".swap-recovery")).unwrap();
        let error = exchange(
            &old,
            &new,
            |_, _| panic!("must not exchange"),
            |_, _| panic!("must not move"),
        )
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read_to_string(old.join("version")).unwrap(), "old");
        fs::remove_dir_all(root).unwrap();
    }
}
