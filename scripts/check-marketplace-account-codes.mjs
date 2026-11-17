#!/usr/bin/env node
// A marketplace reply must never look like "your Autohand account changed"
// (ADR-0246, amended 2026-11-17). The browser reloads the whole app on a
// 401/409 carrying sign_in_required, context_changed or identity_mismatch
// (src/lib/ownership-client.js). squad.autohand.ai without the marketplace
// answers 401 sign_in_required; passed through, it reloaded the app in a loop
// while a squad:// link was open. This drives the real service and route
// against a cloud stand-in that answers exactly that.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createMarketplace } from "../server/marketplace/service.mjs";
import { handle } from "../server/routes/marketplace.route.mjs";

const dir = await mkdtemp(join(tmpdir(), "squad-marketplace-codes-"));
const cloud = async () => new Response(JSON.stringify({ success: false, error: { code: "sign_in_required", message: "Sign in to Squad." } }), { status: 401, headers: { "content-type": "application/json" } });
const ctx = {
  squadStateDir: dir,
  readOptionalJsonFile: async () => null,
  writeJsonFile: async () => {},
  logEvent: () => {},
  SEVERITY: {},
  mobileRelayIdentity: () => null,
  packageMetadata: { version: "0.0.0" },
  json(res, status, body) { res.status = status; res.body = body; },
};
ctx.marketplace = createMarketplace(ctx, { fetchImpl: cloud, baseUrl: "https://squad.example", grok: "https://x.ai" });

async function call(path, method = "GET") {
  const res = {};
  const req = { method, headers: {} };
  ctx.readBody = async () => ({});
  await handle(req, res, new URL(path, "http://127.0.0.1"), ctx);
  return res;
}

try {
  const accountCodes = ["sign_in_required", "context_changed", "identity_mismatch"];
  for (const [path, method] of [["/api/marketplace/agents"], ["/api/marketplace/categories"], ["/api/marketplace/agents/a1b2c3d4e5f6"], ["/api/marketplace/publish/context"], ["/api/marketplace/mine"]]) {
    const res = await call(path, method);
    if (res.body?.success) continue; // e.g. publish context answers { signedIn: false }
    assert.notEqual(res.status, 401, `${path} must not answer 401 (${JSON.stringify(res.body)})`);
    assert.ok(!(res.status === 409 && accountCodes.includes(res.body.code)), `${path} must not answer 409 with an account code`);
    assert.ok(!accountCodes.includes(res.body.code), `${path} must not carry ${res.body.code}`);
  }
  console.log("check-marketplace-account-codes: ok (a cloud 401 sign_in_required never reaches the browser as an account change)");
} finally {
  await rm(dir, { recursive: true, force: true });
}
