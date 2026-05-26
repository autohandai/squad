use crate::state::{StatePaths, DEFAULT_HOST, DEFAULT_PORT};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::path::PathBuf;

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
}
