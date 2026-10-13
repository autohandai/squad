use crate::{dispatch_menu_action, lock, Shell};
use std::sync::Arc;
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum InfoPage {
    About,
    Policies,
    Changelog,
    Licenses,
}

impl InfoPage {
    pub(crate) fn from_path(path: &str) -> Option<Self> {
        match path {
            "/app-info/about" => Some(Self::About),
            "/app-info/policies" => Some(Self::Policies),
            "/app-info/changelog" => Some(Self::Changelog),
            "/app-info/licenses" => Some(Self::Licenses),
            _ => None,
        }
    }

    fn slug(self) -> &'static str {
        match self {
            Self::About => "about",
            Self::Policies => "policies",
            Self::Changelog => "changelog",
            Self::Licenses => "licenses",
        }
    }

    fn title(self) -> &'static str {
        match self {
            Self::About => "About Autohand Squad",
            Self::Policies => "Policies",
            Self::Changelog => "Changelog",
            Self::Licenses => "Third-party licenses",
        }
    }
}

/// Only a known page on the bridge's own origin can request another window.
fn requested_info_page(url: &Url, bridge: Option<&str>) -> Option<InfoPage> {
    let base = Url::parse(bridge?).ok()?;
    if base.origin() != url.origin()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query() != Some("window=1")
        || url.fragment().is_some()
    {
        return None;
    }
    InfoPage::from_path(url.path())
}

fn requested_update_check(url: &Url, bridge: Option<&str>) -> bool {
    let Some(base) = bridge.and_then(|value| Url::parse(value).ok()) else {
        return false;
    };
    base.origin() == url.origin()
        && url.username().is_empty()
        && url.password().is_none()
        && url.path() == "/settings"
        && url.query() == Some("section=updates&check=1")
        && url.fragment().is_none()
}

fn external_link_allowed(url: &Url) -> bool {
    match url.scheme() {
        "http" | "https" => {
            url.host_str().is_some() && url.username().is_empty() && url.password().is_none()
        }
        "mailto" => !url.path().is_empty(),
        _ => false,
    }
}

fn bridge_origin_matches(url: &Url, bridge: Option<&str>) -> bool {
    bridge
        .and_then(|value| Url::parse(value).ok())
        .is_some_and(|base| base.origin() == url.origin())
}

pub(crate) fn info_navigation_handler(
    app: &AppHandle,
    shell: Arc<Shell>,
    from_info_window: bool,
) -> impl Fn(&Url) -> bool + Send + 'static {
    let app = app.clone();
    move |url| {
        if from_info_window && !bridge_origin_matches(url, lock(&shell.app_url).as_deref()) {
            if external_link_allowed(url) {
                // The installed documents contain ordinary external and
                // target=_blank links. Open those in the system browser or
                // mail app, retaining the information window and its state.
                if let Err(error) = tauri_plugin_opener::open_url(url.as_str(), None::<&str>) {
                    eprintln!("information link failed: {error}");
                }
            }
            return false;
        }
        if from_info_window && requested_update_check(url, lock(&shell.app_url).as_deref()) {
            let handle = app.clone();
            if let Err(error) = app.run_on_main_thread(move || {
                dispatch_menu_action(&handle, "check-upgrades");
            }) {
                eprintln!("update menu scheduling failed: {error}");
            }
            return false;
        }
        let page = requested_info_page(url, lock(&shell.app_url).as_deref());
        let Some(page) = page else { return true };
        // Creating a webview directly inside another webview's navigation
        // callback can deadlock on Windows. Queue it on the native main loop.
        let handle = app.clone();
        let shell = shell.clone();
        if let Err(error) = app.run_on_main_thread(move || {
            if let Err(error) = open_info_window(&handle, &shell, page) {
                eprintln!("information window failed: {error}");
            }
        }) {
            eprintln!("information window scheduling failed: {error}");
        }
        false
    }
}

pub(crate) fn open_info_window(
    app: &AppHandle,
    shell: &Arc<Shell>,
    page: InfoPage,
) -> Result<(), String> {
    let label = format!("info-{}", page.slug());
    if let Some(window) = app.get_webview_window(&label) {
        window.show().map_err(|error| error.to_string())?;
        window.unminimize().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }
    let bridge = lock(&shell.app_url)
        .clone()
        .ok_or_else(|| "The local Squad service is still starting.".to_string())?;
    let mut target = Url::parse(&bridge).map_err(|error| error.to_string())?;
    target.set_path(&format!("/app-info/{}", page.slug()));
    target.set_query(None);
    target.set_fragment(None);
    let user_agent = format!(
        "AutohandSquadDesktop/{} ({}; {})",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
        std::env::consts::ARCH
    );
    let about = page == InfoPage::About;
    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(target))
        .title(page.title())
        .inner_size(
            if about { 520.0 } else { 720.0 },
            if about { 600.0 } else { 720.0 },
        )
        .min_inner_size(if about { 480.0 } else { 540.0 }, 480.0)
        .resizable(!about)
        .user_agent(&user_agent)
        .on_navigation(info_navigation_handler(app, shell.clone(), true))
        .on_new_window({
            let navigation = info_navigation_handler(app, shell.clone(), true);
            move |url, _features| {
                navigation(&url);
                NewWindowResponse::Deny
            }
        })
        .center()
        .build()
        .map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn information_links_open_only_web_or_email_protocols_without_credentials() {
        for value in [
            "https://autohand.ai/policies",
            "https://github.com/autohandai/squad/blob/main/LICENSE",
            "http://example.com/license",
            "mailto:security@autohand.ai",
        ] {
            assert!(
                external_link_allowed(&Url::parse(value).unwrap()),
                "{value}"
            );
        }
        for value in [
            "javascript:alert(1)",
            "file:///tmp/arbitrary-command",
            "data:text/html,unsafe",
            "shell:run",
            "mailto:",
            "https://user:secret@example.com/license",
        ] {
            assert!(
                !external_link_allowed(&Url::parse(value).unwrap()),
                "{value}"
            );
        }
        assert!(bridge_origin_matches(
            &Url::parse("http://127.0.0.1:19821/app-info/policies").unwrap(),
            Some("http://127.0.0.1:19821/work")
        ));
        assert!(!bridge_origin_matches(
            &Url::parse("https://autohand.ai/policies").unwrap(),
            Some("http://127.0.0.1:19821/work")
        ));
    }

    #[test]
    fn native_info_requests_are_exact_known_pages_on_the_bridge() {
        let bridge = Some("http://127.0.0.1:19821/work");
        for (slug, page) in [
            ("about", InfoPage::About),
            ("policies", InfoPage::Policies),
            ("changelog", InfoPage::Changelog),
            ("licenses", InfoPage::Licenses),
        ] {
            let url =
                Url::parse(&format!("http://127.0.0.1:19821/app-info/{slug}?window=1")).unwrap();
            assert_eq!(requested_info_page(&url, bridge), Some(page));
        }
    }

    #[test]
    fn rejects_external_origins_unknown_pages_and_extra_instructions() {
        for value in [
            "https://example.com/app-info/about?window=1",
            "http://127.0.0.1:19822/app-info/about?window=1",
            "http://user:secret@127.0.0.1:19821/app-info/about?window=1",
            "http://127.0.0.1:19821/app-info/arbitrary?window=1",
            "http://127.0.0.1:19821/app-info/about",
            "http://127.0.0.1:19821/app-info/about?window=1&command=open",
            "http://127.0.0.1:19821/app-info/about?window=1#other",
        ] {
            assert_eq!(
                requested_info_page(&Url::parse(value).unwrap(), Some("http://127.0.0.1:19821")),
                None,
                "{value}"
            );
        }
        assert_eq!(
            requested_info_page(
                &Url::parse("http://127.0.0.1:19821/app-info/about?window=1").unwrap(),
                None
            ),
            None
        );
    }

    #[test]
    fn update_check_from_info_window_has_a_fixed_origin_and_action() {
        let bridge = Some("http://127.0.0.1:19821/work");
        assert!(requested_update_check(
            &Url::parse("http://127.0.0.1:19821/settings?section=updates&check=1").unwrap(),
            bridge
        ));
        for value in [
            "http://127.0.0.1:19821/settings?section=updates",
            "http://127.0.0.1:19821/settings?section=updates&check=1&command=run",
            "https://example.com/settings?section=updates&check=1",
            "http://127.0.0.1:19822/settings?section=updates&check=1",
        ] {
            assert!(!requested_update_check(&Url::parse(value).unwrap(), bridge));
        }
    }
}
