use crate::{lock, Shell, MAIN_WINDOW};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, WebviewWindow};

pub(crate) fn blocks_navigation(url: &reqwest::Url) -> bool {
    // Previews use srcdoc/blob subframes. Never inject main-frame native IPC
    // into a saved artifact by navigating a native window to its HTTP body.
    url.path().starts_with("/api/artifacts/") && !url.path().ends_with("/download")
}

pub(crate) fn open_external_window(app: &AppHandle, url: &reqwest::Url) {
    if crate::system_reset::blocked(app) || blocks_navigation(url) {
        return;
    }
    if matches!(url.scheme(), "http" | "https" | "mailto")
        && url.username().is_empty()
        && url.password().is_none()
    {
        if let Err(error) = tauri_plugin_opener::open_url(url.as_str(), None::<&str>) {
            eprintln!("external link failed: {error}");
        }
    }
}

fn valid_artifact_id(id: &str) -> bool {
    id.strip_prefix("artifact_").is_some_and(|suffix| {
        suffix.len() == 36 && suffix.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
    })
}

#[tauri::command]
pub async fn squad_open_artifact_in_browser(
    app: AppHandle,
    window: WebviewWindow,
    shell: tauri::State<'_, Arc<Shell>>,
    artifact_id: String,
    context_generation: String,
) -> Result<(), String> {
    let context = autohand_squad_runtime::ownership::read_active_context(&crate::default_paths())
        .map_err(|error| error.to_string())?
        .ok_or("Select a verified Squad first.")?;
    if context.generation != context_generation {
        return Err("The selected Squad changed. Reopen the artifact.".into());
    }
    if crate::system_reset::blocked(&app) {
        return Err("Finish the reset first.".into());
    }
    if !valid_artifact_id(&artifact_id) {
        return Err("Choose a saved artifact.".into());
    }
    let base = lock(&shell.app_url)
        .clone()
        .ok_or("Squad is still starting.")?;
    let base = reqwest::Url::parse(&base).map_err(|e| e.to_string())?;
    if window.label() != MAIN_WINDOW
        || window.url().map_err(|e| e.to_string())?.origin() != base.origin()
    {
        return Err("Open artifacts from Squad's main window.".into());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;
    let metadata = base
        .join(&format!("/api/artifacts/{artifact_id}"))
        .map_err(|e| e.to_string())?;
    let metadata: serde_json::Value = client
        .get(metadata)
        .header("x-squad-context", &context.generation)
        .send()
        .await
        .map_err(|_| "The saved artifact is unavailable.")?
        .error_for_status()
        .map_err(|_| "The saved artifact is unavailable.")?
        .json()
        .await
        .map_err(|_| "The saved artifact is unavailable.")?;
    if metadata["success"] != true || metadata["data"]["id"] != artifact_id {
        return Err("The saved artifact is unavailable.".into());
    }
    let mut url = base
        .join(&format!("/api/artifacts/{artifact_id}/content"))
        .map_err(|e| e.to_string())?;
    if !crate::native_scope_current(Some(&context)) {
        return Err("The selected Squad changed. Reopen the artifact.".into());
    }
    url.query_pairs_mut()
        .append_pair("context", &context.generation);
    tauri_plugin_opener::open_url(url.as_str(), None::<&str>)
        .map_err(|_| "The browser could not be opened.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn untrusted_artifact_documents_cannot_be_native_pages() {
        assert!(!blocks_navigation(
            &"http://127.0.0.1:3000/api/artifacts/artifact_123/download"
                .parse()
                .unwrap()
        ));
        assert!(blocks_navigation(
            &"http://127.0.0.1:3000/api/artifacts/artifact_123/content"
                .parse()
                .unwrap()
        ));
        assert!(!blocks_navigation(&"about:srcdoc".parse().unwrap()));
        assert!(!blocks_navigation(
            &"http://127.0.0.1:3000/squad-members/noah/library"
                .parse()
                .unwrap()
        ));
        assert!(!valid_artifact_id("../../api/system/reset"));
        assert!(valid_artifact_id(
            "artifact_12345678-1234-1234-1234-123456789abc"
        ));
    }
}
