//! Squad's public release control plane. No account token or device identity
//! is sent when checking updates. Private cloud sessions belong to the bridge.
use crate::install::{self, GithubReleaseSummary, ReleaseArtifact, ReleaseManifest};
use anyhow::{bail, ensure, Context, Result};
use serde::Deserialize;

pub const DEFAULT_ORIGIN: &str = "https://squad.autohand.ai";

#[derive(Debug)]
struct Unavailable;
impl std::fmt::Display for Unavailable {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Squad's release service is temporarily unavailable")
    }
}
impl std::error::Error for Unavailable {}

pub struct DiscoveredRelease {
    pub release: GithubReleaseSummary,
    pub source: String,
    pub manifest_url: String,
}

#[derive(Debug)]
pub struct DiscoveryError {
    pub source: String,
    pub manifest_url: String,
    error: anyhow::Error,
}
impl std::fmt::Display for DiscoveryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:#}", self.error)
    }
}
impl std::error::Error for DiscoveryError {}

pub fn origin() -> Result<String> {
    let configured =
        std::env::var("AUTOHAND_SQUAD_API_URL").unwrap_or_else(|_| DEFAULT_ORIGIN.into());
    let url = reqwest::Url::parse(&configured).context("Invalid Squad API origin")?;
    let local = matches!(
        url.host_str(),
        Some("127.0.0.1" | "localhost" | "[::1]" | "::1")
    );
    ensure!(
        (url.scheme() == "https" || (url.scheme() == "http" && local))
            && url.username().is_empty()
            && url.password().is_none()
            && url.path() == "/"
            && url.query().is_none()
            && url.fragment().is_none(),
        "Squad API must be an HTTPS origin or local development server"
    );
    Ok(url.origin().ascii_serialization())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Feed {
    schema_version: u32,
    channel: String,
    version: String,
    release_url: String,
    released_at: String,
    notes: String,
    assets: Vec<Asset>,
}
#[derive(Deserialize)]
struct Asset {
    os: String,
    arch: String,
    name: String,
    url: String,
    sha256: String,
    bytes: u64,
}

fn parse_feed(bytes: &[u8], channel: &str) -> Result<GithubReleaseSummary> {
    let feed: Feed = serde_json::from_slice(bytes).context("Invalid Squad release metadata")?;
    let core = feed.version.split('-').next().unwrap_or("");
    let parts: Vec<_> = core.split('.').collect();
    ensure!(
        feed.schema_version == 1
            && feed.channel == channel
            && parts.len() == 3
            && parts
                .iter()
                .all(|part| !part.is_empty() && part.parse::<u64>().is_ok())
            && feed
                .version
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b".-".contains(&c)),
        "Invalid Squad release version or channel"
    );
    ensure!(
        !feed.assets.is_empty() && feed.assets.len() <= 12,
        "Invalid Squad installer list"
    );
    let tags = [feed.version.clone(), format!("v{}", feed.version)];
    ensure!(
        tags.iter().any(|tag| feed.release_url
            == format!("https://github.com/autohandai/squad/releases/tag/{tag}")),
        "Squad release notes must come from the official repository"
    );
    let mut artifacts = Vec::new();
    for asset in feed.assets {
        let (os, arch, component) =
            install::classify_asset(&asset.name).context("Unknown Squad installer")?;
        let api_arch = if arch == "aarch64" { "arm64" } else { "x64" };
        ensure!(
            asset.os == os
                && asset.arch == api_arch
                && asset
                    .name
                    .starts_with(&format!("autohand-squad-{}-{os}-{api_arch}", feed.version))
                && matches!(component, "dmg" | "installer" | "msi" | "deb" | "appimage"),
            "Squad installer does not match its platform"
        );
        ensure!(
            asset.bytes > 0
                && asset.bytes <= 2 * 1024 * 1024 * 1024
                && asset.sha256.len() == 64
                && asset.sha256.bytes().all(|byte| byte.is_ascii_hexdigit()),
            "Squad installer checksum is missing"
        );
        ensure!(
            tags.iter().any(|tag| asset.url
                == format!(
                    "https://github.com/autohandai/squad/releases/download/{tag}/{}",
                    asset.name
                )),
            "Squad installer must come from the official release"
        );
        artifacts.push(ReleaseArtifact {
            os: os.into(),
            arch: arch.into(),
            component: Some(component.into()),
            binary_name: Some(asset.name),
            url: asset.url,
            sha256: asset.sha256.to_lowercase(),
            signature: None,
            public_key: None,
        });
    }
    Ok(GithubReleaseSummary {
        version: feed.version.clone(),
        tag: format!("v{}", feed.version),
        release_url: feed.release_url,
        published_at: feed.released_at,
        notes: feed.notes,
        manifest: ReleaseManifest {
            latest_allowed_version: feed.version,
            channel: channel.into(),
            artifacts,
        },
    })
}

async fn from_api(channel: &str) -> Result<DiscoveredRelease> {
    let url = format!("{}/v1/releases/{channel}/manifest", origin()?);
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(std::time::Duration::from_secs(3))
        .timeout(std::time::Duration::from_secs(8))
        .user_agent(format!("autohand-squad/{}", crate::VERSION))
        .build()?;
    let mut response = client
        .get(&url)
        .send()
        .await
        .map_err(|_| anyhow::Error::new(Unavailable))?;
    if response.status().as_u16() == 404
        || response.status().as_u16() == 429
        || response.status().is_server_error()
    {
        return Err(Unavailable.into());
    }
    ensure!(
        response.status().is_success(),
        "Squad release service returned HTTP {}",
        response.status().as_u16()
    );
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| anyhow::Error::new(Unavailable))?
    {
        ensure!(
            bytes.len() + chunk.len() <= 128 * 1024,
            "Squad release metadata is too large"
        );
        bytes.extend_from_slice(&chunk);
    }
    Ok(DiscoveredRelease {
        release: parse_feed(&bytes, channel)?,
        source: "squad-api".into(),
        manifest_url: url,
    })
}

pub async fn discover_release(channel: &str) -> Result<DiscoveredRelease> {
    let policy = std::env::var("AUTOHAND_SQUAD_UPDATE_SOURCE").unwrap_or_else(|_| "auto".into());
    if policy == "github" && channel == "nightly" {
        return Err(DiscoveryError { source: "configuration".into(), manifest_url: String::new(), error: anyhow::anyhow!("Nightly updates require Squad's release API; GitHub's moving nightly tag does not supply a versioned installer manifest.") }.into());
    }
    if policy != "github" {
        match from_api(channel).await {
            Ok(release) => return Ok(release),
            Err(error)
                if policy == "auto"
                    && channel != "nightly"
                    && error.downcast_ref::<Unavailable>().is_some() => {}
            Err(error) => {
                return Err(DiscoveryError {
                    source: "squad-api".into(),
                    manifest_url: origin()
                        .map(|origin| format!("{origin}/v1/releases/{channel}/manifest"))
                        .unwrap_or_default(),
                    error,
                }
                .into())
            }
        }
    }
    // Transitional fallback for older/offline deployments. Invalid metadata,
    // redirects and permission failures never trigger a source change.
    let repository = install::update_repository();
    let manifest_url = format!("https://api.github.com/repos/{repository}/releases");
    let release = install::fetch_github_release(&repository, channel)
        .await
        .map_err(|error| DiscoveryError {
            source: format!("github:{repository}"),
            manifest_url: manifest_url.clone(),
            error,
        })?;
    Ok(DiscoveredRelease {
        release,
        source: format!("github:{repository}"),
        manifest_url,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn first_party_manifest_keeps_the_platform_checksum_and_official_artifact() {
        let mut manifest = serde_json::json!({"schemaVersion":1,"channel":"stable","version":"0.1.12","releaseUrl":"https://github.com/autohandai/squad/releases/tag/v0.1.12","releasedAt":"2026-10-27T00:00:00Z","notes":"Fixed installation","assets":[{"os":"macos","arch":"arm64","name":"autohand-squad-0.1.12-macos-arm64.dmg","url":"https://github.com/autohandai/squad/releases/download/v0.1.12/autohand-squad-0.1.12-macos-arm64.dmg","sha256":"a".repeat(64),"bytes":100}]});
        let parsed = parse_feed(&serde_json::to_vec(&manifest).unwrap(), "stable").unwrap();
        assert_eq!(parsed.manifest.artifacts[0].sha256, "a".repeat(64));
        assert_eq!(parsed.manifest.artifacts[0].arch, "aarch64");
        manifest["assets"][0]["url"] = serde_json::json!("https://attacker.example/installer.dmg");
        assert!(parse_feed(&serde_json::to_vec(&manifest).unwrap(), "stable").is_err());
    }
    #[test]
    fn first_party_feed_accepts_all_supported_desktop_installers() {
        let cases = [
            ("macos", "arm64", ".dmg", "dmg"),
            ("macos", "x64", ".dmg", "dmg"),
            ("windows", "x64", "-setup.exe", "installer"),
            ("windows", "x64", ".msi", "msi"),
            ("linux", "x64", ".deb", "deb"),
            ("linux", "x64", ".AppImage", "appimage"),
        ];
        for (os, arch, suffix, component) in cases {
            let name = format!("autohand-squad-0.1.12-{os}-{arch}{suffix}");
            let feed = serde_json::json!({"schemaVersion":1,"channel":"stable","version":"0.1.12","releaseUrl":"https://github.com/autohandai/squad/releases/tag/v0.1.12","releasedAt":"2026-10-27T00:00:00Z","notes":"Fixture","assets":[{"os":os,"arch":arch,"name":name,"url":format!("https://github.com/autohandai/squad/releases/download/v0.1.12/{name}"),"sha256":"b".repeat(64),"bytes":100}]});
            let parsed = parse_feed(&serde_json::to_vec(&feed).unwrap(), "stable").unwrap();
            assert_eq!(
                parsed.manifest.artifacts[0].component.as_deref(),
                Some(component)
            );
        }
    }
}
