//! Private data paths come from a verified broker receipt, never a legacy root.
//! Machine service/install records keep their original paths.

use crate::account_usage::parse_rfc3339_unix;
use crate::config::read_autohand_user_auth;
use crate::state::StatePaths;
use anyhow::{bail, Context, Result};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct Owner {
    pub kind: String,
    pub issuer: String,
    pub id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct Actor {
    pub issuer: String,
    pub id: String,
    #[serde(default)]
    pub email: String,
}

#[derive(Debug, Clone)]
pub struct OwnedContext {
    pub credential_fingerprint: String,
    pub generation: String,
    pub owner_key: String,
    pub dataset_id: String,
    pub actor: Actor,
    pub owner: Owner,
    pub can_write: bool,
    pub data_paths: StatePaths,
    pub app_root: PathBuf,
    pub workspace_root: PathBuf,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Receipt {
    version: u8,
    state: String,
    generation: String,
    scope_key: String,
    dataset_id: String,
    actor: Option<Actor>,
    owner: Option<Owner>,
    can_write: bool,
    credential_fingerprint: String,
    expires_at: String,
    data_root: PathBuf,
    app_root: PathBuf,
    workspace_root: PathBuf,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Pointer {
    version: u8,
    owner_key: String,
    dataset_id: String,
}

fn sha256(value: impl AsRef<[u8]>) -> String {
    Sha256::digest(value.as_ref())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn uuid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                byte == b'-'
            } else {
                byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)
            }
        })
}

fn read_json<T: DeserializeOwned>(path: &Path) -> Result<T> {
    read_private_json(path, 32 * 1024)
}

pub fn read_private_json<T: DeserializeOwned>(path: &Path, max_bytes: u64) -> Result<T> {
    let metadata =
        fs::symlink_metadata(path).with_context(|| format!("read {}", path.display()))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > max_bytes {
        bail!("invalid ownership record");
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
        if metadata.nlink() != 1 {
            bail!("ownership records cannot be hardlinked");
        }
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let file = options.open(path)?;
    let mut text = String::new();
    file.take(max_bytes + 1).read_to_string(&mut text)?;
    if text.len() as u64 > max_bytes {
        bail!("ownership record exceeds its limit");
    }
    Ok(serde_json::from_str(&text)?)
}

fn checked_directory(root: &Path, suffix: &[&str]) -> Result<PathBuf> {
    let mut path = root.to_path_buf();
    for segment in std::iter::once("").chain(suffix.iter().copied()) {
        if !segment.is_empty() {
            path.push(segment);
        }
        let info = fs::symlink_metadata(&path)?;
        if !info.is_dir() || info.file_type().is_symlink() {
            bail!("owned data directories cannot redirect outside their namespace");
        }
    }
    let expected = suffix
        .iter()
        .fold(root.canonicalize()?, |path, part| path.join(part));
    if path.canonicalize()? != expected {
        bail!("owned directory escaped its namespace");
    }
    Ok(path)
}

/// Missing/locked/expired identity means no private data. Errors must also hide
/// private data; callers must never fall back to machine-level member files.
pub fn read_active_context(service: &StatePaths) -> Result<Option<OwnedContext>> {
    let auth = read_autohand_user_auth();
    let Some(token) = auth.token.filter(|token| !token.trim().is_empty()) else {
        return Ok(None);
    };
    let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs();
    read_context_with_fingerprint(service, &sha256(token.trim()), now)
}

fn read_context_with_fingerprint(
    service: &StatePaths,
    fingerprint: &str,
    now: u64,
) -> Result<Option<OwnedContext>> {
    let receipt_path = service.root.join("ownership-active.json");
    if !receipt_path.exists() {
        return Ok(None);
    }
    let receipt: Receipt = read_json(&receipt_path)?;
    if receipt.version != 1
        || receipt.state != "ready"
        || receipt.credential_fingerprint != fingerprint
        || parse_rfc3339_unix(&receipt.expires_at).is_none_or(|expiry| expiry <= now)
    {
        return Ok(None);
    }
    let (Some(actor), Some(owner)) = (receipt.actor, receipt.owner) else {
        bail!("a ready context requires an actor and owner");
    };
    if actor.id.is_empty()
        || actor.id.len() > 256
        || owner.id.is_empty()
        || owner.id.len() > 256
        || actor.issuer != owner.issuer
        || !matches!(owner.kind.as_str(), "user" | "team")
        || (owner.kind == "user" && owner.id != actor.id)
        || !uuid(&receipt.generation)
        || !uuid(&receipt.dataset_id)
    {
        bail!("invalid owned identity");
    }
    let issuer = reqwest::Url::parse(&owner.issuer)?;
    let loopback = matches!(issuer.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if issuer.origin().ascii_serialization() != owner.issuer
        || !(issuer.scheme() == "https" || (issuer.scheme() == "http" && loopback))
    {
        bail!("invalid owned identity issuer");
    }
    let owner_key = sha256(serde_json::to_vec(&[
        &owner.issuer,
        &owner.kind,
        &owner.id,
    ])?);
    if receipt.scope_key != owner_key {
        bail!("owner key does not match the verified identity");
    }
    let root = service.root.as_path();
    let prefix = ["owners", owner_key.as_str()];
    let base = checked_directory(root, &prefix)?;
    let pointer: Pointer = read_json(&base.join("current.json"))?;
    if pointer.version != 1
        || pointer.owner_key != owner_key
        || pointer.dataset_id != receipt.dataset_id
    {
        return Ok(None); // A pointer swap invalidates an old receipt immediately.
    }
    let prefix = [
        "owners",
        owner_key.as_str(),
        "datasets",
        receipt.dataset_id.as_str(),
    ];
    let expected_root = checked_directory(root, &prefix)?;
    let data_root = checked_directory(&expected_root, &["state"])?;
    let app_root = checked_directory(&expected_root, &["app"])?;
    let workspace_root = checked_directory(&expected_root, &["member-homes"])?;
    if receipt.data_root != data_root
        || receipt.app_root != app_root
        || receipt.workspace_root != workspace_root
    {
        bail!("owned paths do not match the selected dataset");
    }
    let mut paths = StatePaths::from_root(data_root);
    // Infrastructure is machine-owned, even when a request operates on private
    // queues or status. Never start another supervisor inside the owner dataset.
    paths.bin_dir = service.bin_dir.clone();
    paths.config_json = service.config_json.clone();
    paths.daemon_json = service.daemon_json.clone();
    paths.install_json = service.install_json.clone();
    paths.device_id = service.device_id.clone();
    paths.web_server_json = service.web_server_json.clone();
    paths.web_server_log = service.web_server_log.clone();
    paths.update_json = service.update_json.clone();
    Ok(Some(OwnedContext {
        credential_fingerprint: receipt.credential_fingerprint,
        generation: receipt.generation,
        owner_key,
        dataset_id: receipt.dataset_id,
        actor,
        owner,
        can_write: receipt.can_write,
        data_paths: paths,
        app_root,
        workspace_root,
    }))
}

pub fn still_current(service: &StatePaths, captured: &OwnedContext) -> bool {
    read_active_context(service)
        .ok()
        .flatten()
        .is_some_and(|current| {
            current.generation == captured.generation
                && current.owner_key == captured.owner_key
                && current.dataset_id == captured.dataset_id
                && current.actor == captured.actor
                && current.can_write == captured.can_write
        })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use serde_json::{json, Value};

    pub(crate) struct Fixture {
        pub(crate) service: StatePaths,
        pub(crate) receipt: Value,
        fingerprint: String,
    }
    pub(crate) struct AuthGuard(Option<std::ffi::OsString>);
    impl Drop for AuthGuard {
        fn drop(&mut self) {
            match &self.0 {
                Some(value) => std::env::set_var("AUTOHAND_USER_CONFIG_PATH", value),
                None => std::env::remove_var("AUTOHAND_USER_CONFIG_PATH"),
            }
        }
    }
    impl Fixture {
        pub(crate) fn authenticate(&self) -> AuthGuard {
            self.read().unwrap().unwrap().data_paths.ensure().unwrap();
            let path = self.service.root.join("fixture-auth.json");
            fs::write(&path, r#"{"auth":{"token":"fixture-only-token"}}"#).unwrap();
            let guard = AuthGuard(std::env::var_os("AUTOHAND_USER_CONFIG_PATH"));
            std::env::set_var("AUTOHAND_USER_CONFIG_PATH", path);
            guard
        }
        pub(crate) fn new() -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let service = StatePaths::from_root(
                std::env::temp_dir()
                    .join(format!("squad-owned-native-{}-{nonce}", std::process::id())),
            );
            fs::create_dir_all(&service.root).unwrap();
            let owner = json!({"kind":"user", "issuer":"https://api.autohand.ai", "id":"alice"});
            let key =
                sha256(serde_json::to_vec(&["https://api.autohand.ai", "user", "alice"]).unwrap());
            let dataset = "6789abcd-1234-4abc-8def-0123456789ab";
            let base = service.root.join("owners").join(&key);
            let root = base.join("datasets").join(dataset);
            for name in ["state", "app", "member-homes", "logs"] {
                fs::create_dir_all(root.join(name)).unwrap();
            }
            fs::write(base.join("current.json"), json!({"version":1,"ownerKey":key,"datasetId":dataset,"createdAt":"2026-11-10T00:00:00.000Z"}).to_string()).unwrap();
            let fingerprint = sha256("fixture-only-token");
            let receipt = json!({"version":1,"state":"ready","generation":"1234abcd-1234-4abc-8def-0123456789ab", "scopeKey":key,"datasetId":dataset,
                "actor":{"issuer":"https://api.autohand.ai","id":"alice","email":"alice@example.test"},"owner":owner,"canWrite":true,"credentialFingerprint":fingerprint,
                "expiresAt":"2099-01-01T00:00:00.000Z","dataRoot":root.join("state"),"appRoot":root.join("app"),"workspaceRoot":root.join("member-homes")});
            let fixture = Self {
                service,
                receipt,
                fingerprint,
            };
            fixture.save();
            fixture
        }
        pub(crate) fn save(&self) {
            fs::write(
                self.service.root.join("ownership-active.json"),
                self.receipt.to_string(),
            )
            .unwrap();
        }
        pub(crate) fn read(&self) -> Result<Option<OwnedContext>> {
            read_context_with_fingerprint(&self.service, &self.fingerprint, 1_794_268_800)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.service.root);
        }
    }

    #[test]
    fn receipt_scopes_data_but_keeps_supervision_at_machine_root() {
        let fixture = Fixture::new();
        let context = fixture.read().unwrap().unwrap();
        assert_ne!(context.data_paths.root, fixture.service.root);
        assert_eq!(
            context.data_paths.channels_json,
            context.data_paths.root.join("channels.json")
        );
        assert_eq!(
            context.data_paths.web_server_json,
            fixture.service.web_server_json
        );
        assert_eq!(context.data_paths.daemon_json, fixture.service.daemon_json);
        assert_eq!(context.data_paths.bin_dir, fixture.service.bin_dir);
    }
    #[test]
    fn expired_locked_and_replaced_identity_never_return_private_paths() {
        let mut fixture = Fixture::new();
        assert!(
            read_context_with_fingerprint(&fixture.service, &sha256("different-token"), 0)
                .unwrap()
                .is_none()
        );
        fixture.receipt["state"] = json!("blocked");
        fixture.save();
        assert!(fixture.read().unwrap().is_none());
        fixture.receipt["state"] = json!("ready");
        fixture.receipt["expiresAt"] = json!("2000-01-01T00:00:00.000Z");
        fixture.save();
        assert!(fixture.read().unwrap().is_none());
    }
    #[test]
    fn foreign_paths_and_pointer_changes_fail_closed_without_legacy_fallback() {
        let mut fixture = Fixture::new();
        fixture.receipt["dataRoot"] = json!(fixture.service.root.join("state"));
        fixture.save();
        assert!(fixture.read().is_err());
        let base = fixture
            .service
            .root
            .join("owners")
            .join(fixture.receipt["scopeKey"].as_str().unwrap());
        fs::write(base.join("current.json"), json!({"version":1,"ownerKey":fixture.receipt["scopeKey"],"datasetId":"ffffffff-1234-4abc-8def-0123456789ab"}).to_string()).unwrap();
        fs::write(
            fixture.service.root.join("channels.json"),
            "{\"members\":[\"legacy\"]}",
        )
        .unwrap();
        assert!(fixture.read().unwrap().is_none());
    }
    #[cfg(unix)]
    #[test]
    fn owned_directories_cannot_be_symlinked_to_another_owner() {
        use std::os::unix::fs::symlink;
        let fixture = Fixture::new();
        let app = PathBuf::from(fixture.receipt["appRoot"].as_str().unwrap());
        let outside = fixture.service.root.join("other-owner");
        fs::create_dir_all(&outside).unwrap();
        fs::remove_dir(&app).unwrap();
        symlink(&outside, &app).unwrap();
        assert!(fixture.read().is_err());
    }
}
