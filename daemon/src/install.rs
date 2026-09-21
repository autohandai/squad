use crate::state::{now_string, write_install_record, InstallRecord, StatePaths};
use crate::telemetry::{append_telemetry_event, launcher_event};
use anyhow::{anyhow, bail, Context, Result};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseManifest {
    pub latest_allowed_version: String,
    pub channel: String,
    pub artifacts: Vec<ReleaseArtifact>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseArtifact {
    pub os: String,
    pub arch: String,
    pub url: String,
    pub sha256: String,
    pub component: Option<String>,
    pub binary_name: Option<String>,
    pub signature: Option<String>,
    pub public_key: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedArtifact {
    pub version: String,
    pub channel: String,
    pub artifact: ReleaseArtifact,
    pub bytes: Vec<u8>,
}

pub fn target_os() -> &'static str {
    std::env::consts::OS
}

pub fn target_arch() -> &'static str {
    std::env::consts::ARCH
}

pub fn select_artifacts(manifest: &ReleaseManifest) -> Vec<ReleaseArtifact> {
    manifest
        .artifacts
        .iter()
        .filter(|artifact| artifact.os == target_os() && artifact.arch == target_arch())
        .cloned()
        .collect()
}

pub fn validate_release_manifest(manifest: &ReleaseManifest) -> Result<()> {
    if manifest.latest_allowed_version.trim().is_empty() {
        bail!("release manifest latestAllowedVersion is required");
    }
    if manifest.channel.trim().is_empty() {
        bail!("release manifest channel is required");
    }

    let selected = select_artifacts(manifest);
    let mut components = selected
        .iter()
        .filter_map(|artifact| {
            artifact
                .component
                .as_deref()
                .or_else(|| artifact.binary_name.as_deref())
        })
        .collect::<Vec<_>>();
    components.sort_unstable();
    for required in ["cli", "daemon", "analytics", "tray", "ui"] {
        if !components
            .iter()
            .any(|component| component.contains(required))
        {
            bail!("release manifest missing {required} artifact for this platform");
        }
    }
    Ok(())
}

pub async fn fetch_release_manifest(api_base_url: &str, channel: &str) -> Result<ReleaseManifest> {
    let base = api_base_url.trim_end_matches('/');
    let url = format!("{base}/v1/squad/releases/{channel}/manifest");
    let bytes = curl_get(&url).with_context(|| format!("fetch {url}"))?;
    let manifest = serde_json::from_slice(&bytes).context("parse release manifest")?;
    validate_release_manifest(&manifest)?;
    Ok(manifest)
}

pub async fn download_and_verify_artifact(
    manifest: &ReleaseManifest,
    artifact: ReleaseArtifact,
) -> Result<VerifiedArtifact> {
    let bytes = curl_get(&artifact.url).with_context(|| format!("download {}", artifact.url))?;
    verify_artifact_bytes(&artifact, &bytes)?;
    Ok(VerifiedArtifact {
        version: manifest.latest_allowed_version.clone(),
        channel: manifest.channel.clone(),
        artifact,
        bytes,
    })
}

fn curl_get(url: &str) -> Result<Vec<u8>> {
    let output = Command::new("curl")
        .args([
            "--fail",
            "--silent",
            "--show-error",
            "--location",
            "--max-time",
            "10",
            url,
        ])
        .output()
        .context("run curl")?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!("curl failed: {}", stderr.trim());
    }
    Ok(output.stdout)
}

pub fn verify_artifact_bytes(artifact: &ReleaseArtifact, bytes: &[u8]) -> Result<()> {
    let actual = hex_sha256(bytes);
    if !actual.eq_ignore_ascii_case(&artifact.sha256) {
        bail!(
            "checksum mismatch for {}: expected {}, got {}",
            artifact.url,
            artifact.sha256,
            actual
        );
    }

    if let Some(signature) = &artifact.signature {
        let public_key = artifact.public_key.as_deref().ok_or_else(|| {
            anyhow!("artifact signature is present but no publicKey was provided")
        })?;
        verify_signature(public_key, signature, artifact.sha256.as_bytes())?;
    }

    Ok(())
}

pub fn install_verified_artifact(
    paths: &StatePaths,
    verified: VerifiedArtifact,
) -> Result<PathBuf> {
    paths.ensure()?;
    let binary_name = verified
        .artifact
        .binary_name
        .clone()
        .unwrap_or_else(|| "autohand-squad-daemon".to_string());
    let target = paths.bin_dir.join(binary_name);
    fs::write(&target, &verified.bytes).with_context(|| format!("write {}", target.display()))?;
    make_executable(&target)?;

    write_install_record(
        paths,
        &InstallRecord {
            version: verified.version.clone(),
            channel: verified.channel.clone(),
            installed_at: now_string(),
            artifact_url: verified.artifact.url.clone(),
            sha256: verified.artifact.sha256.clone(),
        },
    )?;
    let _ = append_telemetry_event(
        paths,
        launcher_event(
            "install.completed",
            Some(serde_json::json!({
                "version": verified.version,
                "channel": verified.channel,
                "artifactUrl": verified.artifact.url,
                "component": verified.artifact.component,
                "binaryName": target.file_name().and_then(|name| name.to_str())
            })),
        ),
    );

    Ok(target)
}

fn verify_signature(public_key: &str, signature: &str, message: &[u8]) -> Result<()> {
    BASE64.decode(public_key).context("decode public key")?;
    BASE64.decode(signature).context("decode signature")?;
    if message.is_empty() {
        return Err(anyhow!("signature message cannot be empty"));
    }
    Ok(())
}

fn hex_sha256(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(unix)]
fn make_executable(path: &PathBuf) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let mut permissions = fs::metadata(path)?.permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(path, permissions)?;
    Ok(())
}

#[cfg(not(unix))]
fn make_executable(_path: &PathBuf) -> Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_state_paths() -> StatePaths {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        StatePaths::from_root(std::env::temp_dir().join(format!(
            "autohand-squad-test-{}-{nonce}",
            std::process::id()
        )))
    }

    #[test]
    fn verifies_checksum_before_install() {
        let artifact = ReleaseArtifact {
            os: target_os().to_string(),
            arch: target_arch().to_string(),
            url: "https://example.test/squad".to_string(),
            sha256: hex_sha256(b"runtime"),
            component: Some("cli".to_string()),
            binary_name: Some("squad".to_string()),
            signature: None,
            public_key: None,
        };

        verify_artifact_bytes(&artifact, b"runtime").unwrap();
        assert!(verify_artifact_bytes(&artifact, b"tampered").is_err());
    }

    #[test]
    fn installs_verified_artifact_under_shared_bin_dir() {
        let paths = temp_state_paths();
        let artifact = ReleaseArtifact {
            os: target_os().to_string(),
            arch: target_arch().to_string(),
            url: "https://example.test/squad".to_string(),
            sha256: hex_sha256(b"runtime"),
            component: Some("cli".to_string()),
            binary_name: Some("squad".to_string()),
            signature: None,
            public_key: None,
        };
        let target = install_verified_artifact(
            &paths,
            VerifiedArtifact {
                version: "1.2.3".to_string(),
                channel: "stable".to_string(),
                artifact,
                bytes: b"runtime".to_vec(),
            },
        )
        .unwrap();

        assert_eq!(target, paths.bin_dir.join("squad"));
        assert_eq!(fs::read(target).unwrap(), b"runtime");
        assert_eq!(
            crate::state::read_install_record(&paths)
                .unwrap()
                .unwrap()
                .version,
            "1.2.3"
        );
        let telemetry = fs::read_to_string(paths.telemetry_log.clone()).unwrap();
        assert!(telemetry.contains("\"event\":\"install.completed\""));
        assert!(telemetry.contains("\"clientType\":\"cli\""));
        let _ = fs::remove_dir_all(paths.root);
    }

    #[test]
    fn release_manifest_requires_cli_daemon_analytics_tray_and_ui_artifacts() {
        let sha = hex_sha256(b"runtime");
        let artifact = |component: &str, binary_name: &str| ReleaseArtifact {
            os: target_os().to_string(),
            arch: target_arch().to_string(),
            url: format!("https://example.test/{binary_name}"),
            sha256: sha.clone(),
            component: Some(component.to_string()),
            binary_name: Some(binary_name.to_string()),
            signature: None,
            public_key: None,
        };
        let manifest = ReleaseManifest {
            latest_allowed_version: "1.2.3".to_string(),
            channel: "stable".to_string(),
            artifacts: vec![
                artifact("cli", "squad"),
                artifact("daemon", "autohand-squad-daemon"),
                artifact("analytics", "autohand-squad-analytics"),
                artifact("tray", "autohand-squad-tray"),
                artifact("ui", "autohand-squad-ui"),
            ],
        };

        validate_release_manifest(&manifest).unwrap();

        let missing_ui = ReleaseManifest {
            latest_allowed_version: "1.2.3".to_string(),
            channel: "stable".to_string(),
            artifacts: vec![
                artifact("cli", "squad"),
                artifact("daemon", "autohand-squad-daemon"),
                artifact("analytics", "autohand-squad-analytics"),
                artifact("tray", "autohand-squad-tray"),
            ],
        };
        assert!(validate_release_manifest(&missing_ui).is_err());
    }
}

// ---------------------------------------------------------------------------
// GitHub Releases as the update source. The app's releases live at
// github.com/<repo>/releases; each release carries the installers and a
// checksums.txt. Channels map to release kinds: stable = latest non-prerelease,
// beta = latest prerelease tagged beta/rc, canary = latest prerelease.
// ---------------------------------------------------------------------------

pub const DEFAULT_UPDATE_REPOSITORY: &str = "autohandai/squad";

pub fn update_repository() -> String {
    std::env::var("AUTOHAND_SQUAD_UPDATE_REPO")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_UPDATE_REPOSITORY.to_string())
}

#[derive(Debug, Clone, Deserialize)]
struct GithubRelease {
    tag_name: String,
    html_url: String,
    draft: bool,
    prerelease: bool,
    published_at: Option<String>,
    body: Option<String>,
    assets: Vec<GithubAsset>,
}

#[derive(Debug, Clone, Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
    size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GithubReleaseSummary {
    pub version: String,
    pub tag: String,
    pub release_url: String,
    pub published_at: String,
    pub notes: String,
    pub manifest: ReleaseManifest,
}

/// Version string without a leading `v`.
pub fn version_from_tag(tag: &str) -> String {
    tag.trim().trim_start_matches('v').to_string()
}

/// Semver-aware comparison (numeric core, prerelease sorts below release).
pub fn compare_versions(left: &str, right: &str) -> std::cmp::Ordering {
    fn split(version: &str) -> (Vec<u64>, String) {
        let version = version.trim().trim_start_matches('v');
        let (core, pre) = match version.split_once('-') {
            Some((core, pre)) => (core, pre.to_string()),
            None => (version, String::new()),
        };
        let numbers = core
            .split('.')
            .map(|part| {
                part.chars()
                    .take_while(|c| c.is_ascii_digit())
                    .collect::<String>()
                    .parse::<u64>()
                    .unwrap_or(0)
            })
            .collect::<Vec<_>>();
        (numbers, pre)
    }
    let (left_core, left_pre) = split(left);
    let (right_core, right_pre) = split(right);
    for index in 0..left_core.len().max(right_core.len()) {
        let l = left_core.get(index).copied().unwrap_or(0);
        let r = right_core.get(index).copied().unwrap_or(0);
        if l != r {
            return l.cmp(&r);
        }
    }
    match (left_pre.is_empty(), right_pre.is_empty()) {
        (true, true) => std::cmp::Ordering::Equal,
        (true, false) => std::cmp::Ordering::Greater,
        (false, true) => std::cmp::Ordering::Less,
        (false, false) => left_pre.cmp(&right_pre),
    }
}

fn release_matches_channel(release: &GithubRelease, channel: &str) -> bool {
    if release.draft {
        return false;
    }
    let tag = release.tag_name.to_ascii_lowercase();
    match channel {
        "canary" => release.prerelease,
        "beta" => release.prerelease && !tag.contains("canary"),
        _ => !release.prerelease,
    }
}

/// Map a release asset name to (os, arch, component) for this daemon's targets.
fn classify_asset(name: &str) -> Option<(&'static str, &'static str, &'static str)> {
    let lower = name.to_ascii_lowercase();
    let os = if lower.contains("macos") || lower.ends_with(".dmg") || lower.contains("darwin") {
        "macos"
    } else if lower.contains("windows") || lower.ends_with(".exe") || lower.ends_with(".msi") {
        "windows"
    } else if lower.contains("linux") || lower.ends_with(".deb") || lower.ends_with(".appimage") {
        "linux"
    } else {
        return None;
    };
    let arch = if lower.contains("arm64") || lower.contains("aarch64") {
        "aarch64"
    } else if lower.contains("x64") || lower.contains("x86_64") || lower.contains("amd64") {
        "x86_64"
    } else {
        return None;
    };
    let component = if lower.ends_with(".dmg") {
        "dmg"
    } else if lower.ends_with(".exe") {
        "installer"
    } else if lower.ends_with(".deb") {
        "deb"
    } else if lower.ends_with(".appimage") {
        "appimage"
    } else if lower.ends_with(".tar.gz") || lower.ends_with(".zip") {
        "portable"
    } else {
        return None;
    };
    Some((os, arch, component))
}

fn parse_checksums(text: &str) -> std::collections::HashMap<String, String> {
    text.lines()
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let digest = parts.next()?;
            let name = parts.next()?.trim_start_matches('*');
            (digest.len() == 64).then(|| (name.to_string(), digest.to_ascii_lowercase()))
        })
        .collect()
}

/// Fetch the latest release for a channel from GitHub and express it as the
/// same manifest the installer already understands.
pub async fn fetch_github_release(repository: &str, channel: &str) -> Result<GithubReleaseSummary> {
    let client = reqwest::Client::builder()
        .user_agent(format!("autohand-squad/{}", crate::VERSION))
        .build()?;
    let url = format!("https://api.github.com/repos/{repository}/releases?per_page=30");
    let response = client
        .get(&url)
        .send()
        .await
        .with_context(|| format!("fetch {url}"))?;
    if !response.status().is_success() {
        bail!(
            "GitHub releases returned HTTP {} for {repository}",
            response.status().as_u16()
        );
    }
    let releases: Vec<GithubRelease> = response.json().await.context("parse GitHub releases")?;
    let release = releases
        .into_iter()
        .find(|release| release_matches_channel(release, channel))
        .ok_or_else(|| anyhow!("no {channel} release published for {repository}"))?;

    let checksums = match release
        .assets
        .iter()
        .find(|asset| asset.name.eq_ignore_ascii_case("checksums.txt"))
    {
        Some(asset) => client
            .get(&asset.browser_download_url)
            .send()
            .await
            .ok()
            .and_then(|response| response.error_for_status().ok())
            .map(|response| async move { response.text().await.unwrap_or_default() }),
        None => None,
    };
    let checksums = match checksums {
        Some(future) => parse_checksums(&future.await),
        None => std::collections::HashMap::new(),
    };

    let artifacts = release
        .assets
        .iter()
        .filter(|asset| asset.size > 0)
        .filter_map(|asset| {
            let (os, arch, component) = classify_asset(&asset.name)?;
            Some(ReleaseArtifact {
                os: os.to_string(),
                arch: arch.to_string(),
                url: asset.browser_download_url.clone(),
                sha256: checksums.get(&asset.name).cloned().unwrap_or_default(),
                component: Some(component.to_string()),
                binary_name: Some(asset.name.clone()),
                signature: None,
                public_key: None,
            })
        })
        .collect::<Vec<_>>();

    Ok(GithubReleaseSummary {
        version: version_from_tag(&release.tag_name),
        tag: release.tag_name.clone(),
        release_url: release.html_url.clone(),
        published_at: release.published_at.clone().unwrap_or_default(),
        notes: release
            .body
            .clone()
            .unwrap_or_default()
            .chars()
            .take(4000)
            .collect(),
        manifest: ReleaseManifest {
            latest_allowed_version: version_from_tag(&release.tag_name),
            channel: channel.to_string(),
            artifacts,
        },
    })
}

#[cfg(test)]
mod github_tests {
    use super::*;

    #[test]
    fn versions_compare_semver_aware() {
        use std::cmp::Ordering::*;
        assert_eq!(compare_versions("0.1.4", "0.1.10"), Less);
        assert_eq!(compare_versions("v1.0.0", "1.0.0"), Equal);
        assert_eq!(compare_versions("1.0.0-beta.1", "1.0.0"), Less);
        assert_eq!(compare_versions("1.2.0", "1.1.9"), Greater);
    }

    #[test]
    fn assets_classify_by_platform_and_kind() {
        assert_eq!(
            classify_asset("autohand-squad-0.1.4-macos-arm64.dmg"),
            Some(("macos", "aarch64", "dmg"))
        );
        assert_eq!(
            classify_asset("Autohand Squad_0.1.0_x64-setup.exe"),
            Some(("windows", "x86_64", "installer"))
        );
        assert_eq!(
            classify_asset("autohand-squad-0.1.4-linux-x64.AppImage"),
            Some(("linux", "x86_64", "appimage"))
        );
        assert_eq!(classify_asset("checksums.txt"), None);
    }

    #[test]
    fn checksums_parse_sha256_lines() {
        let parsed = parse_checksums("abc  file.dmg
0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  autohand-squad-0.1.4-macos-arm64.dmg
");
        assert_eq!(parsed.len(), 1);
        assert!(parsed.contains_key("autohand-squad-0.1.4-macos-arm64.dmg"));
    }
}
