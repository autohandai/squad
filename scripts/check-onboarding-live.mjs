import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { startBridge, startBrowser, until } from './lib/reliability-browser.mjs';

// Explicit live journey: fresh browser and bridge state, real configured
// account, normal folder/role/start/send/approve controls, no response fixtures.
const source = process.env.SQUAD_LIVE_CONFIG || process.env.AUTOHAND_USER_CONFIG_PATH || join(process.env.AUTOHAND_HOME || join(homedir(), '.autohand'), 'config.json');
const original = JSON.parse(await readFile(source, 'utf8'));
const evidenceDir = join(process.cwd(), '.codex-artifacts', 'reliability');
const markerFile = join(evidenceDir, 'live-profile-project', 'README.md');
await mkdir(join(evidenceDir, 'live-profile-project'), { recursive: true });
await writeFile(markerFile, '# Read-only onboarding proof\n\nMarker: SQUAD_REAL_ROLE_CONTEXT_731\n\nAssess only. Do not edit project files.\n');
const observations = [];
const save = async extra => writeFile(join(evidenceDir, 'live-onboarding.json'), JSON.stringify({ source: 'fresh Chrome, real bridge and configured provider; no API responses replaced', observations, ...extra }, null, 2), { mode: 0o600 });
const bridge = await startBridge({ prepare: async directory => {
  const config = Object.fromEntries(['provider', 'auth', 'autohandai', 'openrouter', 'openai', 'ollama', 'llmgateway', 'bedrock', 'deepseek', 'zai', 'nvidia', 'cerebras'].filter(key => original[key] !== undefined).map(key => [key, original[key]]));
  config.mcp = { servers: [] }; config.hooks = {};
  await writeFile(join(directory, 'config.json'), JSON.stringify(config), { mode: 0o600 });
  return { AUTOHAND_AGENT_SDK_ENTRY: '', AUTOHAND_AGENT_SDK_DIR: '' };
} });
let browser, progress;
try {
  browser = await startBrowser();
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.liveTurns = [];
    const original = window.fetch.bind(window);
    window.fetch = async (input, options) => {
      const response = await original(input, options);
      const path = new URL(typeof input === 'string' ? input : input.url, location.origin).pathname;
      if (path === '/api/chat/stream') {
        const record = {request: JSON.parse(options.body), events: 0}; window.liveTurns.push(record);
        (async () => {
          const decoder = new TextDecoder(); let pending = '';
          for await (const chunk of response.clone().body) {
            pending += decoder.decode(chunk, {stream: true}).replaceAll('\\r\\n', '\\n'); let end;
            while ((end = pending.indexOf('\\n\\n')) >= 0) {
              const frame = pending.slice(0, end); pending = pending.slice(end + 2);
              const kind = frame.match(/^event: (.+)$/m)?.[1];
              const data = frame.split('\\n').filter(line => line.startsWith('data: ')).map(line => line.slice(6)).join('\\n');
              if (!data) continue; record.events++;
              if (kind === 'done') record.result = JSON.parse(data);
              if (kind === 'error') record.error = JSON.parse(data);
            }
          }
        })().catch(error => { record.captureError = error.message; });
      }
      return response;
    };` });
  await browser.navigate(bridge.origin + '/');
  await until(() => browser.evaluate(`location.pathname === '/welcome' && !!document.querySelector('#first-run-repository')`), 'fresh first-run repositories');
  assert.equal(await browser.evaluate(`JSON.parse(localStorage.getItem('autohandSquad.v1.onboarding') || '{}').status`), 'active');
  const runtime = (await bridge.api('/api/runtime')).data;
  const folder = process.cwd();
  assert.ok(folder && markerFile.startsWith(folder + '/'), 'The offered default workspace must contain the disposable proof project.');
  await browser.fill('#first-run-repository', folder); await browser.click('Add repository');
  await until(() => browser.evaluate(`[...document.querySelectorAll('button')].find(item=>item.textContent==='Start with Chief of Staff')?.disabled===false`), 'real repository profile', 30000);
  await browser.click('Start with Chief of Staff');
  await until(() => browser.evaluate(`location.pathname === '/channels/channel_general'`), 'real coordinator provision', 60000);
  const onboarding = await browser.evaluate(`JSON.parse(localStorage.getItem('autohandSquad.v1.onboarding'))`);
  assert.equal(onboarding.status, 'completed');
  const id = onboarding.memberId;
  const members = await browser.evaluate(`JSON.parse(localStorage.getItem('autohandSquad.v1.agents'))`);
  assert.equal(members.filter(member => member.id === id).length, 1);
  const member = members.find(member => member.id === id);
  const persisted = JSON.parse(await readFile(join(bridge.directory, 'app', 'agents', id, 'profile.json'), 'utf8'));
  assert.equal(persisted.name, member.name);
  observations.push({ setup: onboarding.status, role: member.role, workspace: folder, installedSkills: persisted.skillInstall, initialRosterSize: members.length });
  await save({ status: 'in progress' });
  assert.equal(members.length,1); assert.equal(member.role,'Chief of Staff'); assert.equal(member.harness.id,'autohand');
  console.log('PASS fresh repositories and Start provision one Chief of Staff with no demo team');
  // Exercise the explicit Ask permission, independently of product defaults.
  const permissions={...member.permissions,builtInPolicies:{...member.permissions.builtInPolicies,squad_create_channel:'ask'}};
  await bridge.api('/api/members/'+id+'/channel-access','PUT',{agent:{...member,permissions},profilePatch:{permissions}});
  await browser.navigate(bridge.origin+'/conversations/new?member='+encodeURIComponent(id));
  await until(()=>browser.evaluate(`!!document.querySelector('main textarea')`),'coordinator conversation',30000);
  const purpose = 'Read ' + markerFile + ' and reply with its exact marker and one concrete next step from your configured role. Assess only; do not run shell commands or edit files.';
  const prompt = 'Read ' + markerFile + '. Reply with its exact marker and your configured role. Then propose a shared channel by emitting this exact action on its own line: SQUAD_ACTION: ' + JSON.stringify({ type: 'create_channel', name: 'live-first-channel', members: [], purpose }) + '. Do not create any other channels or edit project files. The human will approve.';
  await browser.fill('main textarea', prompt);
  await browser.click('Send chat message');
  progress = setInterval(() => console.log('Waiting for live onboarding reply or channel purpose'), 30000);
  const turn = await until(async () => {
    const turns = await browser.evaluate(`window.liveTurns`);
    if (turns.some(turn => turn.error || turn.captureError)) throw new Error(JSON.stringify(turns.map(turn => turn.error || turn.captureError).filter(Boolean)));
    return turns.find(turn => turn.result);
  }, 'first real reply', 480000);
  assert.equal(turn.request.agentId, id);
  assert.match(turn.result.reply, /SQUAD_REAL_ROLE_CONTEXT_731/);
  const receipt = turn.result.channelActions?.find(action => action.action?.name === 'live-first-channel');
  assert.equal(receipt?.status, 'proposed', 'Explicit Ask permission must require approval.');
  observations.push({ firstSession: { transport: turn.result.transport, model: turn.result.effectiveModel, reply: turn.result.reply, durationMs: turn.result.durationMs, trace: turn.result.trace }, proposal: receipt });
  await save({ status: 'in progress' });
  await until(() => browser.evaluate(`document.querySelector('section[aria-label="Channel proposals"]')?.textContent.includes('live-first-channel')`), 'first channel proposal');
  await browser.click('Approve channel');
  const delivered = await until(async () => {
    const state = (await bridge.api('/api/channels')).data;
    const action = state.agentChannelActions.find(action => action.id === receipt.id);
    if (action?.deliveries?.some(delivery => ['error', 'interrupted'].includes(delivery.status))) throw new Error(JSON.stringify(action.deliveries));
    return action?.status === 'created' && action.deliveries?.length === 1 && action.deliveries.every(delivery => delivery.status === 'completed') ? { state, action } : false;
  }, 'first real channel purpose reply', 480000);
  clearInterval(progress); progress = null;
  const reply = delivered.state.messages.find(message => message.channelId === delivered.action.channelId && message.role === 'agent');
  assert.ok(reply && /SQUAD_REAL_ROLE_CONTEXT_731/.test(reply.body), 'The actual purpose recipient must read the assigned proof file.');
  observations.push({ approved: delivered.action, purposeReply: reply });
  await browser.navigate(bridge.origin + '/channels/' + delivered.action.channelId);
  await until(() => browser.evaluate(`document.querySelector('main h1')?.textContent.includes('live-first-channel') && document.querySelector('main')?.textContent.includes('SQUAD_REAL_ROLE_CONTEXT_731')`), 'rendered first channel reply');
  assert.equal(await browser.evaluate(`document.querySelector('main article .font-semibold')?.textContent`), member.name, 'The purpose must show the teammate who opened the channel.');
  await browser.screenshot(join(evidenceDir, 'live-onboarding-channel.png'));
  await bridge.restart();
  await browser.navigate(bridge.origin + '/channels/' + delivered.action.channelId);
  await until(() => browser.evaluate(`document.querySelector('main h1')?.textContent.includes('live-first-channel') && document.querySelector('main')?.textContent.includes('SQUAD_REAL_ROLE_CONTEXT_731')`), 'reopened real first channel');
  assert.deepEqual(browser.errors, []);
  await save({ status: 'passed', reopenedAfterRestart: true });
  console.log('PASS first real session proposes a channel; normal approval delivers its purpose through the provider and reopens after restart');
} catch (error) {
  await save({ status: 'failed', error: error.message });
  await browser?.screenshot(join(evidenceDir, 'live-onboarding-failure.png')).catch(() => {});
  throw error;
} finally { if (progress) clearInterval(progress); await browser?.close(); await bridge.close(); }
