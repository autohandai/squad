#!/usr/bin/env node
// The first-run path a demo shows, live (ADR-0161): a fresh bridge and
// browser, the real configured account and the bundled Autohand CLI, no
// response fixtures. Start with Chief of Staff on a small repository, ask the
// suggested first question, have it propose a team through squad_propose_team
// and create that team from the card, approve a file write from the
// permission card, lose the engine session and continue the conversation,
// then have it message a teammate. Evidence (JSON and screenshots at desktop
// and phone widths) lands in .codex-artifacts/first-run-live/.
//
//   node scripts/check-first-run-live.mjs [--repo=/path/to/repo] [--phone]
//   --phone runs every step at a 390px phone viewport instead of the desktop.
import assert from 'node:assert/strict';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { startBridge, startBrowser, until } from './lib/reliability-browser.mjs';

const source = process.env.SQUAD_LIVE_CONFIG || process.env.AUTOHAND_USER_CONFIG_PATH || join(process.env.AUTOHAND_HOME || join(homedir(), '.autohand'), 'config.json');
const original = JSON.parse(await readFile(source, 'utf8'));
const evidenceDir = resolve('.codex-artifacts', process.argv.includes('--phone') ? 'first-run-live-phone' : 'first-run-live');
await mkdir(evidenceDir, { recursive: true });
const repoArgument = process.argv.find(argument => argument.startsWith('--repo='))?.slice('--repo='.length);
const repo = repoArgument ? resolve(repoArgument) : await (async () => {
  const path = join(evidenceDir, 'pie-shop');
  await rm(path, { recursive: true, force: true });
  await mkdir(path, { recursive: true });
  await writeFile(join(path, 'README.md'), '# Pie Shop\n\nA small website for a neighbourhood pie shop: menu, opening hours, order form.\n');
  execFileSync('git', ['init', '-q', path]);
  execFileSync('git', ['-C', path, '-c', 'user.name=Squad', '-c', 'user.email=squad@example.test', 'add', '-A']);
  execFileSync('git', ['-C', path, '-c', 'user.name=Squad', '-c', 'user.email=squad@example.test', 'commit', '-qm', 'Start the pie shop site']);
  return path;
})();
const observations = [];
const save = async extra => writeFile(join(evidenceDir, 'first-run-live.json'), JSON.stringify({ source: 'fresh Chrome, isolated bridge, real account and bundled CLI; no API responses replaced', repo, observations, ...extra }, null, 2), { mode: 0o600 });
const log = message => console.log(`${new Date().toISOString().slice(11, 19)} ${message}`);

// The bridge sees only the account/provider part of the person's config, plus
// a permissions block that must NOT reach the member (ADR-0161 §1.1).
const bridge = await startBridge({ prepare: async directory => {
  const config = Object.fromEntries(['provider', 'auth', 'autohandai', 'openrouter', 'openai', 'ollama', 'llmgateway', 'bedrock', 'deepseek', 'zai', 'nvidia', 'cerebras'].filter(key => original[key] !== undefined).map(key => [key, original[key]]));
  config.mcp = { servers: [] }; config.hooks = {};
  config.permissions = { allowList: ['write_file:/tmp/*', 'run_command:rm -rf /tmp/anything'], denyList: [] };
  await writeFile(join(directory, 'config.json'), JSON.stringify(config), { mode: 0o600 });
  return { AUTOHAND_AGENT_SDK_ENTRY: '', AUTOHAND_AGENT_SDK_DIR: '' };
} });
let browser;
const phoneRun = process.argv.includes('--phone');
const desktop = phoneRun ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true } : { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false };
const phone = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
async function shot(name) {
  await browser.send('Emulation.setDeviceMetricsOverride', desktop);
  await browser.screenshot(join(evidenceDir, `${name}-desktop.png`));
  await browser.send('Emulation.setDeviceMetricsOverride', phone);
  await new Promise(resolve => setTimeout(resolve, 400));
  await browser.screenshot(join(evidenceDir, `${name}-phone.png`));
  await browser.send('Emulation.setDeviceMetricsOverride', desktop);
}
const turns = () => browser.evaluate('window.liveTurns');
// The composer ignores a click that lands before its draft state settled; a
// request that has not started within ten seconds is sent again.
async function submit(prompt, label) {
  const before = (await turns()).length;
  await browser.fill('main textarea', prompt);
  await new Promise(resolve => setTimeout(resolve, 400));
  await browser.click('Send chat message');
  await until(async () => (await turns()).length > before, `${label} request started`, 10000).catch(async () => { await browser.click('Send chat message'); });
  await until(async () => (await turns()).length > before, `${label} request started (retry)`, 10000);
  return before;
}
const toolSummary = turn => ({ tools: (turn.result?.trace?.toolCalls || []).map(call => call.name), failed: (turn.result?.trace?.toolResults || []).filter(result => /error|failed|denied/i.test(String(result.content || '').slice(0, 200))).map(result => `${result.name}: ${String(result.content || '').slice(0, 160)}`) });
async function send(prompt, label, timeout = 600000) {
  const before = await submit(prompt, label);
  const ticker = setInterval(() => log(`waiting: ${label}`), 30000);
  try {
    return await until(async () => {
      const list = await turns();
      const turn = list[before];
      if (turn?.error || turn?.captureError) throw new Error(JSON.stringify(turn.error || turn.captureError));
      return turn?.result ? turn : false;
    }, label, timeout);
  } finally { clearInterval(ticker); }
}
const members = async () => Object.entries((await bridge.api('/api/channels')).data.agentChannelAccess || {}).filter(([, record]) => record?.agent && !record.removed).map(([id, record]) => ({ id, name: record.agent.name, role: record.agent.role }));

try {
  browser = await startBrowser();
  await browser.send('Network.enable');
  await browser.send('Emulation.setDeviceMetricsOverride', desktop);
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.liveTurns = [];
    const original = window.fetch.bind(window);
    window.fetch = async (input, options) => {
      const response = await original(input, options);
      const path = new URL(typeof input === 'string' ? input : input.url, location.origin).pathname;
      if (path === '/api/chat/stream') {
        const record = {request: JSON.parse(options.body), events: 0, sdk: []}; window.liveTurns.push(record);
        (async () => {
          const decoder = new TextDecoder(); let pending = '';
          for await (const chunk of response.clone().body) {
            pending += decoder.decode(chunk, {stream: true}).replaceAll('\\r\\n', '\\n'); let end;
            while ((end = pending.indexOf('\\n\\n')) >= 0) {
              const frame = pending.slice(0, end); pending = pending.slice(end + 2);
              const kind = frame.match(/^event: (.+)$/m)?.[1];
              const data = frame.split('\\n').filter(line => line.startsWith('data: ')).map(line => line.slice(6)).join('\\n');
              if (!data) continue; record.events++;
              if (kind === 'sdk') { const e = JSON.parse(data); record.sdk.push({type: e.type, status: e.status, label: e.label, requestId: e.requestId, tool: e.tool || e.tool?.name, decision: e.decision, source: e.source}); }
              if (kind === 'done') record.result = JSON.parse(data);
              if (kind === 'error') record.error = JSON.parse(data);
            }
          }
        })().catch(error => { record.captureError = error.message; });
      }
      return response;
    };` });

  // 1. First run: the repository, Start with Chief of Staff.
  await browser.navigate(bridge.origin + '/');
  await until(() => browser.evaluate(`location.pathname === '/welcome' && !!document.querySelector('#first-run-repository')`), 'fresh first-run page', 30000);
  await browser.fill('#first-run-repository', repo); await browser.click('Add repository');
  await until(() => browser.evaluate(`[...document.querySelectorAll('button')].find(item=>item.textContent==='Start with Chief of Staff')?.disabled===false`), 'repository profile and runtime readiness', 60000);
  await shot('01-first-run');
  await browser.click('Start with Chief of Staff');
  await until(() => browser.evaluate(`location.pathname === '/channels/channel_general'`), 'coordinator provisioned', 120000);
  const onboarding = await browser.evaluate(`JSON.parse(localStorage.getItem('autohandSquad.v1.onboarding'))`);
  const id = onboarding.memberId;
  const roster = await members();
  assert.equal(roster.length, 1, 'one Chief of Staff and nothing else');
  const memberConfig = JSON.parse(await readFile(join(bridge.directory, 'app', 'agents', id, 'config.json'), 'utf8'));
  // §1.1 a new member does not inherit the person's approvals.
  assert.deepEqual(memberConfig.permissions.allowList || [], [], 'the member config carries none of the person\'s allowList grants');
  // §1.2 the team tools are reachable with Built-in tool rules on.
  const kinds = (memberConfig.permissions.availableTools || []).map(entry => entry.kind);
  assert.ok(kinds.includes('mcp__autohand-squad__squad_team'), 'squad_team is in availableTools');
  assert.ok(kinds.includes('mcp__autohand-squad__squad_propose_team'), 'squad_propose_team is in availableTools');
  assert.ok((memberConfig.permissions.excludedTools || []).some(entry => entry.kind === 'ask_followup_question'), 'the follow-up question is excluded');
  // The CLI's keyword-triggered specialist roster held a reply for 29 minutes; Squad's team replaces it.
  assert.equal(memberConfig.features?.automaticSpecialists, false, 'the engine\'s automatic specialists are off for a member');
  observations.push({ step: 'first-run', member: roster[0], availableTools: kinds.length, excludedTools: (memberConfig.permissions.excludedTools || []).map(entry => entry.kind) });
  await save({ status: 'in progress' });
  log('PASS first run provisions one Chief of Staff with reachable team tools and no inherited approvals');

  // 2. The suggested first question.
  await browser.navigate(bridge.origin + '/conversations/new?member=' + encodeURIComponent(id));
  await until(() => browser.evaluate(`!!document.querySelector('main textarea')`), 'coordinator conversation', 30000);
  const review = await send('As a Chief of Staff, what would you take ownership of in pie-shop? Start with what worries you most.', 'first review');
  assert.ok(review.result.reply.length > 200, 'a real review came back');
  observations.push({ step: 'review', durationMs: review.result.durationMs, model: review.result.effectiveModel, replyPreview: review.result.reply.slice(0, 600), ...toolSummary(review) });
  await shot('02-review');
  await save({ status: 'in progress' });
  log('PASS the first review answered');

  // 3. A team, through the team builder, from the chat.
  const proposalTurn = await send('Propose a team of three Squad members to build the pie shop website in this repository: a Frontend Developer, a Web Designer and a QA Engineer, each with one sentence on what they own. Use squad_propose_team now, then stop; I will confirm it in Squad.', 'team proposal');
  const proposal = (proposalTurn.result.channelActions || []).find(action => action.type === 'team');
  assert.equal(proposal?.status, 'proposed', `squad_propose_team produced a proposal: ${JSON.stringify(proposalTurn.result.channelActions)}\n${proposalTurn.result.reply}`);
  assert.ok(proposal.proposal.members.length >= 2 && proposal.proposal.members.length <= 8);
  await until(() => browser.evaluate(`!!document.querySelector('[data-testid="team-proposal"]')`), 'team proposal card', 15000);
  await shot('03-team-proposal');
  await browser.evaluate(`(() => { const b=[...document.querySelectorAll('[data-testid="team-proposal"] button')].find(x=>x.textContent.startsWith('Create team')); if(!b) throw new Error('no Create team'); b.click(); })()`);
  const team = await until(async () => { const list = await members(); return list.length >= 1 + proposal.proposal.members.length ? list : false; }, 'team members created', 240000);
  observations.push({ step: 'team', proposal: proposal.proposal, members: team, ...toolSummary(proposalTurn) });
  await save({ status: 'in progress' });
  log(`PASS the proposed team was created: ${team.map(member => `${member.name} (${member.role})`).join(', ')}`);

  // 4. A file write approved from the chat card (Interactive mode, write_file asks).
  await browser.navigate(bridge.origin + '/conversations/new?member=' + encodeURIComponent(id));
  await until(() => browser.evaluate(`!!document.querySelector('main textarea')`), 'coordinator conversation again', 30000);
  const before = await submit('Create the file docs/plan.md in this repository with a short build plan for the pie shop website: sections Pages, Stack and First tasks, about 20 lines. Write the file now with your file tool; do not ask me where to put it.', 'write request');
  await until(async () => {
    const turn = (await turns())[before];
    if (turn?.result || turn?.error) throw new Error(`the turn ended before any permission card: ${JSON.stringify(turn.error || toolSummary(turn))} ${String(turn.result?.reply || '').slice(0, 300)}`);
    return browser.evaluate(`!!document.querySelector('[data-testid="permission-request"]')`);
  }, 'permission card for the write', 300000);
  const asked = await browser.evaluate(`document.querySelector('[data-testid="permission-request"]')?.textContent`);
  await shot('04-permission-card');
  await browser.click('Allow once');
  const written = await until(async () => { const turn = (await turns())[before]; if (turn?.error) throw new Error(JSON.stringify(turn.error)); return turn?.result ? turn : false; }, 'approved write finished', 600000);
  await access(join(repo, 'docs', 'plan.md'));
  const resolved = written.sdk.filter(event => event.type === 'permission_resolved');
  assert.ok(resolved.some(event => event.decision === 'allow_once' && event.source === 'person'), `the decision reached the stream: ${JSON.stringify(written.sdk.filter(e => e.type?.startsWith('permission')))}`);
  observations.push({ step: 'approval', asked, resolved, replyPreview: written.result.reply.slice(0, 400) });
  await save({ status: 'in progress' });
  log('PASS a permission request was approved from the chat and the file exists');

  // 5. The engine session is lost; the conversation is not.
  await bridge.api('/api/sessions', 'DELETE');
  const recalled = await send('Without reading any files: what file did you just create for me, and what were its three section headings?', 'continuation after the engine restarted');
  assert.ok(recalled.sdk.some(event => event.status === 'session_replay'), `the restarted session replayed the conversation: ${JSON.stringify(recalled.sdk.slice(0, 6))}`);
  assert.match(recalled.result.reply, /plan\.md/i, `the member kept its place: ${recalled.result.reply.slice(0, 400)}`);
  observations.push({ step: 'replay', replyPreview: recalled.result.reply.slice(0, 400) });
  await save({ status: 'in progress' });
  log('PASS the conversation continued across an engine restart');

  // 6. A message to a teammate, answered inside the turn.
  const teammate = team.find(member => member.id !== id);
  const asked2 = await send(`Ask ${teammate.name} with squad_message which stack they would use for the pie shop site, then report their answer in one paragraph.`, 'teammate message');
  const toolNames = (asked2.result.trace?.toolCalls || []).map(call => call.name);
  assert.ok(toolNames.some(name => /squad_message/.test(name)) || (asked2.result.channelActions || []).some(action => action.type === 'team_message'), `squad_message was used: ${toolNames.join(', ')}`);
  observations.push({ step: 'teammate', teammate, toolNames, replyPreview: asked2.result.reply.slice(0, 500) });
  await shot('05-teammate');
  assert.deepEqual(browser.errors, [], 'no browser exceptions');
  await save({ status: 'passed' });
  log('PASS first-run path: review, team, approval, restart, teammate');
} catch (error) {
  await save({ status: 'failed', error: error.message, logs: bridge.logs.slice(-6000) });
  await browser?.screenshot(join(evidenceDir, 'failure.png')).catch(() => {});
  throw error;
} finally { await browser?.close(); await bridge.close(); }
