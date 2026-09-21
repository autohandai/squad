//! Account plan and usage windows from the Autohand console API
//! (`GET /v1/console/summary`, `quota` block), plus the plain-text formatting
//! the tray uses to show them. Network access is one blocking call; the
//! formatting is pure and unit-tested.

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    #[serde(default)]
    pub used: u64,
    #[serde(default)]
    pub remaining: Option<u64>,
    #[serde(default)]
    pub limit: Option<u64>,
    #[serde(default)]
    pub reset_at: Option<String>,
}

impl UsageWindow {
    /// Percentage of the window consumed, when the window has a ceiling.
    pub fn percent_used(&self) -> Option<u8> {
        let limit = self.limit.filter(|limit| *limit > 0)?;
        Some(((self.used.saturating_mul(100)) / limit).min(100) as u8)
    }

    pub fn is_metered(&self) -> bool {
        self.limit.is_some_and(|limit| limit > 0)
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountUsage {
    pub tier: String,
    pub display_name: String,
    #[serde(default)]
    pub access_state: String,
    #[serde(default)]
    pub window5h: UsageWindow,
    #[serde(default)]
    pub window24h: UsageWindow,
    #[serde(default)]
    pub week: UsageWindow,
    #[serde(default)]
    pub month: UsageWindow,
    /// Unix seconds when this snapshot was fetched.
    #[serde(default)]
    pub fetched_at: u64,
}

#[derive(Debug, Deserialize)]
struct SummaryEnvelope {
    success: Option<bool>,
    summary: Option<Summary>,
    error: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct Summary {
    quota: Option<QuotaBlock>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QuotaBlock {
    tier: Option<String>,
    display_name: Option<String>,
    access_state: Option<String>,
    window5h: Option<UsageWindow>,
    window24h: Option<UsageWindow>,
    week: Option<UsageWindow>,
    month: Option<UsageWindow>,
}

impl AccountUsage {
    fn from_quota(quota: QuotaBlock, fetched_at: u64) -> Self {
        let tier = quota.tier.unwrap_or_default();
        Self {
            display_name: quota
                .display_name
                .filter(|name| !name.trim().is_empty())
                .unwrap_or_else(|| plan_display_name(&tier)),
            tier,
            access_state: quota.access_state.unwrap_or_default(),
            window5h: quota.window5h.unwrap_or_default(),
            window24h: quota.window24h.unwrap_or_default(),
            week: quota.week.unwrap_or_default(),
            month: quota.month.unwrap_or_default(),
            fetched_at,
        }
    }

    /// The windows worth showing, labelled, in the order the tray lists them.
    pub fn windows(&self) -> Vec<(&'static str, &UsageWindow)> {
        [
            ("5 h", &self.window5h),
            ("24 h", &self.window24h),
            ("Week", &self.week),
            ("Month", &self.month),
        ]
        .into_iter()
        .filter(|(_, window)| window.is_metered())
        .collect()
    }
}

pub fn plan_display_name(tier: &str) -> String {
    match tier.trim().to_ascii_lowercase().as_str() {
        "" => "Autohand Code".to_string(),
        "free" => "Autohand Code Free".to_string(),
        "pro" => "Autohand Code Pro".to_string(),
        "max" => "Autohand Code Max".to_string(),
        "team" => "Autohand Code Team".to_string(),
        "enterprise" => "Autohand Code Enterprise".to_string(),
        other => {
            let mut chars = other.chars();
            let first = chars
                .next()
                .map(|c| c.to_ascii_uppercase())
                .unwrap_or_default();
            format!("Autohand Code {first}{}", chars.as_str())
        }
    }
}

pub fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0)
}

/// Fetch the account's plan and usage windows with the account session token.
pub fn fetch_account_usage_blocking(api_base_url: &str, token: &str) -> Result<AccountUsage> {
    let url = format!("{}/v1/console/summary", api_base_url.trim_end_matches('/'));
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .context("build account usage client")?;
    let response = client
        .get(&url)
        .bearer_auth(token.trim())
        .send()
        .with_context(|| format!("fetch {url}"))?;
    let status = response.status();
    if status.as_u16() == 401 || status.as_u16() == 403 {
        bail!(
            "the account session was rejected (HTTP {}); sign in again",
            status.as_u16()
        );
    }
    let body: SummaryEnvelope = response
        .json()
        .with_context(|| format!("parse account usage from {url}"))?;
    if !status.is_success() || body.success == Some(false) {
        let detail = body
            .error
            .map(|error| match error {
                serde_json::Value::String(text) => text,
                other => other.to_string(),
            })
            .unwrap_or_default();
        bail!(
            "account usage request failed with HTTP {}{}",
            status.as_u16(),
            if detail.is_empty() {
                String::new()
            } else {
                format!(": {detail}")
            }
        );
    }
    let quota = body
        .summary
        .and_then(|summary| summary.quota)
        .context("account usage response has no quota block")?;
    Ok(AccountUsage::from_quota(quota, now_unix()))
}

/// A ten-cell text gauge, e.g. `▰▰▱▱▱▱▱▱▱▱`.
pub fn usage_gauge(percent: u8, cells: usize) -> String {
    // Any use at all shows one cell, so 2% does not read as untouched.
    let filled = ((percent as usize * cells) + 50) / 100;
    let filled = if percent > 0 { filled.max(1) } else { 0 }.min(cells);
    let mut gauge = String::with_capacity(cells * 3);
    for index in 0..cells {
        gauge.push(if index < filled { '▰' } else { '▱' });
    }
    gauge
}

/// Days/hours/minutes until `reset_at` (RFC 3339, UTC), e.g. `4h 52m`, `5d 10h`.
pub fn time_until(reset_at: &str, now_unix: u64) -> Option<String> {
    let target = parse_rfc3339_unix(reset_at)?;
    if target <= now_unix {
        return Some("now".to_string());
    }
    let remaining = target - now_unix;
    let days = remaining / 86_400;
    let hours = (remaining % 86_400) / 3_600;
    let minutes = (remaining % 3_600) / 60;
    Some(if days > 0 {
        format!("{days}d {hours}h")
    } else if hours > 0 {
        format!("{hours}h {minutes:02}m")
    } else {
        format!("{}m", minutes.max(1))
    })
}

/// One tray line for a usage window: `5 h    ▰▰▱▱▱▱▱▱▱▱   2% · resets in 4h 52m`.
pub fn usage_line(label: &str, window: &UsageWindow, now_unix: u64) -> String {
    let mut line = format!("{label:<5}");
    match window.percent_used() {
        Some(percent) => {
            line.push_str(&usage_gauge(percent, 10));
            line.push_str(&format!("  {percent:>3}%"));
        }
        None => line.push_str(&format!("{} used", window.used)),
    }
    if let Some(until) = window
        .reset_at
        .as_deref()
        .and_then(|reset_at| time_until(reset_at, now_unix))
    {
        line.push_str(&format!(" · resets in {until}"));
    }
    line
}

/// Minimal RFC 3339 (`YYYY-MM-DDTHH:MM:SS[.fff]Z` or with `±HH:MM`) to Unix seconds.
pub fn parse_rfc3339_unix(text: &str) -> Option<u64> {
    let text = text.trim();
    let bytes = text.as_bytes();
    if bytes.len() < 19 {
        return None;
    }
    let number =
        |range: std::ops::Range<usize>| -> Option<i64> { text.get(range)?.parse::<i64>().ok() };
    let year = number(0..4)?;
    let month = number(5..7)?;
    let day = number(8..10)?;
    let hour = number(11..13)?;
    let minute = number(14..16)?;
    let second = number(17..19)?;
    if !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
        || hour > 23
        || minute > 59
        || second > 60
    {
        return None;
    }
    // Offset: skip fractional seconds, then read Z or ±HH:MM.
    let mut rest = &text[19..];
    if let Some(stripped) = rest.strip_prefix('.') {
        let digits = stripped.chars().take_while(|c| c.is_ascii_digit()).count();
        rest = &stripped[digits..];
    }
    let offset_seconds = match rest {
        "" | "Z" | "z" => 0,
        other => {
            let sign = match other.chars().next()? {
                '+' => 1,
                '-' => -1,
                _ => return None,
            };
            let hh = other.get(1..3)?.parse::<i64>().ok()?;
            let mm = other.get(4..6)?.parse::<i64>().ok()?;
            sign * (hh * 3600 + mm * 60)
        }
    };
    let days = days_from_civil(year, month, day);
    let seconds = days * 86_400 + hour * 3_600 + minute * 60 + second - offset_seconds;
    u64::try_from(seconds).ok()
}

// Howard Hinnant's days-from-civil: days since 1970-01-01 for a proleptic
// Gregorian date.
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let month_index = (month + 9) % 12;
    let day_of_year = (153 * month_index + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_rfc3339_timestamps() {
        assert_eq!(parse_rfc3339_unix("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(
            parse_rfc3339_unix("2026-09-22T02:00:17.870Z"),
            Some(1_790_042_417)
        );
        assert_eq!(
            parse_rfc3339_unix("2026-09-22T04:00:17+02:00"),
            Some(1_790_042_417)
        );
        assert_eq!(parse_rfc3339_unix("not a date"), None);
    }

    #[test]
    fn formats_time_until_reset() {
        let now = parse_rfc3339_unix("2026-09-21T21:08:00Z").unwrap();
        assert_eq!(
            time_until("2026-09-22T02:00:17Z", now).as_deref(),
            Some("4h 52m")
        );
        assert_eq!(
            time_until("2026-09-27T07:30:00Z", now).as_deref(),
            Some("5d 10h")
        );
        assert_eq!(
            time_until("2026-09-21T21:20:00Z", now).as_deref(),
            Some("12m")
        );
        assert_eq!(
            time_until("2026-09-21T20:00:00Z", now).as_deref(),
            Some("now")
        );
    }

    #[test]
    fn formats_usage_lines_and_gauges() {
        assert_eq!(usage_gauge(0, 10), "▱▱▱▱▱▱▱▱▱▱");
        assert_eq!(usage_gauge(65, 10), "▰▰▰▰▰▰▰▱▱▱");
        assert_eq!(usage_gauge(100, 10), "▰▰▰▰▰▰▰▰▰▰");
        let now = parse_rfc3339_unix("2026-09-21T21:08:00Z").unwrap();
        let window = UsageWindow {
            used: 22,
            remaining: Some(978),
            limit: Some(1000),
            reset_at: Some("2026-09-22T02:00:17Z".to_string()),
        };
        assert_eq!(window.percent_used(), Some(2));
        assert_eq!(usage_gauge(2, 10), "▰▱▱▱▱▱▱▱▱▱");
        assert_eq!(
            usage_line("5 h", &window, now),
            "5 h  ▰▱▱▱▱▱▱▱▱▱    2% · resets in 4h 52m"
        );
        let unmetered = UsageWindow {
            used: 7,
            ..Default::default()
        };
        assert_eq!(unmetered.percent_used(), None);
        assert_eq!(usage_line("24 h", &unmetered, now), "24 h 7 used");
    }

    #[test]
    fn builds_usage_from_the_console_quota_block() {
        let raw = r#"{"success":true,"summary":{"quota":{"available":true,"tier":"max","displayName":"Autohand Code Max","accessState":"ready","window5h":{"used":22,"remaining":978,"limit":1000,"resetAt":"2026-09-22T02:00:17.870Z"},"window24h":{"used":0,"remaining":null,"limit":null,"resetAt":null},"week":{"used":443,"remaining":9557,"limit":10000,"resetAt":"2026-09-26T20:46:24.084Z"},"month":{"used":0,"remaining":null,"limit":null,"resetAt":null}}}}"#;
        let envelope: SummaryEnvelope = serde_json::from_str(raw).unwrap();
        let usage = AccountUsage::from_quota(envelope.summary.unwrap().quota.unwrap(), 5);
        assert_eq!(usage.display_name, "Autohand Code Max");
        assert_eq!(usage.tier, "max");
        let labels: Vec<&str> = usage
            .windows()
            .into_iter()
            .map(|(label, _)| label)
            .collect();
        assert_eq!(labels, vec!["5 h", "Week"]);
        assert_eq!(usage.week.percent_used(), Some(4));
        assert_eq!(plan_display_name("pro"), "Autohand Code Pro");
        assert_eq!(plan_display_name("scale"), "Autohand Code Scale");
    }
}
