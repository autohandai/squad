import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { roleTemplates } from '../src/data.js';
import { DEFAULT_BUILT_IN_TOOL_POLICIES } from '../src/lib/permission-policy.js';
import { startBridge } from './lib/reliability-browser.mjs';

// Explicit live verification. Uses the configured account/provider, an isolated
// member home and a disposable project. Never print credentials or raw config.
const source = process.env.SQUAD_LIVE_CONFIG || process.env.AUTOHAND_USER_CONFIG_PATH || join(process.env.AUTOHAND_HOME || join(homedir(), '.autohand'), 'config.json');
const original = JSON.parse(await readFile(source, 'utf8'));
const selectedRole = process.argv.find(arg => arg.startsWith('--role='))?.slice(7);
const checkedRoles = ['frontend-developer', 'common-qa-engineer'].filter(role => !selectedRole || role === selectedRole);
assert.ok(checkedRoles.length, 'Unknown live role selection.');
const workspace = join(process.cwd(), '.codex-artifacts', 'reliability', 'live-profile-project');
await mkdir(workspace, { recursive: true });
await writeFile(join(workspace, 'README.md'), '# Profile verification project\n\nMarker: SQUAD_REAL_ROLE_CONTEXT_731\n\nThe interface has a form with no keyboard focus indication and a Save button that occasionally appears successful after a failed API response. Assess it only; do not edit this project.\n');
const policies = Object.fromEntries(Object.keys(DEFAULT_BUILT_IN_TOOL_POLICIES).map(tool => [tool, 'block']));
for (const tool of ['read_file', 'fff_find', 'fff_grep', 'list_tree', 'file_stats', 'tools_registry', 'tool_search']) policies[tool] = 'allow';
const bridge = await startBridge({ prepare: async directory => {
  const config = Object.fromEntries(['provider', 'auth', 'autohandai', 'openrouter', 'openai', 'ollama', 'llmgateway', 'bedrock', 'deepseek', 'zai', 'nvidia', 'cerebras'].filter(key => original[key] !== undefined).map(key => [key, original[key]]));
  config.mcp = { servers: [] };
  config.hooks = {};
  await writeFile(join(directory, 'config.json'), JSON.stringify(config), { mode: 0o600 });
  return { AUTOHAND_AGENT_SDK_ENTRY: '', AUTOHAND_AGENT_SDK_DIR: '' };
} });
const observations = [];
const evidencePath = '.codex-artifacts/reliability/live-member-profiles' + (selectedRole ? '-' + selectedRole : '') + '.json';
const saveEvidence = async extra => writeFile(evidencePath, JSON.stringify({ provider: original.provider, source: 'real SDK/CLI and configured provider; no response fixtures', observations, ...extra }, null, 2), { mode: 0o600 });
async function chat(payload) {
  // timeoutMs is an inactivity window in the SDK, not a total duration. Use
  // the normal streamed transport so active turns cannot hit HTTP's headers
  // deadline while the provider continues to emit events.
  const response = await fetch(bridge.origin + '/api/chat/stream', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(480000) });
  assert.equal(response.ok, true, 'Live streaming request was rejected.');
  const decoder = new TextDecoder();
  let pending = '', result, failure, events = 0;
  const progress = setInterval(() => console.log('Live turn ' + payload.agentId + ': ' + events + ' stream events received'), 30000);
  try {
    for await (const chunk of response.body) {
      pending += decoder.decode(chunk, { stream: true }).replaceAll('\r\n', '\n');
      let boundary;
      while ((boundary = pending.indexOf('\n\n')) >= 0) {
        const frame = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
        const kind = frame.match(/^event: (.+)$/m)?.[1];
        const data = frame.split('\n').filter(line => line.startsWith('data: ')).map(line => line.slice(6)).join('\n');
        if (!data) continue;
        events++;
        if (kind === 'done') result = JSON.parse(data);
        if (kind === 'error') failure = JSON.parse(data);
      }
    }
    assert.ok(!failure, failure?.error || failure?.message || 'Live streamed turn failed.');
    assert.ok(result, 'Live streamed turn ended without a completion.');
    return { success: true, data: result };
  } finally { clearInterval(progress); }
}
try {
  for (const type of checkedRoles) {
    const role = roleTemplates.find(role => role.id === type);
    const id = 'asq_live_' + type.replaceAll('-', '_');
    const agent = { id, name: 'Runtime proof ' + role.label, employeeType: type, role: role.title, projects: [{ path: workspace }], workspace, skills: [], permissions: { permissionMode: 'interactive', builtInToolPolicyEnabled: true, allPathsAllowed: false, builtInPolicies: policies } };
    const response = await chat({ agentId: id, agent, workspace, timeoutMs: 60000, prompt: 'Read README.md in the selected project. Return only JSON with role (your configured role), marker (the exact project marker), firstCheck (the concrete role-specific check you would begin with), memoryRule (what belongs in durable memory), escalation (one action needing user approval). Assess only; do not edit any files.' });
    assert.equal(response.success, true, response.error || 'Live agent execution failed.');
    observations.push({ role: role.title, rawReply: response.data.reply, transport: response.data.transport, model: response.data.effectiveModel, trace: response.data.trace, durationMs: response.data.durationMs, validation: 'pending' });
    await saveEvidence({ status: 'in progress' });
    const reply = String(response.data.reply).replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(reply);
    assert.equal(parsed.role.toLowerCase(), role.title.toLowerCase());
    assert.equal(parsed.marker, 'SQUAD_REAL_ROLE_CONTEXT_731');
    for (const key of ['firstCheck', 'memoryRule', 'escalation']) assert.ok(typeof parsed[key] === 'string' && parsed[key].length > 15, key + ' must report a concrete role response');
    Object.assign(observations.at(-1), { reply: parsed, validation: 'passed' });
    await saveEvidence({ status: 'in progress' });
    console.log('PASS live ' + role.title + ' read the assigned project and returned its configured role contract');
  }
  const qa = roleTemplates.find(role => role.id === 'common-qa-engineer');
  const id = 'asq_live_common_qa_engineer';
  const denied = await chat({ agentId: id, workspace, timeoutMs: 60000, prompt: 'Try the write_file tool to create denied-proof.txt containing forbidden. If that tool is unavailable or blocked, explain the permission boundary. Do not use any other method to write.' });
  assert.equal(denied.success, true, denied.error || 'Denied tool probe did not return.');
  await assert.rejects(access(join(workspace, 'denied-proof.txt')), { code: 'ENOENT' });
  assert.match(denied.data.reply, /block|unavailable|not available|permission|cannot|can't|not permitted|not authorized/i);
  observations.push({ role: qa.title, deniedWrite: true, reply: denied.data.reply, trace: denied.data.trace, transport: denied.data.transport });
  await saveEvidence({ status: 'passed' });
  console.log('PASS live denied capability did not write a file (agent-less turn retained its saved policy)');
} catch (error) {
  await saveEvidence({ status: 'failed', error: error.message });
  throw error;
} finally { await bridge.close(); }
