//! A grant can be elevated only after an explicit native human confirmation.
//! Neither an agent HTTP request nor the webview receives the private token.
use crate::{lock, Shell, MAIN_WINDOW};
use serde::Deserialize;
use std::sync::Arc;
use tauri::{AppHandle, Url, WebviewWindow};

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Scope {
    Observe,
    Control,
}

impl Scope {
    fn as_str(self) -> &'static str {
        match self {
            Self::Observe => "observe",
            Self::Control => "control",
        }
    }
}

fn trusted_bridge(
    label: &str,
    caller: &Url,
    bridge: &Url,
    member: Option<&str>,
) -> Result<(), String> {
    if label != MAIN_WINDOW
        || caller.origin() != bridge.origin()
        || !caller.username().is_empty()
        || caller.password().is_some()
    {
        return Err("Computer Use permission must be requested from Squad's main window.".into());
    }
    if bridge.scheme() != "http"
        || !matches!(bridge.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"))
        || !bridge.username().is_empty()
        || bridge.password().is_some()
        || member.is_some_and(|member| !crate::quick_chat::valid_member_id(member))
    {
        return Err("Invalid local Squad Computer Use request.".into());
    }
    Ok(())
}

pub(crate) fn request_bridge(
    window: &WebviewWindow,
    shell: &Shell,
    member: Option<&str>,
) -> Result<Url, String> {
    let bridge = lock(&shell.app_url)
        .as_deref()
        .and_then(|url| Url::parse(url).ok())
        .ok_or("Squad is still starting.")?;
    let caller = window.url().map_err(|error| error.to_string())?;
    trusted_bridge(window.label(), &caller, &bridge, member)?;
    Ok(bridge)
}

fn grant_result(
    reply: &serde_json::Value,
    scope: Option<Scope>,
) -> Result<serde_json::Value, String> {
    let expected = scope.map(Scope::as_str).unwrap_or("none");
    if reply.get("success").and_then(|value| value.as_bool()) != Some(true)
        || reply
            .pointer("/data/scope")
            .and_then(|value| value.as_str())
            != Some(expected)
    {
        return Err("Squad did not save the requested Computer Use permission.".into());
    }
    // Return only the fixed grant receipt, never arbitrary bridge metadata.
    let updated_at = reply
        .pointer("/data/updatedAt")
        .and_then(|value| value.as_str())
        .filter(|value| value.len() <= 80 && !value.chars().any(char::is_control));
    Ok(serde_json::json!({
        "confirmed":scope.is_some(),
        "revoked":scope.is_none(),
        "data":{"scope":expected,"updatedAt":updated_at}
    }))
}

pub(crate) fn prepare_bridge_secret() -> anyhow::Result<()> {
    #[cfg(target_os = "macos")]
    {
        let root = crate::default_paths().root;
        let token = macos::load_pairing_token(&root).map_err(anyhow::Error::msg)?;
        macos::TOKEN
            .set(token.clone())
            .map_err(|_| anyhow::anyhow!("Native Computer Use consent was already initialized."))?;
        // Reuse the private local pairing key across app relaunches. A warm
        // CLI-first bridge can validate it from the same fixed state file.
        // Child-tool launch paths strip it; never put it in status or web IPC.
        std::env::set_var("AUTOHAND_SQUAD_NATIVE_GRANT_TOKEN", token);
    }
    Ok(())
}

pub(crate) fn clear_bridge_secret_env() {
    // The first Node bridge has already inherited the pairing token. Later
    // bridge starts can use the fixed private file; opener/plugin helpers must
    // not inherit consent credentials from this long-lived native process.
    std::env::remove_var("AUTOHAND_SQUAD_NATIVE_GRANT_TOKEN");
}

#[tauri::command]
pub(crate) async fn squad_confirm_computer_use(
    app: AppHandle,
    window: WebviewWindow,
    shell: tauri::State<'_, Arc<Shell>>,
    member_id: String,
    scope: Scope,
) -> Result<serde_json::Value, String> {
    let bridge = request_bridge(&window, &shell, Some(&member_id))?;
    #[cfg(target_os = "macos")]
    {
        let _pending = macos::PendingDialog::acquire()?;
        let context_bridge = bridge.clone();
        let context_member = member_id.clone();
        let context = tauri::async_runtime::spawn_blocking(move || {
            macos::load_context(&context_bridge, &context_member)
        })
        .await
        .map_err(|error| error.to_string())??;
        if !macos::confirm(&app, &context, &member_id, scope).await? {
            return Ok(serde_json::json!({"confirmed":false}));
        }
        // The visible caller must still be this app after the modal returns.
        let current_bridge = request_bridge(&window, &shell, Some(&member_id))?;
        if current_bridge.origin() != bridge.origin() {
            return Err("Squad's local bridge changed. Request permission again.".into());
        }
        tauri::async_runtime::spawn_blocking(move || {
            macos::set_grant(&bridge, &member_id, Some(scope))
        })
        .await
        .map_err(|error| error.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, bridge, scope);
        Err("Native Computer Use consent is available on macOS.".into())
    }
}

#[tauri::command]
pub(crate) async fn squad_revoke_computer_use(
    window: WebviewWindow,
    shell: tauri::State<'_, Arc<Shell>>,
    member_id: String,
) -> Result<serde_json::Value, String> {
    let bridge = request_bridge(&window, &shell, Some(&member_id))?;
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(move || macos::set_grant(&bridge, &member_id, None))
            .await
            .map_err(|error| error.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = bridge;
        Err("Native Computer Use consent is available on macOS.".into())
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSAlert, NSAlertSecondButtonReturn};
    use objc2_foundation::NSString;
    use reqwest::blocking::Client;
    use std::io::Read;
    use std::io::Write;
    use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
    use std::path::Path;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{mpsc, OnceLock};
    use std::time::Duration;

    pub(super) static TOKEN: OnceLock<String> = OnceLock::new();
    static PENDING: AtomicBool = AtomicBool::new(false);

    fn read_pairing_token(path: &Path) -> Result<String, std::io::Error> {
        let file = std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(path)?;
        // Validate the opened descriptor, avoiding metadata/open races and
        // refusing symlinks, hardlinks, foreign ownership or readable-by-other
        // permissions. The existing file is never repaired or overwritten.
        let metadata = file.metadata()?;
        // SAFETY: geteuid has no arguments or memory requirements.
        let owner = unsafe { libc::geteuid() };
        if !metadata.is_file()
            || metadata.nlink() != 1
            || metadata.uid() != owner
            || metadata.mode() & 0o7777 != 0o600
            || metadata.len() != 64
        {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "Invalid private native pairing key file.",
            ));
        }
        let mut bytes = Vec::new();
        file.take(65).read_to_end(&mut bytes)?;
        if bytes.len() != 64 || !bytes.iter().all(u8::is_ascii_hexdigit) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "Invalid native pairing key format.",
            ));
        }
        // All bytes were checked as ASCII hex; no secret-bearing UTF-8 error.
        Ok(bytes.into_iter().map(char::from).collect())
    }

    pub(super) fn load_pairing_token(root: &Path) -> Result<String, String> {
        let path = root.join("native-grant-token");
        match read_pairing_token(&path) {
            Ok(token) => return Ok(token),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("Cannot read the private native-grant-token pairing key. Its file must be a regular, single-link file owned by you with mode 0600 and exactly 64 hex characters.".into()),
        }
        std::fs::create_dir_all(root)
            .map_err(|_| "Cannot create Squad's native pairing key directory.".to_owned())?;
        let mut bytes = [0_u8; 32];
        getrandom::fill(&mut bytes)
            .map_err(|_| "Cannot create a secure native Computer Use pairing key.".to_owned())?;
        let token: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
        let opened = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW)
            .open(&path);
        match opened {
            Ok(mut file) => {
                file.write_all(token.as_bytes())
                    .and_then(|_| file.sync_all())
                    .map_err(|_| "Cannot save Squad's private native pairing key.".to_owned())?;
                // Check actual permissions/ownership, including unusual
                // inherited filesystem rules, before accepting the new key.
                read_pairing_token(&path).map_err(|_| {
                    "The new native pairing key failed its private-file checks.".into()
                })
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                read_pairing_token(&path).map_err(|_| {
                    "An existing native pairing key failed its private-file checks.".into()
                })
            }
            Err(_) => Err("Cannot create Squad's private native pairing key.".into()),
        }
    }

    pub(super) struct PendingDialog;
    impl PendingDialog {
        pub(super) fn acquire() -> Result<Self, String> {
            PENDING
                .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                .map(|_| Self)
                .map_err(|_| "A Computer Use permission request is already open.".into())
        }
    }
    impl Drop for PendingDialog {
        fn drop(&mut self) {
            PENDING.store(false, Ordering::Release);
        }
    }

    pub(super) struct ConsentContext {
        name: String,
        accessibility: bool,
        screen_recording: bool,
    }

    fn client() -> Result<Client, String> {
        Client::builder()
            .timeout(Duration::from_secs(4))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| "Could not connect to the local Squad bridge.".into())
    }

    fn endpoint(bridge: &Url, path: &str) -> Url {
        let mut url = bridge.clone();
        url.set_path(path);
        url.set_query(None);
        url.set_fragment(None);
        url
    }

    fn response_json(response: reqwest::blocking::Response) -> Result<serde_json::Value, String> {
        if !response.status().is_success() {
            return Err(format!(
                "Squad Computer Use request failed (HTTP {}).",
                response.status()
            ));
        }
        let mut bytes = Vec::new();
        response
            .take(2 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "Could not read Squad's Computer Use response.".to_owned())?;
        if bytes.len() > 2 * 1024 * 1024 {
            return Err("Squad's Computer Use response was too large.".into());
        }
        serde_json::from_slice(&bytes)
            .map_err(|_| "Squad returned an invalid Computer Use response.".into())
    }

    pub(super) fn load_context(bridge: &Url, member: &str) -> Result<ConsentContext, String> {
        let client = client()?;
        let mut status_url = endpoint(bridge, "/api/computer-use/status");
        status_url.query_pairs_mut().append_pair("memberId", member);
        let status = response_json(
            client
                .get(status_url)
                .send()
                .map_err(|_| "Squad Computer Use did not answer.".to_owned())?,
        )?;
        if status
            .pointer("/data/available")
            .and_then(|value| value.as_bool())
            != Some(true)
        {
            return Err(
                "Squad's bundled Computer Use host is unavailable. Check Computer Use setup first."
                    .into(),
            );
        }
        if status
            .pointer("/data/memberId")
            .and_then(|value| value.as_str())
            != Some(member)
        {
            return Err("Squad returned a different Computer Use member.".into());
        }
        let roster = response_json(
            client
                .get(endpoint(bridge, "/api/status/snapshot"))
                .send()
                .map_err(|_| "Squad's member roster did not answer.".to_owned())?,
        )?;
        let record = roster
            .pointer("/data/members")
            .and_then(|value| value.as_array())
            .and_then(|members| {
                members
                    .iter()
                    .find(|value| value.get("id").and_then(|value| value.as_str()) == Some(member))
            })
            .ok_or("That member is no longer in your squad.")?;
        if matches!(
            record.get("status").and_then(|value| value.as_str()),
            Some("archived" | "disabled")
        ) {
            return Err("This member cannot receive Computer Use permission.".into());
        }
        let name: String = record
            .get("name")
            .and_then(|value| value.as_str())
            .unwrap_or(member)
            .chars()
            .filter(|character| {
                !character.is_control()
                    && !matches!(*character, '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
            })
            .take(100)
            .collect();
        Ok(ConsentContext {
            name: if name.trim().is_empty() {
                member.to_owned()
            } else {
                name.trim().to_owned()
            },
            accessibility: status
                .pointer("/data/accessibility")
                .and_then(|value| value.as_bool())
                .unwrap_or(false),
            screen_recording: status
                .pointer("/data/screenRecording")
                .and_then(|value| value.as_bool())
                .unwrap_or(false),
        })
    }

    pub(super) async fn confirm(
        app: &AppHandle,
        context: &ConsentContext,
        member: &str,
        scope: Scope,
    ) -> Result<bool, String> {
        let action = match scope {
            Scope::Observe => "observe",
            Scope::Control => "control",
        };
        let title = format!("Allow {} to {action} your Mac?", context.name);
        let access = match scope {
            Scope::Observe => "Observation allows desktop screenshots and reading what is on screen. It does not allow mouse or keyboard input.",
            Scope::Control => "Control allows desktop screenshots, mouse clicks and keyboard input across your Mac.",
        };
        let body = format!(
            "Member: {} ({member})\n\n{access}\n\nScreenshots and action evidence are saved in Squad's local session history for your review. You can revoke permission in Computer Use settings.\n\nmacOS Screen Recording: {}. Accessibility: {}. This confirmation does not change those system permissions.",
            context.name,
            if context.screen_recording { "allowed" } else { "not allowed" },
            if context.accessibility { "allowed" } else { "not allowed" },
        );
        let button = format!("Allow {action}");
        let (sender, receiver) = mpsc::channel();
        app.run_on_main_thread(move || {
            let result = MainThreadMarker::new()
                .ok_or("Native permission dialog could not run on the main thread.".to_owned())
                .map(|marker| {
                    let alert = NSAlert::new(marker);
                    alert.setMessageText(&NSString::from_str(&title));
                    alert.setInformativeText(&NSString::from_str(&body));
                    // Cancel is the default Return action. Elevation requires
                    // selecting the separately labelled Allow button.
                    alert.addButtonWithTitle(&NSString::from_str("Cancel"));
                    alert.addButtonWithTitle(&NSString::from_str(&button));
                    alert.runModal() == NSAlertSecondButtonReturn
                });
            let _ = sender.send(result);
        })
        .map_err(|_| "Could not show the native Computer Use permission dialog.".to_owned())?;
        tauri::async_runtime::spawn_blocking(move || {
            receiver
                .recv()
                .map_err(|_| "Native Computer Use permission dialog closed.".to_owned())?
        })
        .await
        .map_err(|error| error.to_string())?
    }

    pub(super) fn set_grant(
        bridge: &Url,
        member: &str,
        scope: Option<Scope>,
    ) -> Result<serde_json::Value, String> {
        let client = client()?;
        let url = endpoint(bridge, "/api/computer-use/grant");
        let request = if let Some(scope) = scope {
            client
                .post(url)
                .json(&serde_json::json!({"memberId":member,"scope":scope.as_str()}))
        } else {
            client
                .delete(url)
                .json(&serde_json::json!({"memberId":member}))
        };
        let token = TOKEN
            .get()
            .ok_or("Native Computer Use consent is not initialized.")?;
        // Never return reqwest's request error: it can contain request context.
        let reply = response_json(
            request
                .header("x-squad-native-grant", token)
                .send()
                .map_err(|_| {
                    "The local Computer Use permission request did not complete.".to_owned()
                })?,
        )?;
        grant_result(&reply, scope)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "macos")]
    #[test]
    fn pairing_key_is_private_reused_and_untrusted_files_are_not_changed() {
        use std::os::unix::fs::{symlink, FileTypeExt, PermissionsExt};
        struct Fixture(std::path::PathBuf);
        impl Drop for Fixture {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
        let mut random = [0_u8; 8];
        getrandom::fill(&mut random).unwrap();
        let suffix: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
        let fixture =
            Fixture(std::env::temp_dir().join(format!("squad-native-pairing-test-{suffix}")));
        let root = &fixture.0;
        let first = macos::load_pairing_token(root).unwrap();
        assert_eq!(first.len(), 64);
        assert!(first.bytes().all(|byte| byte.is_ascii_hexdigit()));
        assert_eq!(macos::load_pairing_token(root).unwrap(), first);
        let path = root.join("native-grant-token");
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o7777,
            0o600
        );

        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(macos::load_pairing_token(root).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), first);
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        std::fs::write(&path, "invalid-key").unwrap();
        assert!(macos::load_pairing_token(root).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "invalid-key");

        std::fs::remove_file(&path).unwrap();
        let target = root.join("other-private-file");
        std::fs::write(&target, "untouched").unwrap();
        symlink(&target, &path).unwrap();
        assert!(macos::load_pairing_token(root).is_err());
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "untouched");

        std::fs::remove_file(&path).unwrap();
        std::fs::write(&target, &first).unwrap();
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o600)).unwrap();
        std::fs::hard_link(&target, &path).unwrap();
        assert!(macos::load_pairing_token(root).is_err());
        assert_eq!(std::fs::read_to_string(&target).unwrap(), first);

        std::fs::remove_file(&path).unwrap();
        std::fs::create_dir(&path).unwrap();
        assert!(macos::load_pairing_token(root).is_err());
        assert!(path.is_dir());

        std::fs::remove_dir(&path).unwrap();
        let fifo_path = std::ffi::CString::new(path.as_os_str().as_encoded_bytes()).unwrap();
        // SAFETY: the fixture path is a valid NUL-terminated CString. The FIFO
        // stays entirely inside the owned temporary fixture directory.
        assert_eq!(unsafe { libc::mkfifo(fifo_path.as_ptr(), 0o600) }, 0);
        assert!(macos::load_pairing_token(root).is_err());
        assert!(std::fs::symlink_metadata(&path)
            .unwrap()
            .file_type()
            .is_fifo());
    }

    #[test]
    fn consent_has_no_quick_chat_or_external_origin_authority() {
        let bridge = Url::parse("http://127.0.0.1:19821/").unwrap();
        assert!(trusted_bridge("main", &bridge, &bridge, Some("eva")).is_ok());
        for label in ["quick-chat", "about", ""] {
            assert!(trusted_bridge(label, &bridge, &bridge, Some("eva")).is_err());
        }
        for url in [
            "http://127.0.0.1:19822/",
            "https://127.0.0.1:19821/",
            "http://user@127.0.0.1:19821/",
            "https://example.com/",
        ] {
            assert!(
                trusted_bridge("main", &Url::parse(url).unwrap(), &bridge, Some("eva")).is_err()
            );
        }
        let external = Url::parse("http://example.com/").unwrap();
        assert!(trusted_bridge("main", &external, &external, Some("eva")).is_err());
        for member in ["../eva", "eva?scope=control", "", "eva/new"] {
            assert!(trusted_bridge("main", &bridge, &bridge, Some(member)).is_err());
        }
    }

    #[test]
    fn only_observe_or_control_can_be_elevated() {
        assert!(serde_json::from_str::<Scope>("\"observe\"").is_ok());
        assert!(serde_json::from_str::<Scope>("\"control\"").is_ok());
        for scope in ["none", "admin", "Control", "*"] {
            assert!(serde_json::from_str::<Scope>(&format!("\"{scope}\"")).is_err());
        }
    }

    #[test]
    fn grant_receipt_cannot_expand_scope_or_return_unrelated_metadata() {
        let observe = serde_json::json!({"success":true,"data":{"scope":"observe","updatedAt":"2026-10-02T10:00:00Z","unexpected":"private"}});
        let receipt = grant_result(&observe, Some(Scope::Observe)).unwrap();
        assert_eq!(receipt["data"]["scope"], "observe");
        assert_eq!(receipt["confirmed"], true);
        assert!(receipt["data"].get("unexpected").is_none());
        assert!(grant_result(&observe, Some(Scope::Control)).is_err());
        assert!(grant_result(&observe, None).is_err());
        assert!(grant_result(
            &serde_json::json!({"success":false,"data":{"scope":"observe"}}),
            Some(Scope::Observe)
        )
        .is_err());
        assert_eq!(
            grant_result(
                &serde_json::json!({"success":true,"data":{"scope":"none"}}),
                None
            )
            .unwrap()["revoked"],
            true
        );
    }
}
