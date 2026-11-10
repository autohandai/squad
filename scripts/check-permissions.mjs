#!/usr/bin/env node
// A member's tool permissions survive the bridge.
//
// Two faults shipped together and neither had a test.
//
// 1. `/api/chat/warm` posts only an agent id, and `ensureAgentRuntime` used
//    that empty agent to rewrite the member's config.json permissions with
//    empty allow, ask and block lists. Warming fires once per member every
//    time a chat opens, so a tool the person moved from blocked to ask went
//    back to blocked "the moment it tries to use it", which is how a user
//    described it.
// 2. The autonomy ladder blocked every tool and never granted the skills
//    group, so `skill` was blocked at all four levels and no member could use
//    a skill it had.
//
// This drives the real bridge, so it holds however the code is arranged.
//
// See docs/adrs/ADR-0041-permissions-survive-the-bridge.md.

import assert from "node:assert/strict";
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {startBridge} from './lib/reliability-browser.mjs';
const workspace=resolve(new URL('..',import.meta.url).pathname);
const bridge=await startBridge({prepare:async directory=>{
  const sdk=join(directory,'permissions-sdk.mjs');
  await writeFile(sdk,'export class AutohandSDK {async start(){} async close(){} async interrupt(){}}');
  return {AUTOHAND_AGENT_SDK_ENTRY:sdk,AUTOHAND_AGENT_SDK_DIR:directory};
}});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const post=(path,body)=>bridge.api(path,'POST',body);
const configFor=async id=>JSON.parse(await readFile(join(bridge.appRoot,'agents',id,'config.json'),'utf8'));

try {
  assert.equal((await bridge.api('/api/runtime')).success,true,'The owned fixture bridge started.');

  // --- a member whose owner asked for one tool to prompt -------------------

  const id = "permcheck";
  const agent = {
    id,
    name: "Perm Check",
    workspace,
    skills: [],
    permissions: {
      permissionMode: "interactive",
      builtInToolPolicyEnabled: true,
      builtInPolicies: { skill: "ask", shell: "block", plan: "allow" },
    },
  };

  const provisioned = await post("/api/agents/provision", { agentId: id, agent, workspace });
  assert.ok(provisioned?.success, `provisioning worked: ${provisioned?.error || ""}`);

  const before = await configFor(id);
  const rulesFor = (config, tool) => (config.permissions?.rules || []).find((rule) => rule.tool === tool);
  const listHas = (config, key, tool) => (config.permissions?.[key] || []).some((entry) => entry.kind === tool);

  assert.ok(rulesFor(before, "skill"), "the tool the person set to ask is written as a prompt rule");
  assert.equal(rulesFor(before, "skill").action, "prompt");
  assert.ok(listHas(before, "excludedTools", "shell"), "a blocked tool is written as excluded");
  assert.ok(listHas(before, "allowPatterns", "plan"), "an allowed tool is written as allowed");

  // --- the warm call must not touch any of it -----------------------------

  const warmed = await post("/api/chat/warm", { agentId: id, workspace });
  assert.ok(warmed?.success !== false, "warming answered");
  await sleep(600);

  const after = await configFor(id);
  assert.deepEqual(
    after.permissions,
    before.permissions,
    "a request that carries no agent must not rewrite that member's permissions"
  );
  assert.ok(rulesFor(after, "skill"), "the ask rule is still there after warming");
  assert.ok(listHas(after, "excludedTools", "shell"), "the block is still there after warming");

  // Any agent-less call, not just warming: the guard is about the payload.
  await post("/api/chat/warm", { agentId: id, workspace, agent: null });
  await sleep(400);
  assert.deepEqual((await configFor(id)).permissions, before.permissions, "a null agent is also no agent");

  // --- and describing the member still updates it --------------------------

  const changed = { ...agent, permissions: { ...agent.permissions, builtInPolicies: { skill: "allow", shell: "block", plan: "allow" } } };
  await post("/api/agents/provision", { agentId: id, agent: changed, workspace });
  const updated = await configFor(id);
  assert.ok(listHas(updated, "allowPatterns", "skill"), "a call that does describe the member still updates it");

  // The ladder itself is tested by running it, in
  // scripts/check-permission-policy.mjs, now that the policy lives in
  // src/lib and Node can import it.

  console.log("check-permissions: ok");
} finally { await bridge.close(); }
