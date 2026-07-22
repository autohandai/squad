use crate::config::SquadConfig;
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::env;
use tokio::time::{sleep, Duration, Instant};

const DEFAULT_AUTH_BASE_URL: &str = "https://autohand.ai/api/auth";
const DEFAULT_AUTH_TIMEOUT_SECS: u64 = 5 * 60;
const DEFAULT_POLL_INTERVAL_SECS: u64 = 2;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BrowserLogin {
    pub token: String,
    pub email: String,
    pub name: Option<String>,
    pub authorization_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeviceAuthInitRequest<'a> {
    client_id: &'a str,
    source: &'a str,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeviceAuthInitResponse {
    success: Option<bool>,
    device_code: Option<String>,
    user_code: Option<String>,
    verification_uri: Option<String>,
    verification_uri_complete: Option<String>,
    expires_in: Option<u64>,
    interval: Option<u64>,
    error: Option<String>,
    message: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeviceAuthPollRequest<'a> {
    device_code: &'a str,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeviceAuthPollResponse {
    success: Option<bool>,
    status: Option<String>,
    token: Option<String>,
    user: Option<AuthUser>,
    error: Option<String>,
    message: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AuthUser {
    email: Option<String>,
    name: Option<String>,
}

pub async fn run_browser_device_login(config: &SquadConfig, source: &str) -> Result<BrowserLogin> {
    let client = reqwest::Client::new();
    let base_url = auth_base_url(config);
    let init_url = format!("{}/cli/initiate", base_url.trim_end_matches('/'));
    let init = client
        .post(&init_url)
        .json(&DeviceAuthInitRequest {
            client_id: "autohand-squad",
            source,
        })
        .send()
        .await
        .with_context(|| format!("start browser login at {init_url}"))?;
    let init_status = init.status();
    let init_body = init
        .json::<DeviceAuthInitResponse>()
        .await
        .context("parse browser login response")?;

    if !init_status.is_success() || init_body.success == Some(false) {
        bail!(
            "{}",
            init_body
                .error
                .or(init_body.message)
                .unwrap_or_else(|| format!(
                    "browser login failed with HTTP {}",
                    init_status.as_u16()
                ))
        );
    }

    let device_code = required_field(init_body.device_code, "device code")?;
    let user_code = required_field(init_body.user_code, "user code")?;
    let authorization_url = authorization_url(
        init_body.verification_uri_complete,
        init_body.verification_uri,
        &user_code,
        source,
    )?;
    let timeout = Duration::from_secs(init_body.expires_in.unwrap_or(DEFAULT_AUTH_TIMEOUT_SECS));
    let poll_interval = Duration::from_secs(
        init_body
            .interval
            .unwrap_or(DEFAULT_POLL_INTERVAL_SECS)
            .max(1),
    );

    open_url(&authorization_url)?;

    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        sleep(poll_interval).await;

        let poll_url = format!("{}/cli/poll", base_url.trim_end_matches('/'));
        let poll = client
            .post(&poll_url)
            .json(&DeviceAuthPollRequest {
                device_code: &device_code,
            })
            .send()
            .await
            .with_context(|| format!("poll browser login at {poll_url}"))?;
        let poll_status = poll.status();
        let poll_body = poll
            .json::<DeviceAuthPollResponse>()
            .await
            .context("parse browser login poll response")?;

        if !poll_status.is_success() || poll_body.success == Some(false) {
            bail!(
                "{}",
                poll_body
                    .error
                    .or(poll_body.message)
                    .unwrap_or_else(|| format!(
                        "browser login poll failed with HTTP {}",
                        poll_status.as_u16()
                    ))
            );
        }

        match poll_body.status.as_deref().unwrap_or("pending") {
            "pending" => continue,
            "authorized" => {
                let token = required_field(poll_body.token, "session token")?;
                let user = poll_body.user.context("authorized response missing user")?;
                let email = required_field(user.email, "account email")?;
                return Ok(BrowserLogin {
                    token,
                    email,
                    name: user.name,
                    authorization_url,
                });
            }
            "expired" => bail!("browser login expired"),
            "cancelled" => bail!("browser login was cancelled"),
            other => bail!("browser login returned unknown status: {other}"),
        }
    }

    bail!("browser login timed out")
}

pub fn auth_base_url(config: &SquadConfig) -> String {
    env::var("AUTOHAND_SQUAD_AUTH_BASE_URL")
        .or_else(|_| env::var("AUTOHAND_AUTH_BASE_URL"))
        .ok()
        .and_then(non_empty)
        .or_else(|| auth_base_from_api_base(&config.api_base_url))
        .unwrap_or_else(|| DEFAULT_AUTH_BASE_URL.to_string())
}

fn auth_base_from_api_base(api_base_url: &str) -> Option<String> {
    let trimmed = api_base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() || trimmed == "https://api.autohand.ai" {
        return Some(DEFAULT_AUTH_BASE_URL.to_string());
    }

    let origin = http_origin(trimmed)?;
    if trimmed == format!("{origin}/api") {
        return Some(format!("{origin}/api/auth"));
    }

    if origin == "https://autohand.ai" || origin.ends_with(".autohand.ai") {
        return Some(format!("{origin}/api/auth"));
    }

    None
}

fn authorization_url(
    complete: Option<String>,
    verification_uri: Option<String>,
    user_code: &str,
    source: &str,
) -> Result<String> {
    if let Some(url) = complete.and_then(non_empty) {
        return Ok(url);
    }

    let Some(base) = verification_uri.and_then(non_empty) else {
        bail!("browser login response missing authorization URL");
    };
    let separator = if base.contains('?') { '&' } else { '?' };
    let source_param = if source == "cli" {
        String::new()
    } else {
        format!("&source={}", encode_query_component(source))
    };
    Ok(format!(
        "{base}{separator}code={}{}",
        encode_query_component(user_code),
        source_param
    ))
}

fn required_field(value: Option<String>, label: &str) -> Result<String> {
    let Some(value) = value.and_then(non_empty) else {
        bail!("browser login response missing {label}");
    };
    Ok(value)
}

fn non_empty(value: String) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn http_origin(url: &str) -> Option<String> {
    let scheme_end = url.find("://")?;
    let scheme = &url[..scheme_end];
    if scheme != "http" && scheme != "https" {
        return None;
    }
    let rest = &url[scheme_end + 3..];
    let authority = rest.split('/').next().unwrap_or(rest);
    (!authority.is_empty()).then(|| format!("{scheme}://{authority}"))
}

fn encode_query_component(value: &str) -> String {
    value
        .bytes()
        .flat_map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                vec![byte as char]
            }
            _ => format!("%{byte:02X}").chars().collect(),
        })
        .collect()
}

fn open_url(url: &str) -> Result<()> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = std::process::Command::new("open");
        command.arg(url);
        command
    };

    #[cfg(target_os = "linux")]
    let mut command = {
        let mut command = std::process::Command::new("xdg-open");
        command.arg(url);
        command
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = std::process::Command::new("cmd");
        command.args(["/C", "start", "", url]);
        command
    };

    command.spawn().context("open Autohand login URL")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_default_api_origin_to_web_auth() {
        assert_eq!(
            auth_base_from_api_base("https://api.autohand.ai").as_deref(),
            Some("https://autohand.ai/api/auth")
        );
    }

    #[test]
    fn builds_authorization_url_when_complete_url_is_missing() {
        assert_eq!(
            authorization_url(
                None,
                Some("https://autohand.ai/cli-auth".to_string()),
                "ABC-123",
                "squad",
            )
            .unwrap(),
            "https://autohand.ai/cli-auth?code=ABC-123&source=squad"
        );
    }
}
