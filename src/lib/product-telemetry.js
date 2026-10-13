// Explicit product events only. No DOM capture, prompt text, paths or request bodies.
export const PREBUILT_MEMBER_TEMPLATES = new Set([
  "frontend-developer", "backend-engineer", "full-stack-developer", "mobile-developer",
  "ux-ui-designer", "solution-architect", "devops-engineer", "platform-engineer",
  "security-engineer", "ai-engineer", "scrum-master", "technical-writer",
  "common-qa-engineer", "product-manager", "data-analyst", "content-operations-specialist",
]);
export const TELEMETRY_FEATURES = new Set([
  "dm", "channels", "needs_you", "squad", "member_profile", "member_creation",
  "goal", "break", "task_progress", "handoff", "approval", "memory", "canvas",
  "workflows", "automations", "search", "settings", "updates", "about", "feedback",
  "harness", "skills", "connector", "onboarding",
]);
const actions = new Set(["open", "create", "send", "start", "stop", "pause", "resume", "accept", "decline", "save", "check", "upgrade", "complete"]);
const surfaces = new Set(["dm", "channel", "goal", "handoff", "automation"]);

/** Drops unknown events and free-form properties on both sides of the bridge. */
export function sanitizeSquadEvent(event, input = {}) {
  if (!["signed_in_session", "sign_in_started", "login_completed", "member_created", "member_used", "feature_used"].includes(event)) return null;
  input = input && typeof input === "object" && !Array.isArray(input) ? input : {};
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
  try { return globalThis.sessionStorage; } catch { return undefined; }
}

export function createSquadTelemetryClient({ fetchImpl = (...args) => globalThis.fetch(...args), navigatorImpl = globalThis.navigator, storage = sessionStore() } = {}) {
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
    featureUsed(feature, action = "open") { capture("feature_used", { feature, action }); } };
}

const client = createSquadTelemetryClient();
export const captureSquadEvent = client.capture;
export const identifySquadTelemetry = client.identify;
export const recordSignInStarted = client.signInStarted;
export const recordMemberCreated = client.memberCreated;
export const recordMemberUsed = client.memberUsed;
export const recordFeatureUsed = client.featureUsed;
