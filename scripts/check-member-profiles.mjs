import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { roleTemplates } from '../src/data.js';
import { builtInPoliciesForRank } from '../src/lib/permission-policy.js';
import { startBridge, until } from './lib/reliability-browser.mjs';

const bridge = await startBridge({ prepare: async directory => {
  const skillsDir = join(directory, 'skill-repo');
  const skills = [...new Set(roleTemplates.flatMap(role => role.skills))].map(id => ({ id, name: id, directory: id, files: ['SKILL.md'] }));
  for (const skill of skills) {
    await mkdir(join(skillsDir, skill.id), { recursive: true });
    await writeFile(join(skillsDir, skill.id, 'SKILL.md'), `---\nname: ${skill.id}\ndescription: Controlled profile regression skill.\n---\nOnly use in this disposable test.\n`);
  }
  await writeFile(join(skillsDir, 'registry.json'), JSON.stringify({ skills }));
  const preload = join(directory, 'skill-fixture.mjs');
  await writeFile(preload, `const original = globalThis.fetch; globalThis.fetch = (url, options) => String(url) === 'https://skilled.autohand.ai/skills-index.json' ? Promise.resolve(new Response(${JSON.stringify(JSON.stringify({ skills }))}, { headers: { 'content-type':'application/json' } })) : original(url, options);`);
  const entry = join(directory, 'profile-sdk.mjs');
  await writeFile(join(directory, 'fixture-codex'), `#!${process.execPath}
const args=process.argv.slice(2);
if(args[0]==='--version'){console.log('codex 1.0.0');process.exit(0);}
if(args[0]==='login'){console.log('Logged in using fixture');process.exit(0);}
console.log(JSON.stringify({type:'thread.started',thread_id:'profile-fixture'}));
console.log(JSON.stringify({type:'item.completed',item:{id:'reply',type:'agent_message',text:'Saved Codex profile received.\\nSQUAD_ACTION: {"type":"create_channel","name":"external-profile-channel","members":[],"purpose":""}'}}));
console.log(JSON.stringify({type:'turn.completed'}));
`, { mode: 0o700 });
  await writeFile(entry, `
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
export class AutohandSDK {
 constructor(options) { this.options = options; }
 async start() {
  const home = this.options.envVars.AUTOHAND_HOME;
  const profile = JSON.parse(readFileSync(join(home, 'profile.json'), 'utf8'));
  const config = JSON.parse(readFileSync(join(home, 'config.json'), 'utf8'));
  appendFileSync(${JSON.stringify(join(directory, 'runtime.jsonl'))}, JSON.stringify({ id: profile.id, role: profile.role, system: this.options.appendSystemPrompt || '', permissions: config.permissions, installed: profile.skillInstall.installed, profileFiles: profile.profileDocs.files, args: this.options.extraArgs }) + '\\n');
 }
 async *streamPrompt() { yield { type:'message_end', content:'Controlled SDK received its runtime configuration.' }; }
 async interrupt() {}
 async close() {}
}
`);
  return { AUTOHAND_SKILLS_REPO_DIR: skillsDir, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import=${preload}`.trim(), AUTOHAND_AGENT_SDK_ENTRY: entry, AUTOHAND_AGENT_SDK_DIR: directory };
} });
const workspace = process.cwd();
const profilePath = id => join(bridge.directory, 'app', 'agents', id, 'profile.json');
const profile = async id => JSON.parse(await readFile(profilePath(id), 'utf8'));
const recordings = async () => (await readFile(join(bridge.directory, 'runtime.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
const permissions = { permissionMode: 'restricted', builtInToolPolicyEnabled: true, builtInPolicies: { ...builtInPoliciesForRank(2), write_file: 'block' } };
const member = (role, id) => ({ id, name: 'Profile check ' + role.label, employeeType: role.id, role: role.title, instructions: role.starter, projects: [{ path: workspace }], skills: role.skills, permissions });
const failures = [];
let count = 0;
async function check(label, run) {
  try { await run(); count++; console.log('PASS ' + label); }
  catch (error) { failures.push({ label, error: error.message }); console.error('FAIL ' + label + ': ' + error.message); }
}
try {
  await check('agent-less warming preserves custom personality, brain card, installed skills and permissions', async () => {
    const id = 'asq_custom_profile';
    const custom = { ...member(roleTemplates[0], id), skills: [], role: 'Custom reviewer', instructions: 'Report observed facts only.', brainCard: { purpose: 'CUSTOM_PERSISTED_PURPOSE' }, profileFiles: [{ section: 'persona', fileName: 'PERSONA.md', originalFileName: 'PERSONA.md', content: '# Custom personality\nCUSTOM_PERSONA_PRESERVED', source: 'upload' }] };
    assert.equal((await bridge.api('/api/agents/provision', 'POST', { agentId: id, agent: custom, workspace })).success, true);
    const before = await profile(id);
    const personaPath = before.profileDocs.files.find(f => f.section === 'persona').path;
    const personaBefore = await readFile(personaPath, 'utf8');
    assert.equal((await bridge.api('/api/chat/warm', 'POST', { agentId: id, workspace })).success, true);
    await until(async () => (await recordings()).some(row => row.id === id), 'custom warm runtime');
    const after = await profile(id);
    assert.equal(after.role, before.role, 'warming may not replace the member role with a generic profile');
    assert.deepEqual(after.brainCard, before.brainCard);
    assert.deepEqual(after.skills, before.skills);
    assert.deepEqual(after.permissions, before.permissions);
    assert.equal(await readFile(personaPath, 'utf8'), personaBefore);
  });
  await check('built-in defaults reach the actual runtime without a browser-supplied system prompt', async () => {
    for (const [index, role] of roleTemplates.entries()) {
      const id = `asq_role_${index}`;
      const response = await bridge.api('/api/chat', 'POST', { agentId: id, agent: member(role, id), workspace, prompt: 'Inspect the role contract without using tools.' });
      assert.equal(response.success, true, JSON.stringify(response));
      const saved = await profile(id);
      assert.equal(saved.brainCard.purpose, role.brainCard.purpose, role.id + ' retains its built-in purpose');
      const recording = (await recordings()).find(row => row.id === id);
      assert.ok(recording.system.includes(role.title), role.id + ' role reaches SDK system context');
      assert.ok(recording.system.includes(role.brainCard.reviewStyle), role.id + ' review rules reach SDK system context');
      assert.ok(recording.system.includes(role.profileFiles[0].content), role.id + ' personality reaches SDK system context');
      assert.deepEqual(saved.skillInstall.installed.map(s => s.id).sort(), [...role.skills].sort());
      assert.ok(recording.permissions.excludedTools.some(tool => tool.kind === 'write_file'), 'denied capability reaches the runtime config');
    }
  });
  await check('custom profile is preserved across agent-less execution and restart', async () => {
    const id = 'asq_custom_profile';
    await bridge.restart();
    const result = await bridge.api('/api/chat', 'POST', { agentId: id, workspace, prompt: 'Use your saved operating instructions.' });
    assert.equal(result.success, true, JSON.stringify(result));
    assert.equal((await profile(id)).role, 'Custom reviewer');
    const recording = (await recordings()).filter(row => row.id === id).at(-1);
    assert.ok(recording.system.includes('CUSTOM_PERSONA_PRESERVED'));
    assert.ok(recording.system.includes('CUSTOM_PERSISTED_PURPOSE'));
  });
  await check('deselected skills leave active discovery while retained files can be restored', async () => {
    const id = 'asq_skill_revoke';
    const agent = member(roleTemplates[0], id);
    const provision = await bridge.api('/api/agents/provision', 'POST', { agentId: id, agent, workspace });
    assert.equal(provision.success, true);
    const skill = provision.data.skillInstall.installed[0];
    await writeFile(skill.path, '# Keep this authored skill file\nCUSTOM_SKILL_BYTES\n');
    const disabled = await bridge.api('/api/agents/provision', 'POST', { agentId: id, agent: { ...agent, skills: [] }, workspace });
    assert.equal(disabled.success, true);
    await assert.rejects(access(skill.path), { code: 'ENOENT' });
    const restored = await bridge.api('/api/agents/provision', 'POST', { agentId: id, agent, workspace });
    assert.equal(restored.success, true);
    assert.match(await readFile(restored.data.skillInstall.installed.find(item => item.id === skill.id).path, 'utf8'), /CUSTOM_SKILL_BYTES/);
  });
  await check('unavailable skills are reported to the runtime and corrupt profiles are not overwritten', async () => {
    const id = 'asq_missing_skill';
    const response = await bridge.api('/api/chat', 'POST', { agentId: id, agent: { ...member(roleTemplates[0], id), skills: ['squad-missing-profile-fixture'] }, workspace, prompt: 'Check configured skill availability.' });
    assert.equal(response.success, true);
    assert.equal(response.data.skillInstall.failed[0].id, 'squad-missing-profile-fixture');
    assert.match((await recordings()).find(row => row.id === id).system, /Unavailable requested skills: squad-missing-profile-fixture/);
    const intact = await readFile(profilePath(id), 'utf8');
    await writeFile(profilePath(id), '{damaged');
    assert.equal((await bridge.api('/api/chat/warm', 'POST', { agentId: id, workspace })).success, false);
    assert.equal(await readFile(profilePath(id), 'utf8'), '{damaged');
    await writeFile(profilePath(id), intact);
  });
  await check('saved external harness survives agent-less warming and executes its own channel action', async () => {
    const id = 'asq_saved_codex';
    const agent = { ...member(roleTemplates[0], id), skills: [], harness: { id: 'codex', executablePath: join(bridge.directory, 'fixture-codex') }, permissions: { ...permissions, builtInPolicies: { ...permissions.builtInPolicies, squad_create_channel: 'allow' } } };
    assert.equal((await bridge.api('/api/agents/provision', 'POST', { agentId: id, agent, workspace })).success, true);
    const warm = await bridge.api('/api/chat/warm', 'POST', { agentId: id, workspace });
    assert.equal(warm.data.warmed, false, 'external harness warming must not start an Autohand SDK session');
    assert.equal((await profile(id)).harness.id, 'codex');
    const response = await bridge.api('/api/chat', 'POST', { agentId: id, workspace, prompt: 'Inspect the configured profile.', requestId: 'external-profile-action' });
    assert.equal(response.success, true, JSON.stringify(response));
    assert.equal(response.data.transport, 'codex');
    assert.equal(response.data.channelActions[0].status, 'created');
    assert.ok(!(await recordings()).some(row => row.id === id), 'saved Codex member never starts an Autohand SDK');
  });
} finally { await bridge.close(); }
if (failures.length) { console.error(JSON.stringify(failures, null, 2)); process.exitCode = 1; }
else console.log(`${count} member profile checks passed (all ${roleTemplates.length} built-ins; controlled SDK configuration proof, no live provider).`);
