use crate::state::{StatePaths, DEFAULT_HOST, DEFAULT_PORT};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::env;
use std::fs;
use std::io::Write;
#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};

const DEFAULT_API_BASE_URL: &str = "https://api.autohand.ai";
const DEFAULT_UPDATE_CHANNEL: &str = "stable";
const DEFAULT_LAUNCH_AT_LOGIN_POLICY: &str = "user-controlled";
const DEFAULT_TELEMETRY_POLICY: &str = "local-buffered";
const DEFAULT_PLAN_STATE: &str = "unknown";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SquadConfig {
    pub host: String,
    pub port: u16,
    pub fixed_port: Option<u16>,
    pub open_url: String,
    pub hosted_ui_url: Option<String>,
    pub proxy_url: Option<String>,
    pub api_gateway_url: Option<String>,
    pub api_base_url: String,
    pub api_auth_token: Option<String>,
    pub company_secret: Option<String>,
    pub update_channel: String,
    pub launch_at_login_policy: String,
    pub telemetry_policy: String,
    pub account_email: Option<String>,
    pub plan_state: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PartialSquadConfig {
    pub host: Option<String>,
    pub port: Option<u16>,
    pub fixed_port: Option<u16>,
    pub open_url: Option<String>,
    pub hosted_ui_url: Option<String>,
    pub proxy_url: Option<String>,
    pub api_gateway_url: Option<String>,
    pub api_base_url: Option<String>,
    pub api_auth_token: Option<String>,
    pub company_secret: Option<String>,
    pub update_channel: Option<String>,
    pub launch_at_login_policy: Option<String>,
    pub telemetry_policy: Option<String>,
    pub account_email: Option<String>,
    pub plan_state: Option<String>,
}

pub type ConfigOverrides = PartialSquadConfig;

impl SquadConfig {
    pub fn defaults() -> Self {
        let host = DEFAULT_HOST.to_string();
        let port = DEFAULT_PORT;
        let open_url = format!("http://{host}:{port}");
        Self {
            host,
            port,
            fixed_port: None,
            open_url,
            hosted_ui_url: None,
            proxy_url: None,
            api_gateway_url: None,
            api_base_url: DEFAULT_API_BASE_URL.to_string(),
            api_auth_token: None,
            company_secret: None,
            update_channel: DEFAULT_UPDATE_CHANNEL.to_string(),
            launch_at_login_policy: DEFAULT_LAUNCH_AT_LOGIN_POLICY.to_string(),
            telemetry_policy: DEFAULT_TELEMETRY_POLICY.to_string(),
            account_email: None,
            plan_state: DEFAULT_PLAN_STATE.to_string(),
        }
    }

    pub fn base_url(&self) -> String {
        format!("http://{}:{}", self.host, self.port)
    }

    pub fn apply(&mut self, partial: PartialSquadConfig) {
        let open_url = non_empty(partial.open_url);
        let hosted_ui_url = non_empty(partial.hosted_ui_url);
        let api_gateway_url = non_empty(partial.api_gateway_url);
        let api_base_url = non_empty(partial.api_base_url);
        let has_api_auth_token = partial.api_auth_token.is_some();
        let has_company_secret = partial.company_secret.is_some();
        let api_auth_token = non_empty(partial.api_auth_token);
        let company_secret = non_empty(partial.company_secret);

        if let Some(value) = non_empty(partial.host) {
            self.host = value;
        }
        if let Some(value) = partial.fixed_port {
            self.fixed_port = Some(value);
            self.port = value;
        }
        if let Some(value) = partial.port {
            self.port = value;
        }
        if let Some(value) = hosted_ui_url {
            self.hosted_ui_url = Some(value.clone());
            if open_url.is_none() {
                self.open_url = value;
            }
        }
        if let Some(value) = open_url {
            self.open_url = value;
        }
        if partial.proxy_url.is_some() {
            self.proxy_url = non_empty(partial.proxy_url);
        }
        if let Some(value) = api_gateway_url {
            let value = trim_trailing_slashes(value);
            self.api_gateway_url = Some(value.clone());
            if api_base_url.is_none() {
                self.api_base_url = value;
            }
        }
        if let Some(value) = api_base_url {
            self.api_base_url = trim_trailing_slashes(value);
        }
        if has_api_auth_token {
            self.api_auth_token = api_auth_token;
        }
        if has_company_secret {
            self.company_secret = company_secret;
        }
        if let Some(value) = non_empty(partial.update_channel) {
            self.update_channel = value;
        }
        if let Some(value) = non_empty(partial.launch_at_login_policy) {
            self.launch_at_login_policy = value;
        }
        if let Some(value) = non_empty(partial.telemetry_policy) {
            self.telemetry_policy = value;
        }
        if partial.account_email.is_some() {
            self.account_email = non_empty(partial.account_email);
        }
        if let Some(value) = non_empty(partial.plan_state) {
            self.plan_state = value;
        }
    }

    pub fn telemetry_enabled(&self) -> bool {
        !matches!(
            self.telemetry_policy.to_ascii_lowercase().as_str(),
            "disabled" | "off" | "false" | "none"
        )
    }
}

pub fn resolve_config(paths: &StatePaths, cli: ConfigOverrides) -> Result<SquadConfig> {
    let mut config = SquadConfig::defaults();

    if let Some(user_config) = read_partial_config(&paths.config_json)? {
        config.apply(user_config);
    }

    if let Some(admin_path) = admin_config_path() {
        if let Some(admin_config) = read_partial_config(&admin_path)? {
            config.apply(admin_config);
        }
    }

    config.apply(env_config());
    config.apply(cli);

    if config.open_url == SquadConfig::defaults().open_url {
        config.open_url = config.base_url();
    }

    Ok(config)
}

pub fn write_user_auth_config(
    paths: &StatePaths,
    api_auth_token: Option<&str>,
    account_email: Option<&str>,
) -> Result<()> {
    paths.ensure()?;
    let mut config = if paths.config_json.exists() {
        let content = fs::read_to_string(&paths.config_json)
            .with_context(|| format!("read {}", paths.config_json.display()))?;
        serde_json::from_str::<Value>(&content)
            .with_context(|| format!("parse {}", paths.config_json.display()))?
    } else {
        Value::Object(Map::new())
    };

    if !config.is_object() {
        config = Value::Object(Map::new());
    }
    let object = config.as_object_mut().expect("config object");
    object.insert(
        "apiAuthToken".to_string(),
        Value::String(api_auth_token.unwrap_or("").to_string()),
    );
    object.insert(
        "accountEmail".to_string(),
        Value::String(account_email.unwrap_or("").to_string()),
    );

    let content = format!("{}\n", serde_json::to_string_pretty(&config)?);
    write_private_config(&paths.config_json, &content, "Squad config")
}

/// Merge the Squad browser session into the Autohand CLI config used as the
/// source for isolated member configs. Passing `None` clears only the persisted
/// token so logout does not discard provider, permission, or user-profile data.
pub fn write_autohand_auth_config(
    api_auth_token: Option<&str>,
    account_email: Option<&str>,
) -> Result<()> {
    merge_autohand_auth_config_at(&autohand_user_config_path(), api_auth_token, account_email)
}

fn autohand_user_config_path() -> PathBuf {
    if let Some(path) = non_empty_env("AUTOHAND_USER_CONFIG_PATH") {
        return PathBuf::from(path);
    }
    if let Some(root) = non_empty_env("AUTOHAND_HOME") {
        return PathBuf::from(root).join("config.json");
    }

    let home_vars = if cfg!(target_os = "windows") {
        ["USERPROFILE", "HOME"]
    } else {
        ["HOME", "USERPROFILE"]
    };
    home_vars
        .into_iter()
        .find_map(non_empty_env)
        .map(PathBuf::from)
        .map(|home| home.join(".autohand").join("config.json"))
        .unwrap_or_else(|| PathBuf::from(".autohand").join("config.json"))
}

fn merge_autohand_auth_config_at(
    path: &Path,
    api_auth_token: Option<&str>,
    account_email: Option<&str>,
) -> Result<()> {
    let mut config = if path.exists() {
        let content = fs::read_to_string(path)
            .with_context(|| format!("read Autohand config {}", path.display()))?;
        serde_json::from_str::<Value>(&content)
            .with_context(|| format!("parse Autohand config {}", path.display()))?
    } else {
        Value::Object(Map::new())
    };

    let config_object = config
        .as_object_mut()
        .context("Autohand config root must be a JSON object")?;
    let auth = config_object
        .entry("auth")
        .or_insert_with(|| Value::Object(Map::new()));
    if !auth.is_object() {
        *auth = Value::Object(Map::new());
    }
    let auth_object = auth.as_object_mut().expect("auth object");

    match api_auth_token {
        Some(token) => {
            let token = token.trim();
            if token.is_empty() {
                bail!("Autohand auth token must not be empty");
            }
            auth_object.insert("token".to_string(), Value::String(token.to_string()));
            // The device-login response does not supply expiry metadata. An
            // expiresAt value from an older session would make the fresh token
            // look expired to the web preflight.
            auth_object.remove("expiresAt");
            auth_object.remove("refreshToken");
        }
        None => {
            auth_object.remove("token");
            auth_object.remove("refreshToken");
            auth_object.remove("expiresAt");
        }
    }

    if let Some(email) = account_email {
        let email = email.trim();
        if email.is_empty() {
            bail!("Autohand account email must not be empty");
        }
        // Do not retain identity fields from a different account when the tray
        // is used to re-login. The device flow supplies only a trusted email,
        // so persist that minimal user shape.
        let mut user = Map::new();
        user.insert("email".to_string(), Value::String(email.to_string()));
        auth_object.insert("user".to_string(), Value::Object(user));
    }

    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent)
            .with_context(|| format!("create Autohand config directory {}", parent.display()))?;
    }
    let content = format!("{}\n", serde_json::to_string_pretty(&config)?);
    write_private_config(path, &content, "Autohand config")
}

fn write_private_config(path: &Path, content: &str, description: &str) -> Result<()> {
    #[cfg(unix)]
    if path.exists() {
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .with_context(|| format!("secure {description} {}", path.display()))?;
    }
    let mut options = fs::OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options
        .open(path)
        .with_context(|| format!("open {description} {}", path.display()))?;
    file.write_all(content.as_bytes())
        .with_context(|| format!("write {description} {}", path.display()))?;
    #[cfg(unix)]
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .with_context(|| format!("secure {description} {}", path.display()))?;
    Ok(())
}

fn read_partial_config(path: &PathBuf) -> Result<Option<PartialSquadConfig>> {
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(path).with_context(|| format!("read {}", path.display()))?;
    let config =
        serde_json::from_str(&content).with_context(|| format!("parse {}", path.display()))?;
    Ok(Some(config))
}

fn admin_config_path() -> Option<PathBuf> {
    if let Ok(path) = env::var("AUTOHAND_SQUAD_ADMIN_CONFIG") {
        if !path.trim().is_empty() {
            return Some(PathBuf::from(path));
        }
    }
    let path = PathBuf::from("/etc/autohand/squad/config.json");
    path.exists().then_some(path)
}

fn env_config() -> PartialSquadConfig {
    PartialSquadConfig {
        host: env::var("AUTOHAND_SQUAD_HOST").ok(),
        port: env::var("AUTOHAND_SQUAD_PORT")
            .ok()
            .and_then(|value| value.parse::<u16>().ok()),
        fixed_port: env::var("AUTOHAND_SQUAD_FIXED_PORT")
            .ok()
            .and_then(|value| value.parse::<u16>().ok()),
        open_url: env::var("AUTOHAND_SQUAD_OPEN_URL").ok(),
        hosted_ui_url: env::var("AUTOHAND_SQUAD_HOSTED_UI_URL").ok(),
        proxy_url: env::var("AUTOHAND_SQUAD_PROXY_URL").ok(),
        api_gateway_url: env::var("AUTOHAND_SQUAD_API_GATEWAY_URL").ok(),
        api_base_url: env::var("AUTOHAND_SQUAD_API_BASE_URL")
            .or_else(|_| env::var("AUTOHAND_API_URL"))
            .ok(),
        api_auth_token: env::var("AUTOHAND_SQUAD_API_AUTH_TOKEN")
            .or_else(|_| env::var("AUTOHAND_SQUAD_AUTH_TOKEN"))
            .or_else(|_| env::var("AUTOHAND_TOKEN"))
            .ok(),
        company_secret: env::var("AUTOHAND_SQUAD_COMPANY_SECRET")
            .or_else(|_| env::var("AUTOHAND_SECRET"))
            .ok(),
        update_channel: env::var("AUTOHAND_SQUAD_UPDATE_CHANNEL").ok(),
        launch_at_login_policy: env::var("AUTOHAND_SQUAD_LAUNCH_AT_LOGIN_POLICY").ok(),
        telemetry_policy: env::var("AUTOHAND_SQUAD_TELEMETRY_POLICY").ok(),
        account_email: env::var("AUTOHAND_SQUAD_ACCOUNT_EMAIL").ok(),
        plan_state: env::var("AUTOHAND_SQUAD_PLAN_STATE").ok(),
    }
}

fn trim_trailing_slashes(value: String) -> String {
    value.trim_end_matches('/').to_string()
}

fn non_empty(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn non_empty_env(name: &str) -> Option<String> {
    env::var(name).ok().and_then(|value| non_empty(Some(value)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::StatePaths;
    use std::sync::Mutex;
    use std::time::{SystemTime, UNIX_EPOCH};

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn temp_root() -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "autohand-squad-config-test-{}-{nonce}",
            std::process::id()
        ))
    }

    #[test]
    fn applies_user_admin_env_and_cli_precedence() {
        let _guard = ENV_LOCK.lock().unwrap();
        let temp = temp_root();
        let paths = StatePaths::from_root(temp.join("state"));
        paths.ensure().unwrap();
        fs::write(
            &paths.config_json,
            r#"{"host":"user-host","port":1111,"updateChannel":"beta"}"#,
        )
        .unwrap();

        let admin_path = temp.join("admin.json");
        fs::write(&admin_path, r#"{"host":"admin-host","port":2222}"#).unwrap();
        env::set_var("AUTOHAND_SQUAD_ADMIN_CONFIG", &admin_path);
        env::set_var("AUTOHAND_SQUAD_PORT", "3333");

        let config = resolve_config(
            &paths,
            PartialSquadConfig {
                host: Some("cli-host".to_string()),
                ..PartialSquadConfig::default()
            },
        )
        .unwrap();

        assert_eq!(config.host, "cli-host");
        assert_eq!(config.port, 3333);
        assert_eq!(config.update_channel, "beta");

        env::remove_var("AUTOHAND_SQUAD_ADMIN_CONFIG");
        env::remove_var("AUTOHAND_SQUAD_PORT");
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn applies_enterprise_hosted_ui_and_policy_fields() {
        let _guard = ENV_LOCK.lock().unwrap();
        env::remove_var("AUTOHAND_SQUAD_ADMIN_CONFIG");
        env::remove_var("AUTOHAND_SQUAD_PORT");
        let temp = temp_root();
        let paths = StatePaths::from_root(temp.join("state"));
        paths.ensure().unwrap();
        fs::write(
            &paths.config_json,
            r#"{"hostedUiUrl":"https://squad.example.com","fixedPort":19830,"proxyUrl":"http://proxy.local","apiGatewayUrl":"https://gateway.example.com/","apiAuthToken":"device-token","companySecret":"company-secret","launchAtLoginPolicy":"forced","telemetryPolicy":"disabled","accountEmail":"ops@example.com","planState":"enterprise"}"#,
        )
        .unwrap();

        let config = resolve_config(&paths, PartialSquadConfig::default()).unwrap();

        assert_eq!(config.port, 19830);
        assert_eq!(config.fixed_port, Some(19830));
        assert_eq!(config.open_url, "https://squad.example.com");
        assert_eq!(
            config.hosted_ui_url.as_deref(),
            Some("https://squad.example.com")
        );
        assert_eq!(config.api_base_url, "https://gateway.example.com");
        assert_eq!(
            config.api_gateway_url.as_deref(),
            Some("https://gateway.example.com")
        );
        assert_eq!(config.api_auth_token.as_deref(), Some("device-token"));
        assert_eq!(config.company_secret.as_deref(), Some("company-secret"));
        assert_eq!(config.launch_at_login_policy, "forced");
        assert!(!config.telemetry_enabled());
        assert_eq!(config.account_email.as_deref(), Some("ops@example.com"));
        assert_eq!(config.plan_state, "enterprise");
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn user_auth_config_patch_preserves_existing_runtime_fields() {
        let _guard = ENV_LOCK.lock().unwrap();
        env::remove_var("AUTOHAND_SQUAD_ADMIN_CONFIG");
        let temp = temp_root();
        let paths = StatePaths::from_root(temp.join("state"));
        paths.ensure().unwrap();
        fs::write(
            &paths.config_json,
            r#"{"apiBaseUrl":"https://gateway.example.com","updateChannel":"beta"}"#,
        )
        .unwrap();

        write_user_auth_config(&paths, Some("session-token"), Some("ops@example.com")).unwrap();
        let value: Value =
            serde_json::from_str(&fs::read_to_string(&paths.config_json).unwrap()).unwrap();

        assert_eq!(
            value.get("apiBaseUrl").and_then(Value::as_str),
            Some("https://gateway.example.com")
        );
        assert_eq!(
            value.get("updateChannel").and_then(Value::as_str),
            Some("beta")
        );
        assert_eq!(
            value.get("apiAuthToken").and_then(Value::as_str),
            Some("session-token")
        );
        assert_eq!(
            value.get("accountEmail").and_then(Value::as_str),
            Some("ops@example.com")
        );
        #[cfg(unix)]
        assert_eq!(
            fs::metadata(&paths.config_json)
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn autohand_auth_merge_creates_nested_auth_and_preserves_existing_config() {
        let temp = temp_root();
        let config_path = temp.join("user-home").join(".autohand").join("config.json");
        fs::create_dir_all(config_path.parent().unwrap()).unwrap();
        fs::write(
            &config_path,
            r#"{
              "provider": "openrouter",
              "permissions": { "mode": "restricted" },
              "auth": {
                "expiresAt": "2000-01-01T00:00:00.000Z",
                "user": { "id": "user-1", "name": "Existing Name" }
              }
            }"#,
        )
        .unwrap();

        merge_autohand_auth_config_at(
            &config_path,
            Some("fresh-session-token"),
            Some("ops@example.com"),
        )
        .unwrap();
        let value: Value =
            serde_json::from_str(&fs::read_to_string(&config_path).unwrap()).unwrap();

        assert_eq!(
            value.get("provider").and_then(Value::as_str),
            Some("openrouter")
        );
        assert_eq!(
            value.pointer("/permissions/mode").and_then(Value::as_str),
            Some("restricted")
        );
        assert_eq!(
            value.pointer("/auth/token").and_then(Value::as_str),
            Some("fresh-session-token")
        );
        assert_eq!(
            value.pointer("/auth/user/email").and_then(Value::as_str),
            Some("ops@example.com")
        );
        assert!(value.pointer("/auth/user/id").is_none());
        assert!(value.pointer("/auth/user/name").is_none());
        assert!(value.pointer("/auth/expiresAt").is_none());
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn autohand_auth_merge_creates_a_fresh_user_config() {
        let temp = temp_root();
        let config_path = temp.join("new-home").join(".autohand").join("config.json");

        merge_autohand_auth_config_at(
            &config_path,
            Some("fresh-session-token"),
            Some("first-login@example.com"),
        )
        .unwrap();
        let value: Value =
            serde_json::from_str(&fs::read_to_string(&config_path).unwrap()).unwrap();

        assert_eq!(
            value.pointer("/auth/token").and_then(Value::as_str),
            Some("fresh-session-token")
        );
        assert_eq!(
            value.pointer("/auth/user/email").and_then(Value::as_str),
            Some("first-login@example.com")
        );
        assert_eq!(value.as_object().map(Map::len), Some(1));
        #[cfg(unix)]
        assert_eq!(
            fs::metadata(&config_path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn autohand_auth_logout_removes_session_credentials_only() {
        let temp = temp_root();
        let config_path = temp.join("config.json");
        fs::create_dir_all(&temp).unwrap();
        fs::write(
            &config_path,
            r#"{
              "provider": "openai",
              "auth": {
                "token": "session-to-clear",
                "refreshToken": "refresh-to-clear",
                "expiresAt": "2099-01-01T00:00:00.000Z",
                "user": { "email": "ops@example.com", "id": "user-1" }
              }
            }"#,
        )
        .unwrap();

        merge_autohand_auth_config_at(&config_path, None, None).unwrap();
        let value: Value =
            serde_json::from_str(&fs::read_to_string(&config_path).unwrap()).unwrap();

        assert!(value.pointer("/auth/token").is_none());
        assert!(value.pointer("/auth/refreshToken").is_none());
        assert!(value.pointer("/auth/expiresAt").is_none());
        assert_eq!(
            value.pointer("/auth/user/email").and_then(Value::as_str),
            Some("ops@example.com")
        );
        assert_eq!(
            value.get("provider").and_then(Value::as_str),
            Some("openai")
        );
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn autohand_auth_merge_does_not_replace_a_non_object_config() {
        let temp = temp_root();
        let config_path = temp.join("config.json");
        fs::create_dir_all(&temp).unwrap();
        fs::write(&config_path, "[]\n").unwrap();

        let error = merge_autohand_auth_config_at(
            &config_path,
            Some("fresh-session-token"),
            Some("ops@example.com"),
        )
        .unwrap_err();

        assert!(error
            .to_string()
            .contains("Autohand config root must be a JSON object"));
        assert_eq!(fs::read_to_string(&config_path).unwrap(), "[]\n");
        let _ = fs::remove_dir_all(temp);
    }
}
