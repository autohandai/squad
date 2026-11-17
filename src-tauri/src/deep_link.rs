// `squad://` links (ADR-0246).
//
// The only link Squad answers is
//   squad://app/v1/agent-template?id=<12 a-z0-9>[&version=<n>][&sha256=<64 hex>]
// and it becomes the app route `/marketplace/agents/<id>[?version=…][&sha256=…]`,
// which opens the Marketplace dialog on that agent. Nothing is added by the
// link itself. Parsing is exact and std-only so it can be checked with
// `rustc --test src-tauri/src/deep_link.rs`; the web app parses the route
// again with the same rules (src/lib/marketplace.js).

const PREFIX: &str = "squad://app/v1/agent-template?";
const MAX_LINK: usize = 512;

fn is_id(value: &str) -> bool {
    value.len() == 12 && value.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn is_version(value: &str) -> bool {
    !value.is_empty() && value.len() <= 7 && value.bytes().all(|byte| byte.is_ascii_digit()) && value.trim_start_matches('0') != ""
}

/// The app route for a marketplace link, or `None` for anything else.
pub fn route_for_link(link: &str) -> Option<String> {
    let link = link.trim();
    if link.len() > MAX_LINK || link.contains('#') {
        return None;
    }
    let query = link.strip_prefix(PREFIX)?;
    let (mut id, mut version, mut sha256) = (None, None, None);
    for pair in query.split('&') {
        let (key, value) = pair.split_once('=')?;
        let slot = match key {
            "id" if is_id(value) => &mut id,
            "version" if is_version(value) => &mut version,
            "sha256" if is_sha256(value) => &mut sha256,
            _ => return None,
        };
        if slot.replace(value).is_some() {
            return None;
        }
    }
    let mut route = format!("/marketplace/agents/{}", id?);
    let mut separator = '?';
    if let Some(version) = version {
        route.push(separator);
        route.push_str("version=");
        route.push_str(version.trim_start_matches('0'));
        separator = '&';
    }
    if let Some(sha256) = sha256 {
        route.push(separator);
        route.push_str("sha256=");
        route.push_str(sha256);
    }
    Some(route)
}

/// The first marketplace route among launch arguments (Windows and Linux
/// pass the link as an argument; macOS delivers it as an open-URL event).
pub fn route_from_args<I, S>(args: I) -> Option<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    args.into_iter().find_map(|arg| route_for_link(arg.as_ref()))
}

/// The first page to load when Squad was opened by a link: the bridge origin
/// with the route appended. `None` when the bridge URL already carries a path
/// or query, which a route must not overwrite.
pub fn cold_start_url(bridge: &str, route: &str) -> Option<String> {
    if bridge.contains('?') || bridge.contains('#') || !route.starts_with("/marketplace/agents/") {
        return None;
    }
    let (scheme, rest) = bridge.split_once("://")?;
    let (authority, path) = rest.split_once('/').map_or((rest, ""), |(authority, path)| (authority, path));
    if authority.is_empty() || !path.is_empty() || !matches!(scheme, "http" | "https") {
        return None;
    }
    Some(format!("{scheme}://{authority}{route}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_the_marketplace_link() {
        assert_eq!(route_for_link("squad://app/v1/agent-template?id=abcdefgh1234").as_deref(), Some("/marketplace/agents/abcdefgh1234"));
        let hash = "a".repeat(64);
        assert_eq!(
            route_for_link(&format!("squad://app/v1/agent-template?id=abcdefgh1234&version=3&sha256={hash}")).as_deref(),
            Some(format!("/marketplace/agents/abcdefgh1234?version=3&sha256={hash}").as_str())
        );
        assert_eq!(
            route_for_link(&format!("squad://app/v1/agent-template?sha256={hash}&id=abcdefgh1234")).as_deref(),
            Some(format!("/marketplace/agents/abcdefgh1234?sha256={hash}").as_str())
        );
    }

    #[test]
    fn refuses_everything_else() {
        let long = format!("squad://app/v1/agent-template?id=abcdefgh1234&pad={}", "x".repeat(600));
        for link in [
            "",
            "squad://app/v1/agent-template?id=ABCDEFGH1234",
            "squad://app/v1/agent-template?id=abc",
            "squad://evil/v1/agent-template?id=abcdefgh1234",
            "squad://app/v2/agent-template?id=abcdefgh1234",
            "squad://app/v1/agent-template/?id=abcdefgh1234",
            "https://app/v1/agent-template?id=abcdefgh1234",
            "grokbot://app/v1/bot-template?id=abcdefgh1234",
            "squad://app/v1/agent-template?id=abcdefgh1234&url=https://evil.example",
            "squad://app/v1/agent-template?id=abcdefgh1234&id=zzzzzzzzzzzz",
            "squad://app/v1/agent-template?id=abcdefgh1234&version=0",
            "squad://app/v1/agent-template?id=abcdefgh1234&version=12345678",
            "squad://app/v1/agent-template?id=abcdefgh1234&sha256=xyz",
            "squad://app/v1/agent-template?id=abcdefgh1234#fragment",
            "squad://app/v1/agent-template?id=abcdefgh1234&",
            "squad://app/v1/agent-template?version=2",
            "squad://user:pw@app/v1/agent-template?id=abcdefgh1234",
            &long,
        ] {
            assert_eq!(route_for_link(link), None, "{link}");
        }
    }

    #[test]
    fn cold_start_appends_the_route_to_a_bare_origin_only() {
        let route = "/marketplace/agents/abcdefgh1234";
        assert_eq!(cold_start_url("http://127.0.0.1:19821", route).as_deref(), Some("http://127.0.0.1:19821/marketplace/agents/abcdefgh1234"));
        assert_eq!(cold_start_url("http://127.0.0.1:19821/", route).as_deref(), Some("http://127.0.0.1:19821/marketplace/agents/abcdefgh1234"));
        assert_eq!(cold_start_url("http://127.0.0.1:19821/squad", route), None);
        assert_eq!(cold_start_url("http://127.0.0.1:19821/?token=x", route), None);
        assert_eq!(cold_start_url("http://127.0.0.1:19821", "/settings"), None);
        assert_eq!(cold_start_url("file:///index.html", route), None);
    }

    #[test]
    fn finds_the_link_among_launch_arguments() {
        assert_eq!(route_from_args(["/Applications/Autohand Squad.app", "--flag", "squad://app/v1/agent-template?id=abcdefgh1234"]).as_deref(), Some("/marketplace/agents/abcdefgh1234"));
        assert_eq!(route_from_args(["squad", "--other"]), None);
    }
}
