//! Explicit text exports; renderer-supplied paths and overwrite are forbidden.
use crate::{computer_use_grant, Shell};
use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::sync::Arc;
use tauri::{AppHandle, Manager, WebviewWindow};

const MAX_TEXT_BYTES: usize = 32 * 1024 * 1024;

#[derive(Debug, Serialize)]
pub(crate) struct ExportReceipt {
    saved: bool,
    filename: String,
    bytes: usize,
}

fn validate(filename: &str, content: &str) -> Result<(), String> {
    if filename.is_empty()
        || filename.len() > 180
        || filename.trim() != filename
        || filename
            .chars()
            .any(|c| c.is_control() || matches!(c, '/' | '\\' | ':'))
        || !(filename.ends_with(".md") || filename.ends_with(".json"))
    {
        return Err("Choose a Markdown or JSON export with a valid filename.".into());
    }
    if content.len() > MAX_TEXT_BYTES {
        return Err("This text export is larger than 32 MB. Export a smaller conversation.".into());
    }
    Ok(())
}

fn save_in_directory(
    directory: &Path,
    filename: &str,
    content: &str,
) -> Result<ExportReceipt, String> {
    validate(filename, content)?;
    fs::create_dir_all(directory).map_err(|error| format!("Downloads is unavailable: {error}"))?;
    let name = Path::new(filename);
    let stem = name
        .file_stem()
        .and_then(|v| v.to_str())
        .ok_or("Invalid export filename.")?;
    let extension = name
        .extension()
        .and_then(|v| v.to_str())
        .ok_or("Invalid export filename.")?;
    for index in 0..10_000 {
        let filename = if index == 0 {
            filename.to_string()
        } else {
            format!("{stem} ({index}).{extension}")
        };
        let path = directory.join(&filename);
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = match options.open(&path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Could not save {filename} in Downloads: {error}")),
        };
        let written = file
            .write_all(content.as_bytes())
            .and_then(|()| file.sync_all());
        drop(file);
        if let Err(error) = written {
            let _ = fs::remove_file(&path);
            return Err(format!("Could not finish saving {filename}: {error}"));
        }
        return Ok(ExportReceipt {
            saved: true,
            filename,
            bytes: content.len(),
        });
    }
    Err(
        "Too many exports have the same name in Downloads. Rename an earlier export and try again."
            .into(),
    )
}

#[tauri::command]
pub(crate) async fn squad_save_text_export(
    app: AppHandle,
    window: WebviewWindow,
    shell: tauri::State<'_, Arc<Shell>>,
    filename: String,
    content: String,
) -> Result<ExportReceipt, String> {
    if crate::system_reset::blocked(&app) {
        return Err("Finish the reset first.".into());
    }
    computer_use_grant::request_bridge(&window, &shell, None)
        .map_err(|_| "Save exports from Squad's main window.".to_string())?;
    validate(&filename, &content)?;
    let directory = app
        .path()
        .download_dir()
        .map_err(|_| "The Downloads folder could not be found.".to_string())?;
    tauri::async_runtime::spawn_blocking(move || save_in_directory(&directory, &filename, &content))
        .await
        .map_err(|_| "Squad could not finish the export.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn temporary_directory() -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!(
            "squad-text-export-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }
    #[test]
    fn exact_utf8_bytes_are_saved_and_existing_files_are_preserved() {
        let root = temporary_directory();
        fs::write(root.join("conversation.md"), "keep existing file").unwrap();
        for (filename, content) in [
            ("conversation.md", "# Exact café 🐦\n"),
            ("conversation.json", "{\"reply\":\"café 🐦\"}\n"),
        ] {
            let receipt = save_in_directory(&root, filename, content).unwrap();
            assert!(receipt.saved);
            assert_eq!(receipt.bytes, content.len());
            assert_eq!(
                fs::read(root.join(&receipt.filename)).unwrap(),
                content.as_bytes()
            );
            if filename.ends_with(".md") {
                assert_eq!(receipt.filename, "conversation (1).md");
            }
        }
        assert_eq!(
            fs::read_to_string(root.join("conversation.md")).unwrap(),
            "keep existing file"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(root.join("conversation (1).md"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn invalid_paths_and_oversized_text_create_nothing() {
        let root = temporary_directory();
        for filename in [
            "../escape.md",
            "a/b.md",
            "a\\b.json",
            "/absolute.md",
            "file.txt",
            "file.exe",
            "file.md\n",
            " file.json",
            "C:drive.md",
        ] {
            assert!(
                save_in_directory(&root, filename, "text").is_err(),
                "{filename}"
            );
        }
        assert!(save_in_directory(&root, "large.md", &"x".repeat(MAX_TEXT_BYTES + 1)).is_err());
        assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn directory_failure_is_an_error_and_never_a_saved_receipt() {
        let root = temporary_directory();
        let not_a_directory = root.join("file");
        fs::write(&not_a_directory, "keep me").unwrap();
        assert!(save_in_directory(&not_a_directory, "conversation.md", "text").is_err());
        assert_eq!(fs::read_to_string(not_a_directory).unwrap(), "keep me");
        fs::remove_dir_all(root).unwrap();
    }
}
