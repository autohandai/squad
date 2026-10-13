import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sanitizeSquadEvent } from "../src/lib/product-telemetry.js";

export function telemetryHost(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    return url.origin;
  } catch { return null; }
}

export function readProductTelemetryConfig(rootDir, env = process.env) {
  let staged = {};
  try { staged = JSON.parse(readFileSync(join(rootDir, "PRODUCT_TELEMETRY.json"), "utf8")); } catch { /* No public ingestion config means inactive. */ }
  return { key: String(env.AUTOHAND_SQUAD_POSTHOG_KEY || env.NEXT_PUBLIC_POSTHOG_KEY || staged.key || ""),
    host: telemetryHost(env.AUTOHAND_SQUAD_POSTHOG_HOST || env.NEXT_PUBLIC_POSTHOG_HOST || staged.host) };
}

const digest = value => createHash("sha256").update(value).digest("hex");
export function squadAnalyticsIdentity(account) {
  if (!account?.signedIn) return null;
  const userId = String(account.userId || account.id || "").trim();
  const email = String(account.email || "").trim().toLowerCase();
  if (!userId && !email) return null;
  return { distinctId: userId || `squad-email:${digest(email)}`, userId: userId || undefined };
}

/** Direct ingestion mirrors Dev's server integration, never application credentials. */
export function createProductTelemetry({ config, account = () => null, fetchImpl = fetch, version = "", platform = process.platform } = {}) {
  const host = telemetryHost(config?.host);
  const enabled = Boolean(config?.key && host);
  let inFlight = 0;
  async function capture(input, { dnt = false } = {}) {
    const clean = sanitizeSquadEvent(input?.event, input?.properties);
    if (!enabled || dnt || !clean || inFlight >= 16) return { accepted: false };
    let currentAccount;
    try { currentAccount = account(); } catch { return { accepted: false }; }
    const identity = squadAnalyticsIdentity(currentAccount);
    // Sign-in starts can be counted without a stable anonymous machine profile.
    if (!identity && clean.event !== "sign_in_started") return { accepted: false };
    const properties = { ...clean.properties, distinct_id: identity?.distinctId || `squad-anonymous:${randomUUID()}`, $process_person_profile: Boolean(identity),
      $geoip_disable: true, source: "squad", product: "autohand_squad", app_version: version, platform };
    if ((clean.event === "member_created" || clean.event === "member_used") && typeof input.memberId === "string" && /^[\w-]{1,256}$/.test(input.memberId)) {
      properties.member_analytics_id = digest(`${identity.distinctId}:${input.memberId}`);
    }
    if (clean.event === "signed_in_session" || clean.event === "login_completed") {
      properties.$set = {};
      if (typeof currentAccount.name === "string" && currentAccount.name) properties.$set.name = currentAccount.name;
      if (typeof currentAccount.email === "string" && currentAccount.email) properties.$set.email = currentAccount.email;
    }
    inFlight += 1;
    try {
      const response = await fetchImpl(`${host}/capture/`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: config.key, ...clean, properties, timestamp: new Date().toISOString() }), signal: AbortSignal.timeout(3000) });
      await response.body?.cancel();
      return { accepted: response.ok };
    } catch { return { accepted: false }; }
    finally { inFlight -= 1; }
  }
  return { enabled, capture };
}
