//! Explicit human setup opens one verified, bundled permission host. No input
//! can substitute a path, executable, shell command or system-settings URL.
use crate::Shell;
use std::sync::Arc;
use tauri::{AppHandle, WebviewWindow};

const HOST_BUNDLE: &str = "Squad Computer Use.app";
const HOST_BINARY: &str = "Squad Computer Use.app/Contents/MacOS/AutohandComputerUse";
const HOST_ID: &str = "ai.autohand.squad.computer-use";
const BRANDING_PATCH_SHA: &str = "1beed4288409b5f2a6143453aa9c645aece207f5ec97ceefd32531a0377e784f";
const SOURCE_COMMIT: &str = "fc92b70417cdae941ba8b104a6e7b3b5b52a07e2";

fn host_digest(info: &serde_json::Value) -> Result<&str, String> {
    if info.get("version").and_then(|value| value.as_str()) != Some("0.28.2")
        || info.get("sourceCommit").and_then(|value| value.as_str()) != Some(SOURCE_COMMIT)
        || info
            .pointer("/host/sourceCommit")
            .and_then(|value| value.as_str())
            != Some(SOURCE_COMMIT)
        || info
            .pointer("/host/bundleId")
            .and_then(|value| value.as_str())
            != Some(HOST_ID)
        || info.pointer("/host/path").and_then(|value| value.as_str()) != Some(HOST_BINARY)
        || info
            .pointer("/host/branding/patchSha256")
            .and_then(|value| value.as_str())
            != Some(BRANDING_PATCH_SHA)
    {
        return Err("The bundled Computer Use permission host has invalid provenance.".into());
    }
    info.pointer("/host/sha256")
        .and_then(|value| value.as_str())
        .filter(|value| value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .ok_or("The bundled Computer Use permission host has no valid checksum.".into())
}

#[tauri::command]
pub(crate) async fn squad_setup_computer_use(
    app: AppHandle,
    window: WebviewWindow,
    shell: tauri::State<'_, Arc<Shell>>,
) -> Result<serde_json::Value, String> {
    crate::computer_use_grant::request_bridge(&window, &shell, None)?;
    #[cfg(target_os = "macos")]
    {
        use tauri::Manager;
        let resources = app
            .path()
            .resource_dir()
            .map_err(|_| "Squad's bundled resources are unavailable.".to_owned())?;
        tauri::async_runtime::spawn_blocking(move || open_permission_host(&resources))
            .await
            .map_err(|error| error.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("Native Computer Use permission setup is available on macOS.".into())
    }
}

#[cfg(target_os = "macos")]
fn open_permission_host(resources: &std::path::Path) -> Result<serde_json::Value, String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    use std::os::unix::fs::OpenOptionsExt;
    use std::process::{Command, Stdio};
    let directory = resources.join("runtime/vendor/computer-use");
    let host = directory.join(HOST_BUNDLE);
    let metadata = std::fs::symlink_metadata(&host).map_err(|_| {
        "The Computer Use permission host is not bundled. Prepare and stage Computer Use first."
            .to_owned()
    })?;
    if !metadata.is_dir() {
        return Err("The bundled Computer Use host must be a real app directory.".into());
    }
    let read_regular = |path: &std::path::Path, maximum: u64| -> Result<Vec<u8>, String> {
        let file = std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(path)
            .map_err(|_| "Cannot read the bundled Computer Use host.".to_owned())?;
        let metadata = file
            .metadata()
            .map_err(|_| "Cannot check the bundled Computer Use host.".to_owned())?;
        if !metadata.is_file() || metadata.len() > maximum {
            return Err("Invalid bundled Computer Use host file.".into());
        }
        let mut bytes = Vec::new();
        file.take(maximum + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "Cannot read the bundled Computer Use host.".to_owned())?;
        if bytes.len() as u64 > maximum {
            return Err("Bundled Computer Use host file exceeded its limit.".into());
        }
        Ok(bytes)
    };
    let info: serde_json::Value = serde_json::from_slice(&read_regular(
        &directory.join("BUILD_INFO.json"),
        2 * 1024 * 1024,
    )?)
    .map_err(|_| "The bundled Computer Use manifest is invalid.".to_owned())?;
    let expected = host_digest(&info)?;
    let bytes = read_regular(&directory.join(HOST_BINARY), 32 * 1024 * 1024)?;
    if format!("{:x}", Sha256::digest(&bytes)) != expected {
        return Err("The bundled Computer Use permission host failed its checksum.".into());
    }
    let helper = |program: &str| {
        let mut command = Command::new(program);
        command.env_remove("AUTOHAND_SQUAD_NATIVE_GRANT_TOKEN");
        command.stdin(Stdio::null());
        command
    };
    let identity = helper("/usr/libexec/PlistBuddy")
        .args(["-c", "Print :CFBundleIdentifier"])
        .arg(host.join("Contents/Info.plist"))
        .output()
        .map_err(|_| "Cannot verify the Computer Use host identity.".to_owned())?;
    if !identity.status.success() || String::from_utf8_lossy(&identity.stdout).trim() != HOST_ID {
        return Err("The bundled Computer Use host has the wrong permission identity.".into());
    }
    let signature = helper("/usr/bin/codesign")
        .args(["--verify", "--deep", "--strict"])
        .arg(&host)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|_| "Cannot verify the Computer Use host signature.".to_owned())?;
    if !signature.success() {
        return Err(
            "The bundled Computer Use permission host failed signature verification.".into(),
        );
    }
    let opened = helper("/usr/bin/open")
        .args(["-n", "-a"])
        .arg(&host)
        .args(["--args", "permissions", "grant"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|_| "Could not open Computer Use permission setup.".to_owned())?;
    if !opened.success() {
        return Err("macOS did not open Computer Use permission setup.".into());
    }
    Ok(serde_json::json!({"opened":true,"bundleId":HOST_ID}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn setup_host_path_and_identity_cannot_be_substituted() {
        let valid = serde_json::json!({"version":"0.28.2","sourceCommit":SOURCE_COMMIT,"host":{"sourceCommit":SOURCE_COMMIT,"bundleId":HOST_ID,"path":HOST_BINARY,"branding":{"patchSha256":BRANDING_PATCH_SHA},"sha256":"a".repeat(64)}});
        assert!(host_digest(&valid).is_ok());
        for (field, value) in [
            ("path", "../other.app/Contents/MacOS/other"),
            ("bundleId", "com.apple.Terminal"),
            ("bundleId", "ai.autohand.computer-use"),
            ("sourceCommit", "unverified"),
            ("sha256", "invalid"),
        ] {
            let mut info = valid.clone();
            info["host"][field] = serde_json::json!(value);
            assert!(host_digest(&info).is_err());
        }
        let mut unverified = valid;
        unverified["host"]["branding"]["patchSha256"] = serde_json::json!("unverified");
        assert!(host_digest(&unverified).is_err());
    }
}
