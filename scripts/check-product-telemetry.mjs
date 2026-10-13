import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { roleTemplates } from "../src/data.js";
import { createSquadTelemetryClient, PREBUILT_MEMBER_TEMPLATES, sanitizeSquadEvent } from "../src/lib/product-telemetry.js";
import { createProductTelemetry, readProductTelemetryConfig, squadAnalyticsIdentity, telemetryHost } from "../server/product-telemetry.mjs";
import { stageProductTelemetry } from "./stage-product-telemetry.mjs";

assert.deepEqual([...PREBUILT_MEMBER_TEMPLATES].sort(), roleTemplates.map(role => role.id).sort());
assert.equal(sanitizeSquadEvent("unknown", {}), null);
assert.equal(sanitizeSquadEvent("feature_used", null), null);
assert.equal(sanitizeSquadEvent("feature_used", { feature: "/Users/private/repo", action: "open" }), null);
assert.deepEqual(sanitizeSquadEvent("member_used", { template_id: "private-company-specialist", harness: "custom executable path", surface: "dm", prompt: "secret prompt", name: "Someone" }), {
  event: "member_used", properties: { template_id: "custom", member_origin: "custom", harness: "unknown", surface: "dm" },
});
for (const host of ["http://posthog.example", "https://user:pass@posthog.example", "https://posthog.example/secret", "https://posthog.example?secret=1", "invalid"]) assert.equal(telemetryHost(host), null);
assert.equal(telemetryHost("https://us.i.posthog.com"), "https://us.i.posthog.com");

const sent = [];
const memory = new Map();
const storage = { getItem: key => memory.get(key) || null, setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) };
const client = createSquadTelemetryClient({ navigatorImpl: {}, storage, fetchImpl: async (url, options) => { sent.push({ url, options, data: JSON.parse(options.body) }); return new Response("{}"); } });
const account = { signedIn: true, userId: "database-user", email: "person@example.com", name: "Person", token: "DO-NOT-CAPTURE" };
client.signInStarted();
client.identify(account);
client.identify(account);
client.memberCreated({ id: "asq_member_a", employeeType: "common-qa-engineer", harness: { id: "codex", executablePath: "/private/cli" }, name: "Never captured" });
client.memberUsed({ id: "asq_member_a", employeeType: "common-qa-engineer", harness: { id: "codex" } });
client.featureUsed("goal", "start");
client.featureUsed("private-feature-name", "open");
assert.deepEqual(sent.map(row => row.data.event), ["sign_in_started", "signed_in_session", "login_completed", "member_created", "member_used", "feature_used"]);
assert.ok(sent.every(row => row.url === "/api/product-telemetry"));
assert.ok(!JSON.stringify(sent).includes(account.email));
assert.ok(!JSON.stringify(sent).includes("Never captured"));
assert.ok(!JSON.stringify(sent).includes("/private/cli"));
assert.ok(!JSON.stringify(sent).includes("DO-NOT-CAPTURE"));
createSquadTelemetryClient({ navigatorImpl: { doNotTrack: "1" }, fetchImpl: () => { throw new Error("DNT must skip fetch"); } }).capture("sign_in_started");
createSquadTelemetryClient({ navigatorImpl: { globalPrivacyControl: true }, fetchImpl: () => { throw new Error("GPC must skip fetch"); } }).capture("sign_in_started");
createSquadTelemetryClient({ navigatorImpl: {}, fetchImpl: () => { throw new Error("Network down"); } }).capture("sign_in_started");
const reload = createSquadTelemetryClient({ navigatorImpl: {}, storage, fetchImpl: async () => { throw new Error("Existing session must not be counted again"); } });
reload.identify(account);
assert.equal(squadAnalyticsIdentity({ signedIn: false, email: account.email }), null);
assert.equal(squadAnalyticsIdentity(account).distinctId, "database-user");
const fallback = squadAnalyticsIdentity({ signedIn: true, email: account.email });
assert.match(fallback.distinctId, /^squad-email:[a-f0-9]{64}$/);
assert.ok(!fallback.distinctId.includes(account.email));

const network = [];
const backend = createProductTelemetry({ config: { key: "public-test-ingestion-key", host: "https://us.i.posthog.com" }, account: () => account,
  fetchImpl: async (url, options) => { network.push({ url, data: JSON.parse(options.body), options }); return new Response(null, { status: 200 }); }, version: "0.1.5", platform: "darwin" });
assert.equal(backend.enabled, true);
await backend.capture({ event: "member_used", memberId: "asq_member_a", properties: { template_id: "common-qa-engineer", harness: "codex", surface: "dm", prompt: "secret prompt", memberName: "private-name", token: "DO-NOT-CAPTURE", distinct_id: "spoofed" } });
assert.equal(network.length, 1);
assert.equal(network[0].url, "https://us.i.posthog.com/capture/");
assert.equal(network[0].data.properties.distinct_id, account.userId);
assert.match(network[0].data.properties.member_analytics_id, /^[a-f0-9]{64}$/);
assert.ok(!JSON.stringify(network).includes("asq_member_a"));
assert.ok(!JSON.stringify(network).includes("secret prompt"));
assert.ok(!JSON.stringify(network).includes("DO-NOT-CAPTURE"));
assert.ok(!JSON.stringify(network).includes("spoofed"));
await backend.capture({ event: "signed_in_session" });
assert.deepEqual(network[1].data.properties.$set, { name: account.name, email: account.email });
await backend.capture({ event: "signed_in_session" }, { dnt: true });
assert.equal(network.length, 2);
await backend.capture({ event: "unknown" });
assert.equal(network.length, 2);
const disabled = createProductTelemetry({ config: {}, fetchImpl: () => { throw new Error("Disabled telemetry must not send"); } });
assert.equal(disabled.enabled, false);
assert.equal((await disabled.capture({ event: "signed_in_session" })).accepted, false);
const failed = createProductTelemetry({ config: { key: "public-test-key", host: "https://us.i.posthog.com" }, account: () => account, fetchImpl: async () => { throw new Error("Telemetry outage"); } });
assert.equal((await failed.capture({ event: "signed_in_session" })).accepted, false);
const anonymous = createProductTelemetry({ config: { key: "public-test-key", host: "https://us.i.posthog.com" }, account: () => ({ signedIn: false }), fetchImpl: async (_url, options) => {
  const data = JSON.parse(options.body); assert.equal(data.properties.$process_person_profile, false); assert.match(data.properties.distinct_id, /^squad-anonymous:/); return new Response(null);
} });
assert.equal((await anonymous.capture({ event: "sign_in_started" })).accepted, true);
assert.equal((await anonymous.capture({ event: "member_created" })).accepted, false);

const temp = await mkdtemp(join(tmpdir(), "squad-product-telemetry-"));
try {
  await writeFile(join(temp, ".env"), "NEXT_PUBLIC_POSTHOG_KEY='public-test-key'\nNEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com\nAPPLICATION_SECRET=DO-NOT-COPY\n");
  assert.equal((await stageProductTelemetry({ rootDir: temp, runtimeDir: temp, env: {} })).enabled, true);
  const text = await readFile(join(temp, "PRODUCT_TELEMETRY.json"), "utf8");
  assert.ok(!text.includes("DO-NOT-COPY"));
  assert.deepEqual(readProductTelemetryConfig(temp, {}), { key: "public-test-key", host: "https://us.i.posthog.com" });
  await stageProductTelemetry({ rootDir: temp, runtimeDir: temp, env: {}, envFile: join(temp, "missing.env") });
  assert.equal(readProductTelemetryConfig(temp, {}).key, "");
} finally { await rm(temp, { recursive: true, force: true }); }
console.log("Squad product telemetry: schema, privacy, trusted identity, session dedup, DNT, staging and failure isolation passed (mock ingestion only).");
