#!/usr/bin/env node
// Uses the real configured provider and managed MCP. All members, messages,
// memories and schedules are confined to a disposable bridge and project.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { startBridge, until } from './lib/reliability-browser.mjs';

const source = process.env.SQUAD_LIVE_CONFIG || process.env.AUTOHAND_USER_CONFIG_PATH || join(process.env.AUTOHAND_HOME || join(homedir(), '.autohand'), 'config.json');
const original = JSON.parse(await readFile(source, 'utf8'));
const engine = process.argv.find(value => value.startsWith('--engine='))?.slice(9) || 'autohand';
assert.ok(['autohand', 'codex', 'claude'].includes(engine), 'Choose autohand, codex or claude.');
const only = process.argv.find(value => value.startsWith('--only='))?.slice(7) || '';
assert.ok(['', 'reminder', 'teaching', 'design'].includes(only));
const artifacts = join(process.cwd(), '.codex-artifacts/natural-workflows');
await mkdir(artifacts, { recursive: true });
const workspace = await mkdtemp(join(artifacts, 'live-project-'));
const observations = [];
const save = async extra => writeFile(join(artifacts, `live-${engine}${only ? '-'+only : ''}.json`), JSON.stringify({ engine, provider: original.provider, source: 'real engine and configured account, no response fixtures; disposable Squad state', observations, ...extra }, null, 2), { mode: 0o600 });
const bridge = await startBridge({ prepare: async directory => {
  const config = Object.fromEntries(['provider', 'auth', 'autohandai', 'openrouter', 'openai', 'ollama', 'llmgateway', 'bedrock', 'deepseek', 'zai', 'nvidia', 'cerebras'].filter(key => original[key] !== undefined).map(key => [key, original[key]]));
  config.mcp = { servers: [] }; config.hooks = {};
  await writeFile(join(directory, 'config.json'), JSON.stringify(config), { mode: 0o600 });
  return { AUTOHAND_AGENT_SDK_ENTRY: '', AUTOHAND_AGENT_SDK_DIR: '' };
} });
let progress;
async function turn(member, prompt) {
  const started = await bridge.api('/api/runs', 'POST', { agentId: member.id, agent: member, workspace, prompt, ephemeralSession: true, resumeSession: false });
  assert.equal(started.success, true, JSON.stringify(started));
  const run = await until(async () => {
    const current = (await bridge.api(`/api/runs/${started.data.id}`)).data;
    return current?.finishedAt && current;
  }, `live ${engine} turn`, 240000);
  observations.push({ runId: run.id, transport: run.transport, model: run.effectiveModel, status: run.status, reply: run.reply, actions: run.channelActions,
    toolNames: run.trace?.toolCalls?.map(item => item.name || item.toolName), toolErrors: run.trace?.toolResults?.filter(item => item.isError || item.error).map(item => ({ error: item.error, content: String(item.content || '').slice(0,1000) })) });
  await save({ status: 'in progress' });
  assert.equal(run.status, 'completed', run.reply || JSON.stringify(run.logs?.slice(-3)));
  return run;
}
try {
  const member = (id, name, role) => ({ id, name, role, workspace, projects: [{ path: workspace }], harness: { id: engine }, permissions: {}, skills: [] });
  const eva = member('live-natural-eva', 'Eva', 'QA Engineer');
  for (const agent of [eva, member('live-natural-noah', 'Noah', 'Developer'), member('live-natural-iris', 'Iris', 'Release Manager')]) {
    assert.equal((await bridge.api(`/api/members/${agent.id}/channel-access`, 'PUT', { agent, profile: '' })).success, true);
  }
  progress = setInterval(() => console.log(`Live ${engine}: ${observations.filter(item => item.runId).length} request turns completed; waiting for actual provider/tool results.`), 30000);
  if (!only || only === 'reminder') {
  await turn(eva, 'Create yourself a reminder to say hi to me every 2 minutes in this conversation.');
  const routines = (await bridge.api(`/api/routines?memberId=${eva.id}`)).data.routines;
  assert.equal(routines.length, 1, 'Natural reminder request must save exactly one Automation.');
  assert.equal(routines[0].enabled, true);
  assert.equal(routines[0].schedule.everyMinutes, 2);
  assert.ok(routines[0].nextAt);
  observations.push({ automation: { id: routines[0].id, schedule: routines[0].schedule, enabled: true, nextAt: routines[0].nextAt } });
  // Pause the recurring fixture before starting the next proof, then fire
  // one occurrence through the same executor; never leave test jobs running.
  assert.equal((await bridge.api(`/api/routines/${routines[0].id}`, 'PUT', { enabled: false })).success, true);
  assert.equal((await bridge.api(`/api/routines/${routines[0].id}/run`, 'POST', {})).success, true);
  const delivered = await until(async () => {
    const routine = (await bridge.api(`/api/routines/${routines[0].id}`)).data;
    return routine.lastRun?.status === 'completed' && routine.lastRun.reply && routine;
  }, 'actual live reminder answer persisted', 240000);
  observations.push({ delivered: delivered.lastRun.reply });
  await save({ status: 'in progress' });
  console.log('PASS live natural reminder created immediately and delivered actual output.');
  }

  if (!only || only === 'teaching') {
  await turn(eva, 'Teach the others on this team this lesson: Release smoke checks must verify the installed app before we claim it shipped. Save the lesson as shared team knowledge and send it to Noah and Iris.');
  const afterTeaching=(await bridge.api('/api/team')).data;
  observations.push({ teamState: afterTeaching });
  await save({ status: 'in progress' });
  assert.ok(afterTeaching.memory.some(item => /installed app|smoke check/i.test(item.text)), 'The live teaching request must save the shared lesson in this turn.');
  const teaching = await until(async () => {
    const state = (await bridge.api('/api/team')).data;
    const failure=state.deliveries.find(item => item.fromId === eva.id && ['error','interrupted'].includes(item.status));
    if(failure) throw new Error(`Teammate ${failure.toName}: ${failure.error}`);
    const memory = state.memory.find(item => /installed app|smoke check/i.test(item.text));
    const replies = state.deliveries.filter(item => item.fromId === eva.id && ['live-natural-noah', 'live-natural-iris'].includes(item.toId) && item.status === 'completed' && item.reply);
    return memory && new Set(replies.map(item => item.toId)).size === 2 && { memory: memory.text, replies: replies.map(item => ({ toId: item.toId, reply: item.reply })) };
  }, 'actual teammate teaching deliveries', 240000);
  observations.push({ teaching });
  console.log('PASS live teaching saved shared knowledge and received both actual teammate replies.');
  }
  if (!only || only === 'design') {
  const design = await bridge.api('/api/teams/design', 'POST', { workspace, channelName: 'live-mobile-release', objective: 'Build and release a mobile app. Prepare a Release Manager, Mobile Developer, UX Designer and QA Engineer with distinct responsibilities.' }, 110000);
  if(!design.success&&design.runId){const run=(await bridge.api(`/api/runs/${design.runId}`)).data;observations.push({failedDesign:{runId:run?.id,status:run?.status,reply:run?.reply}});}
  assert.equal(design.success, true, JSON.stringify(design));
  const roles = design.data.proposal.members.map(item => item.role).join(', ');
  for (const pattern of [/release/i, /mobile|ios|android/i, /ux|design/i, /qa|quality/i]) assert.match(roles, pattern);
  observations.push({ designer: { runId: design.data.runId, roles: design.data.proposal.members.map(item => item.role), members: design.data.proposal.members.map(item => ({ name: item.name, purpose: item.purpose })) } });
  console.log('PASS live designer selected goal-specific mobile, release, UX and QA specialties.');
  }
  await save({ status: 'passed' });
} catch (error) {
  observations.push({ finalTeamState: (await bridge.api('/api/team').catch(() => null))?.data });
  await save({ status: 'failed', error: error.message });
  console.error(bridge.logs.slice(-2500));
  throw error;
} finally { clearInterval(progress); await bridge.close(); await rm(workspace, { recursive: true, force: true }); }
