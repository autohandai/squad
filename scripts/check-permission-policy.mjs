#!/usr/bin/env node
// What each rung of the autonomy ladder lets a member do.
//
// This used to live in the React monolith, where Node could not run it, so
// the only guard was a regular expression over the source. Under that guard
// two faults shipped: the ladder blocks every tool and grants back per rung,
// and it never granted the skills group, so `skill` was blocked at every rung
// and no member could use a skill it had.
//
// See docs/adrs/ADR-0041-permissions-survive-the-bridge.md and
// docs/adrs/ADR-0042-permission-policy-module.md.

import assert from "node:assert/strict";

import {
  BUILT_IN_TOOL_POLICY_GROUPS,
  COMPUTER_USE_TOOLS,
  DEFAULT_BUILT_IN_TOOL_POLICIES,
  MERGE_BLOCKED_TOOLS,
  SQUAD_TEAM_TOOLS,
  SQUAD_UNREACHABLE_TOOLS,
  VAULT_TOOLS,
  builtInPoliciesForRank,
  managedToolPolicies,
  mcpToolKind,
} from "../src/lib/permission-policy.js";

const RANKS = [1, 2, 3, 4];
const MODES = new Set(["allow", "ask", "block"]);

// --- the shape of the policy ----------------------------------------------

{
  assert.ok(BUILT_IN_TOOL_POLICY_GROUPS.length >= 5, "the groups are there");
  const ids = BUILT_IN_TOOL_POLICY_GROUPS.map((group) => group.id);
  assert.equal(new Set(ids).size, ids.length, "group ids are unique");
  const seen = new Set();
  for (const group of BUILT_IN_TOOL_POLICY_GROUPS) {
    assert.ok(group.title, `${group.id} has a title`);
    for (const [tool, mode] of group.tools) {
      assert.ok(MODES.has(mode), `${tool} declares a real mode, not ${mode}`);
      assert.ok(!seen.has(tool), `${tool} appears in one group only`);
      seen.add(tool);
    }
  }
  assert.deepEqual([...seen].sort(), Object.keys(DEFAULT_BUILT_IN_TOOL_POLICIES).sort());
}

// --- every rung answers for every tool ------------------------------------

{
  for (const rank of RANKS) {
    const policies = builtInPoliciesForRank(rank);
    assert.deepEqual(
      Object.keys(policies).sort(),
      Object.keys(DEFAULT_BUILT_IN_TOOL_POLICIES).sort(),
      `rank ${rank} has an answer for every known tool`
    );
    for (const [tool, mode] of Object.entries(policies)) {
      assert.ok(MODES.has(mode), `rank ${rank} gives ${tool} a real mode`);
    }
  }
  // Nonsense ranks still produce a complete, safe policy rather than throwing.
  for (const rank of [0, -1, 99, null, undefined, "3", NaN]) {
    const policies = builtInPoliciesForRank(rank);
    assert.equal(Object.keys(policies).length, Object.keys(DEFAULT_BUILT_IN_TOOL_POLICIES).length, `rank ${rank} is complete`);
  }
}

// --- the bug this file exists for -----------------------------------------
//
// A member that cannot run `skill` cannot use any skill it has, which is the
// whole feature. Using one and looking up which exist are reads of the
// member's own profile, so they are allowed at every rung.

{
  for (const rank of RANKS) {
    const policies = builtInPoliciesForRank(rank);
    assert.equal(policies.skill, "allow", `rank ${rank} lets a member use its own skills`);
    assert.equal(policies.find_agent_skills, "allow", `rank ${rank} lets a member see which skills exist`);
    assert.equal(policies.squad_create_channel, "ask", `rank ${rank} asks before creating shared channels`);
    assert.notEqual(policies.install_agent_skill, "block", `rank ${rank} does not refuse installing outright`);
  }
  // Installing changes the member, so it asks rather than proceeding silently.
  assert.equal(builtInPoliciesForRank(4).install_agent_skill, "ask");
}

// --- the ladder actually climbs -------------------------------------------

{
  const weight = { block: 0, ask: 1, allow: 2 };
  const total = (rank) => Object.values(builtInPoliciesForRank(rank)).reduce((sum, mode) => sum + weight[mode], 0);
  for (let i = 1; i < RANKS.length; i += 1) {
    assert.ok(total(RANKS[i]) >= total(RANKS[i - 1]), `rank ${RANKS[i]} is not more restrictive than rank ${RANKS[i - 1]}`);
  }
  assert.ok(total(4) > total(1), "the top rung grants more than the bottom one");

  // The lowest rung is a conversation, not a shell.
  const lowest = builtInPoliciesForRank(1);
  for (const tool of ["shell", "write_file", "delete_path"]) {
    if (tool in lowest) assert.equal(lowest[tool], "block", `the lowest rung blocks ${tool}`);
  }
}

// --- merging is never automatic -------------------------------------------

{
  for (const rank of RANKS) {
    const policies = builtInPoliciesForRank(rank);
    for (const tool of MERGE_BLOCKED_TOOLS) {
      if (tool in policies) assert.equal(policies[tool], "block", `rank ${rank} blocks ${tool}; auto-merge stays off`);
    }
    if ("delete_path" in policies) assert.equal(policies.delete_path, "block", `rank ${rank} blocks delete_path`);
  }
}

// --- the first-run path (ADR-0161) ------------------------------------------
//
// Chief of Staff could not reach a single Squad team tool at any rung, the
// follow-up question answered itself "Yes", and Autohand Code's in-process
// teams were offered as if they created Squad members.

{
  for (const rank of RANKS) {
    const policies = builtInPoliciesForRank(rank);
    for (const tool of SQUAD_TEAM_TOOLS) {
      assert.equal(policies[tool], ['squad_create_channel', 'squad_create_group_chat', 'squad_convert_group_chat', 'squad_delete_group_chat', 'squad_create_member', 'squad_get_member_profile', 'squad_update_member_profile', 'squad_set_member_workspace', 'squad_list_skills', 'squad_set_member_skills', 'squad_set_member_memories', 'squad_list_routines', 'squad_create_routine', 'squad_update_routine'].includes(tool) ? 'ask' : 'allow', `rank ${rank} lets a member reach ${tool}`);
    }
    for (const tool of SQUAD_UNREACHABLE_TOOLS) {
      assert.equal(policies[tool], "block", `rank ${rank} blocks ${tool}, which can never reach a Squad window`);
    }
    assert.equal(policies.delegate_task, "ask", `rank ${rank} still lets a member delegate inside its own engine with approval`);
  }
  assert.ok(SQUAD_TEAM_TOOLS.includes("squad_propose_team"), "the team-builder route is a team tool");
  assert.ok(SQUAD_TEAM_TOOLS.includes("squad_message"), "messaging teammates is a team tool");

  // The engine checks mcp__<server>__<tool>; the rows people see are bare names.
  const managed = new Map(managedToolPolicies(builtInPoliciesForRank(1), { connectors: ["autohand-squad-web"] }));
  assert.equal(managed.get(mcpToolKind("autohand-squad", "squad_team")), "allow");
  assert.equal(managed.get(mcpToolKind("autohand-squad", "squad_propose_team")), "allow");
  assert.equal(managed.get(mcpToolKind("autohand-squad", "squad_create_channel")), "allow", "Squad asks itself about channel creation; the MCP layer lets the call through");
  assert.equal(managed.get(mcpToolKind("autohand-squad", "squad_schedule")), "allow");
  assert.equal(managed.get(mcpToolKind("autohand-squad-web", "web_search")), "allow");
  for (const tool of COMPUTER_USE_TOOLS) assert.equal(managed.get(mcpToolKind("autohand-computer-use", tool)), "allow", `${tool} is reachable; the proxy enforces the grant`);
  // Rank 1 has no vault; rank 3 does, with the group's own modes.
  for (const tool of VAULT_TOOLS) assert.equal(managed.get(mcpToolKind("autohand-vault", tool)), "block", `rank 1 keeps ${tool} off`);
  const vaulted = new Map(managedToolPolicies(builtInPoliciesForRank(3)));
  assert.equal(vaulted.get(mcpToolKind("autohand-vault", "vault_list")), "allow");
  assert.equal(vaulted.get(mcpToolKind("autohand-vault", "request_secret")), "ask");
  // A person's explicit block wins; a gated tool they blocked stays blocked.
  const blocked = new Map(managedToolPolicies({ ...builtInPoliciesForRank(4), squad_message: "block", squad_create_channel: "block" }));
  assert.equal(blocked.get(mcpToolKind("autohand-squad", "squad_message")), "block");
  assert.equal(blocked.get(mcpToolKind("autohand-squad", "squad_create_channel")), "block");
  // A saved profile from before the group existed still gets the defaults.
  const legacy = new Map(managedToolPolicies({ read_file: "allow" }));
  assert.equal(legacy.get(mcpToolKind("autohand-squad", "squad_team")), "allow");
  assert.equal(legacy.get(mcpToolKind("autohand-squad", "squad_create_channel")), "allow");
}

console.log("check-permission-policy: ok");
