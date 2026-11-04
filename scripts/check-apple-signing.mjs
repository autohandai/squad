import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { appleSigningConfiguration } from "./prepare-apple-signing.mjs";

const fixture = { APPLE_CERTIFICATE: "fixture-certificate", APPLE_CERTIFICATE_PASSWORD: "fixture-password", APPLE_TEAM_ID: "J59GX2DRN2", APPLE_API_KEY: "-----BEGIN PRIVATE KEY-----\nfixture-only\n-----END PRIVATE KEY-----", APPLE_API_KEY_ID: "T678YJKXZ2", APPLE_API_ISSUER: "8bee8102-92b0-4657-aa5c-641420a8830f" };
assert.deepEqual(appleSigningConfiguration(fixture), { team: "J59GX2DRN2", mode: "api" });
for (const name of Object.keys(fixture)) {
  const env = { ...fixture, [name]: "" };
  assert.throws(() => appleSigningConfiguration(env), error => !error.message.includes(fixture.APPLE_CERTIFICATE_PASSWORD) && !error.message.includes(fixture.APPLE_API_KEY));
}
const legacy = Object.fromEntries(Object.entries(fixture).filter(([name]) => !name.startsWith("APPLE_API_")));
assert.throws(() => appleSigningConfiguration(legacy), /notarization credentials are missing/);
assert.equal(appleSigningConfiguration({ ...legacy, APPLE_ID: "fixture@example.test", APPLE_PASSWORD: "fixture-app-specific-password" }).mode, "apple-id");
assert.throws(() => appleSigningConfiguration({ ...fixture, APPLE_TEAM_ID: "wrong" }), /APPLE_TEAM_ID/);
assert.throws(() => appleSigningConfiguration({ ...fixture, APPLE_API_KEY_ID: "wrong" }), /APPLE_API_KEY_ID/);
assert.throws(() => appleSigningConfiguration({ ...fixture, APPLE_API_ISSUER: "wrong" }), /APPLE_API_ISSUER/);
const childEnv = { ...process.env };
for (const name of [...Object.keys(fixture), "APPLE_ID", "APPLE_PASSWORD"]) delete childEnv[name];
const missing = spawnSync(process.execPath, ["scripts/prepare-apple-signing.mjs", "--check-env"], { env: childEnv, encoding: "utf8" });
assert.equal(missing.status, 1);
assert.match(missing.stderr, /Publication is blocked/);
const workflow = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
assert.ok(workflow.includes("node scripts/prepare-apple-signing.mjs"), "Public releases validate real signing and notarization credentials.");
assert.ok(!workflow.includes('APPLE_SIGNING_IDENTITY="-"'), "Public releases cannot fall back to ad-hoc signing.");
assert.ok(!workflow.includes('|| echo "::warning::Gatekeeper'), "Gatekeeper rejection blocks publication.");
assert.ok(workflow.includes('xcrun stapler validate "$app"'), "The shipped app carries its notarization ticket.");
console.log("PASS Apple release credentials fail closed; API and Apple ID modes validate without exposing secrets; public workflow requires Developer ID, notarization and Gatekeeper acceptance.");
