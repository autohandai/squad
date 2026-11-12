//! Filesystem-only native authority fixtures; never start the application or
//! use the installed app's root, credentials, permissions or notifications.
use autohand_squad_runtime::ownership::OwnedContext;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    ffi::OsString,
    fs,
    path::PathBuf,
    sync::{Mutex, MutexGuard},
};

static ENVIRONMENT: Mutex<()> = Mutex::new(());
pub(crate) struct Fixture {
    root: PathBuf,
    environment: Vec<(&'static str, Option<OsString>)>,
    _guard: MutexGuard<'static, ()>,
}
impl Fixture {
    pub(crate) fn new() -> Self {
        let guard = ENVIRONMENT
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let mut bytes = [0_u8; 16];
        getrandom::fill(&mut bytes).unwrap();
        let nonce: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
        let root = std::env::temp_dir().join(format!("squad-native-authority-{nonce}"));
        fs::create_dir_all(&root).unwrap();
        let environment = ["AUTOHAND_SQUAD_HOME", "AUTOHAND_USER_CONFIG_PATH"]
            .into_iter()
            .map(|name| (name, std::env::var_os(name)))
            .collect();
        let fixture = Self {
            root,
            environment,
            _guard: guard,
        };
        std::env::set_var("AUTOHAND_SQUAD_HOME", &fixture.root);
        std::env::set_var(
            "AUTOHAND_USER_CONFIG_PATH",
            fixture.root.join("fixture-auth.json"),
        );
        assert_eq!(crate::default_paths().root, fixture.root);
        fixture
    }
    pub(crate) fn select(&self, id: &str, generation: &str) -> OwnedContext {
        let issuer = "https://api.autohand.ai";
        let key = format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&[issuer, "user", id]).unwrap())
        );
        let dataset = "6789abcd-1234-4abc-8def-0123456789ab";
        let base = self.root.join("owners").join(&key);
        let root = base.join("datasets").join(dataset);
        for name in ["state", "app", "member-homes", "logs"] {
            fs::create_dir_all(root.join(name)).unwrap();
        }
        fs::write(
            base.join("current.json"),
            json!({"version":1,"ownerKey":key,"datasetId":dataset}).to_string(),
        )
        .unwrap();
        let token = format!("fixture-only-token-{id}");
        fs::write(
            self.root.join("fixture-auth.json"),
            json!({"auth":{"token":token}}).to_string(),
        )
        .unwrap();
        fs::write(self.root.join("ownership-active.json"),json!({"version":1,"state":"ready","generation":generation,"scopeKey":key,"datasetId":dataset,
            "actor":{"issuer":issuer,"id":id,"email":format!("{id}@example.test")},"owner":{"kind":"user","issuer":issuer,"id":id},"canWrite":true,
            "credentialFingerprint":format!("{:x}",Sha256::digest(token.as_bytes())),"expiresAt":"2099-01-01T00:00:00.000Z",
            "dataRoot":root.join("state"),"appRoot":root.join("app"),"workspaceRoot":root.join("member-homes")}).to_string()).unwrap();
        crate::require_native_context(generation, true).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        for (name, value) in &self.environment {
            match value {
                Some(value) => std::env::set_var(name, value),
                None => std::env::remove_var(name),
            }
        }
        let _ = fs::remove_dir_all(&self.root);
    }
}
