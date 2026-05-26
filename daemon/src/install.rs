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
