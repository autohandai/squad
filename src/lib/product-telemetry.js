import { ownedSessionStorage } from './owned-storage.js';
import { ownershipFetch } from './ownership-client.js';
// Explicit product events only. No DOM capture, prompt text, paths or request bodies.
import { roleTemplates } from "./member-profiles.js";

// Only the shipped catalog is eligible. User-authored roles still become
// "custom"; importing a member or adding a preset cannot expand this list.
export const PREBUILT_MEMBER_TEMPLATES = new Set(roleTemplates.map(role => role.id));
export const TELEMETRY_FEATURES = new Set([
  "dm", "channels", "needs_you", "squad", "member_profile", "member_creation",
  "goal", "break", "task_progress", "handoff", "approval", "memory", "canvas",
  "workflows", "automations", "search", "settings", "updates", "about", "feedback",
  "harness", "skills", "connector", "onboarding",
]);
const actions = new Set(["open", "create", "send", "start", "stop", "pause", "resume", "accept", "decline", "save", "check", "upgrade", "complete"]);
const surfaces = new Set(["dm", "channel", "goal", "handoff", "automation"]);

// The marketplace funnel (ADR-0253): public listing ids and bounded words
// only. No names, search text, instructions or member content.
export const MARKETPLACE_EVENTS = new Set(["marketplace_opened", "marketplace_listing_viewed", "marketplace_add_started", "marketplace_add_succeeded", "marketplace_add_failed"]);
const marketplaceEntries = new Set(["directory", "minified", "command", "route", "link", "member_form"]);
const marketplaceSources = new Set(["website-link", "in-app", "link", "grok", "phone"]);
const marketplaceActions = new Set(["add", "update", "another"]);
const marketplaceReasons = new Set(["offline", "rate_limited", "not_found", "checksum", "invalid", "unavailable", "failed"]);

function marketplaceProperties(event, input) {
  if (event === "marketplace_opened") return { entry: marketplaceEntries.has(input.entry) ? input.entry : "directory" };
  // `via`, not `source`: every Squad event already carries source "squad".
  const via = input.via ?? input.source;
  const properties = { via: marketplaceSources.has(via) ? via : "in-app" };
  if (properties.via !== "grok") {
    if (!/^[a-z0-9]{12}$/.test(String(input.listing_id || ""))) return null;
    properties.listing_id = input.listing_id;
  }
  properties.listing_kind = input.listing_kind === "team" ? "team" : "agent";
  if (Number.isInteger(input.version) && input.version > 0 && input.version < 1e7) properties.version = input.version;
  if (/^[a-z0-9]{20}$/.test(String(input.attribution_id || ""))) properties.attribution_id = input.attribution_id;
  if (event === "marketplace_add_succeeded") {
    properties.action = marketplaceActions.has(input.action) ? input.action : "add";
    if (Number.isInteger(input.members) && input.members > 0 && input.members <= 50) properties.members = input.members;
  }
  if (event === "marketplace_add_failed") properties.reason = marketplaceReasons.has(input.reason) ? input.reason : "failed";
  return properties;
}

/** Drops unknown events and free-form properties on both sides of the bridge. */
export function sanitizeSquadEvent(event, input = {}) {
  if (!["signed_in_session", "sign_in_started", "login_completed", "member_created", "member_used", "feature_used"].includes(event) && !MARKETPLACE_EVENTS.has(event)) return null;
  input = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  if (MARKETPLACE_EVENTS.has(event)) {
    const properties = marketplaceProperties(event, input);
    return properties ? { event, properties } : null;
  }
  const properties = {};
  if (event === "member_created" || event === "member_used") {
    const template = PREBUILT_MEMBER_TEMPLATES.has(input.template_id) ? input.template_id : "custom";
    properties.template_id = template;
    properties.member_origin = template === "custom" ? "custom" : "prebuilt";
    properties.harness = ["autohand", "codex", "claude"].includes(input.harness) ? input.harness : "unknown";
    if (event === "member_used") properties.surface = surfaces.has(input.surface) ? input.surface : "dm";
  }
  if (event === "feature_used") {
    if (!TELEMETRY_FEATURES.has(input.feature) || !actions.has(input.action)) return null;
    properties.feature = input.feature;
    properties.action = input.action;
  }
  return { event, properties };
}

function sessionStore() {
  try { return ownedSessionStorage; } catch { return undefined; }
}

export function createSquadTelemetryClient({ fetchImpl = ownershipFetch, navigatorImpl = globalThis.navigator, storage = sessionStore() } = {}) {
  let signedInAs = "";
  let loginStarted = false;
  const noTracking = () => navigatorImpl?.doNotTrack === "1" || navigatorImpl?.msDoNotTrack === "1" || navigatorImpl?.globalPrivacyControl === true;
  function capture(event, properties = {}) {
    const clean = sanitizeSquadEvent(event, properties);
    if (!clean || noTracking()) return;
    const memberId = typeof properties.memberId === "string" && /^[\w-]{1,256}$/.test(properties.memberId) ? properties.memberId : undefined;
    try {
      void Promise.resolve(fetchImpl("/api/product-telemetry", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...clean, ...(memberId ? { memberId } : {}) }),
        signal: AbortSignal.timeout(4000),
      })).catch(() => {});
    } catch { /* Analytics never interrupts the product action. */ }
  }
  function identify(account) {
    if (!account?.signedIn) { signedInAs = ""; return; }
    // Identity is resolved by the bridge; none of this key leaves the client.
    const key = String(account.userId || account.id || account.email || "signed-in");
    if (signedInAs === key) return;
    signedInAs = key;
    let seen = false;
    try { seen = storage?.getItem("squad-telemetry-signed-session") === key; storage?.setItem("squad-telemetry-signed-session", key); } catch { /* Storage may be disabled. */ }
    if (!seen) capture("signed_in_session");
    let pending = loginStarted;
    try {
      const began = Number(storage?.getItem("squad-telemetry-auth-start") || 0);
      pending ||= began > 0 && Date.now() - began < 3600000;
      storage?.removeItem("squad-telemetry-auth-start");
    } catch { /* Storage may be disabled. */ }
    if (pending) { capture("login_completed"); loginStarted = false; }
  }
  const member = (event, agent, surface) => capture(event, { memberId: agent?.id, template_id: agent?.employeeType, harness: agent?.harness?.id || agent?.harness, surface });
  return { capture, identify, signInStarted() {
    loginStarted = true;
    try { storage?.setItem("squad-telemetry-auth-start", String(Date.now())); } catch { /* Storage may be disabled. */ }
    capture("sign_in_started");
  },
    memberCreated(agent) { member("member_created", agent); }, memberUsed(agent, surface = "dm") { member("member_used", agent, surface); },
    featureUsed(feature, action = "open") { capture("feature_used", { feature, action }); },
    marketplace(event, properties = {}) { capture(event, properties); } };
}

const client = createSquadTelemetryClient();
export const captureSquadEvent = client.capture;
export const identifySquadTelemetry = client.identify;
export const recordSignInStarted = client.signInStarted;
export const recordMemberCreated = client.memberCreated;
export const recordMemberUsed = client.memberUsed;
export const recordFeatureUsed = client.featureUsed;
export const recordMarketplaceEvent = client.marketplace;
