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
//   node scripts/check-first-run-live.mjs [--repo=/path/to/repo] [--phone] [--runtime=<dir>]
//   --phone runs every step at a 390px phone viewport instead of the desktop.
//   --runtime runs the packaged runtime folder of a built app (for example
//   "/Applications/Autohand Squad.app/Contents/Resources/runtime") instead of
//   this checkout's dev server: the shipped bridge, built UI and bundled CLI,
//   with isolated state. The run ends with Reset Squad back to first run.
import assert from 'node:assert/strict';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { startBridge, startBrowser, until } from './lib/reliability-browser.mjs';

const source = process.env.SQUAD_LIVE_CONFIG || process.env.AUTOHAND_USER_CONFIG_PATH || join(process.env.AUTOHAND_HOME || join(homedir(), '.autohand'), 'config.json');
const original = JSON.parse(await readFile(source, 'utf8'));
const evidenceDir = resolve('.codex-artifacts', `first-run-live${process.argv.includes('--phone') ? '-phone' : ''}${process.argv.some(argument => argument.startsWith('--runtime=')) ? '-packaged' : ''}${process.argv.includes('--demo') ? '-demo' : ''}`);
await mkdir(evidenceDir, { recursive: true });
const repoArgument = process.argv.find(argument => argument.startsWith('--repo='))?.slice('--repo='.length);
const runtimeDir = process.argv.find(argument => argument.startsWith('--runtime='))?.slice('--runtime='.length) || '';
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
const bridge = await startBridge({ ...(runtimeDir ? { cwd: resolve(runtimeDir), development: false } : {}), prepare: async directory => {
  const config = Object.fromEntries(['provider', 'auth', 'autohandai', 'openrouter', 'openai', 'ollama', 'llmgateway', 'bedrock', 'deepseek', 'zai', 'nvidia', 'cerebras'].filter(key => original[key] !== undefined).map(key => [key, original[key]]));
  config.mcp = { servers: [] }; config.hooks = {};
  config.permissions = { allowList: ['write_file:/tmp/*', 'run_command:rm -rf /tmp/anything'], denyList: [] };
  await writeFile(join(directory, 'config.json'), JSON.stringify(config), { mode: 0o600 });
  return { AUTOHAND_AGENT_SDK_ENTRY: '', AUTOHAND_AGENT_SDK_DIR: '' };
} });
let browser;
const phoneRun = process.argv.includes('--phone');
// --demo: after the first-run path, have the created team build the pie shop
// site (writes approved from the cards), screenshot it at both widths, have
// QA test it, Chief of Staff relay findings with squad_message, two members
// answer a channel mention, check the Permissions config preview against the
// saved file (§1.6), create one member on each other ready engine, and wait
// a real sixteen minutes before the continuation so the idle close is the one
// the person hits. About forty minutes.
const demoRun = process.argv.includes('--demo');
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
// Every message answers permission cards the way a person at the demo would
// (Allow once). Run 10 on the installed runtime stalled in the first review:
// the model chose a shell command for its look around, the card sat
// unanswered, and the engine waited on it for sixteen minutes, which is the
// product doing what Ask rules promise. The walkthrough had only answered
// cards in the steps that expected writes.
async function send(prompt, label, timeout = 600000) {
  return sendAnswering(prompt, label, 'Allow once', timeout);
}
// Like send(), answering every permission card with one choice while the reply runs.
// A message sent while the member is busy is queued by the bridge (ADR-0111):
// the stream answers `queued` with the item and the dispatcher runs it once
// the member is free. The second demo run on the packaged runtime timed out
// here: the Frontend Developer's reply @mentioned the QA Engineer, the window
// started that handoff turn, and the QA prompt sent two seconds later was
// queued behind it, which the wait for a `done` event never saw.
async function queuedReply(memberId, itemId, label, timeout) {
  return until(async () => {
    const queue = (await bridge.api('/api/queues')).data?.queues?.[memberId];
    const item = (queue?.items || []).find(entry => entry.id === itemId);
    if (!item) throw new Error(`${label}: queued item ${itemId} disappeared`);
    if (item.status === 'failed' || item.status === 'cancelled') throw new Error(`${label}: queued item ${item.status}: ${item.error || ''}`);
    return item.status === 'done' ? { result: { reply: item.reply || '', trace: null, queued: true, durationMs: item.result?.durationMs }, queued: item } : false;
  }, `${label} (queued)`, timeout);
}
// Live turns for a member: a reply running from any window, a handoff a
// teammate's reply started, a queued follow-up being dispatched.
async function memberWorking(memberId) {
  const runs = (await bridge.api('/api/runs')).data || [];
  if (runs.some(run => run.agentId === memberId && ['queued', 'running', 'launching'].includes(run.status))) return true;
  const queue = (await bridge.api('/api/queues')).data?.queues?.[memberId];
  return (queue?.items || []).some(item => ['queued', 'running'].includes(item.status));
}
// What a person does when the member shows "Working": wait for it to finish
// before typing, so the prompt is answered now rather than queued.
async function awaitIdle(memberId, label, timeout = 900000) {
  const started = Date.now();
  let noted = false;
  await until(async () => {
    const working = await memberWorking(memberId);
    if (working && !noted) { noted = true; log(`waiting: ${label}: the member is busy with another turn (a handoff or a queued follow-up)`); }
    return !working;
  }, `${label}: member idle`, timeout);
  if (noted) log(`${label}: the member is idle after ${Math.round((Date.now() - started) / 1000)} s`);
}
// The member whose chat the page shows, from its URL.
const currentMemberId = () => browser.evaluate("new URLSearchParams(location.search).get('member') || ''");
const QUESTION_ANSWER = 'Apple pie first; it is the shop\'s best seller.';
const questionsAnswered = [];
async function sendAnswering(prompt, label, choice = 'Allow for this reply', timeout = 900000) {
  const memberId = await currentMemberId();
  if (memberId) await awaitIdle(memberId, label, timeout);
  const before = await submit(prompt, label);
  const ticker = setInterval(() => log(`waiting: ${label}`), 30000);
  const answered = [];
  try {
    return await until(async () => {
      const turn = (await turns())[before];
      if (turn?.error || turn?.captureError) throw new Error(JSON.stringify(turn.error || turn.captureError));
      if (turn?.result) return { ...turn, answered };
      if (turn?.queued?.item?.id) {
        clearInterval(ticker);
        log(`${label}: the message was queued behind the member's current turn; waiting for the queue`);
        return { ...turn, ...(await queuedReply(memberId || turn.request?.agentId, turn.queued.item.id, label, timeout)), answered };
      }
      const pending = await browser.evaluate(`[...document.querySelectorAll('[data-testid="permission-request"]')].map(e => e.dataset.requestId)`);
      for (const requestId of pending) {
        if (answered.includes(requestId)) continue;
        await browser.evaluate(`(() => { const row = document.querySelector('[data-request-id="${requestId}"]'); const button = row && [...row.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(choice)}); if (button) button.click(); })()`);
        answered.push(requestId);
      }
      // A question card (squad_ask): take its first option, or type an answer.
      const questions = await browser.evaluate(`[...document.querySelectorAll('[data-testid="question-request"]')].map(e => e.dataset.requestId)`);
      for (const requestId of questions) {
        if (answered.includes(requestId)) continue;
        const option = await browser.evaluate(`(() => { const row = document.querySelector('[data-request-id="${requestId}"]'); const button = row && [...row.querySelectorAll('button[type="button"]')].find(b => b.textContent.trim()); if (!button) return ''; const label = button.textContent.trim(); button.click(); return label; })()`);
        if (!option) await browser.evaluate(`(() => { const row = document.querySelector('[data-request-id="${requestId}"]'); const input = row && row.querySelector('textarea'); if (!input) return; const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(input, ${JSON.stringify(QUESTION_ANSWER)}); input.dispatchEvent(new Event('input', { bubbles: true })); row.querySelector('form').requestSubmit(); })()`);
        answered.push(requestId);
        questionsAnswered.push({ requestId, answer: option || QUESTION_ANSWER });
        log(`${label}: answered the member's question with ${JSON.stringify(option || QUESTION_ANSWER)}`);
      }
      return false;
    }, label, timeout);
  } finally { clearInterval(ticker); }
}
async function openChat(memberId) {
  await browser.navigate(bridge.origin + '/conversations/new?member=' + encodeURIComponent(memberId));
  await until(() => browser.evaluate(`!!document.querySelector('main textarea') && !document.getElementById('boot')`), 'member conversation', 30000);
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
              if (kind === 'queued') record.queued = JSON.parse(data);
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
  await browser.fill('#first-run-repository', repo); await browser.click('Add folder');
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

  // 2b. A question back to the person (§2.1): the member asks with
  // squad_ask, the card is answered from the chat, and the reply continues
  // with the answer.
  const questionsBefore = questionsAnswered.length;
  // The prompt asks for a plain statement after the answer: the CLI ends a
  // reply whose text announces steps without executing them ("2 tool-free
  // recoveries"), and "continue with my answer" invited exactly that.
  const askedBack = await sendAnswering('Ask me one question with squad_ask: which pie should the shop feature first? Offer two options. When you have my answer, reply with a single sentence that states my choice and nothing else; do not plan or start any other work.', 'question back to me', 'Allow once');
  assert.ok(questionsAnswered.length > questionsBefore, `the member asked a question through the card: ${JSON.stringify(askedBack.sdk.filter(event => /question/.test(String(event.type))).slice(0, 4))}`);
  const chosen = questionsAnswered[questionsAnswered.length - 1].answer;
  assert.ok(new RegExp(chosen.split(/\s+/)[0], 'i').test(askedBack.result.reply), `the reply carries the answer "${chosen}": ${askedBack.result.reply.slice(0, 300)}`);
  observations.push({ step: 'question', answer: chosen, replyPreview: askedBack.result.reply.slice(0, 300) });
  await shot('02b-question');
  await save({ status: 'in progress' });
  log('PASS a question to the person was answered from the chat');

  // 3. A team, through the team builder, from the chat.
  const proposalTurn = await send('Propose a team of three Squad members to build the pie shop website in this repository: a Frontend Developer, a Web Designer and a QA Engineer, each with one sentence on what they own. Use squad_propose_team now, then stop; I will confirm it in Squad.', 'team proposal');
  const proposal = (proposalTurn.result.channelActions || []).find(action => action.type === 'team');
  assert.equal(proposal?.status, 'proposed', `squad_propose_team produced a proposal: ${JSON.stringify(proposalTurn.result.channelActions)}\n${proposalTurn.result.reply}`);
  assert.ok(proposal.proposal.members.length >= 2 && proposal.proposal.members.length <= 8);
  assert.ok(proposal.proposal.members.every(member => !/^(role|name|member)$/i.test(member.role) && member.role.length > 2), `member roles came through as written: ${proposal.proposal.members.map(member => member.role).join(', ')}`);
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
  if (demoRun) {
    // The idle close the person hits: the warm session's TTL is fifteen minutes.
    log('idling sixteen minutes so the warm session closes on its own');
    // Run 4 on the installed runtime came back from this idle to a page that
    // no longer answered Runtime.evaluate: a trivial evaluation every half
    // minute keeps the headless page and its DevTools session awake, and a
    // page that stops answering is reported here rather than at the next step.
    const idleEnd = Date.now() + 16 * 60_000;
    while (Date.now() < idleEnd) {
      await new Promise(resolve => setTimeout(resolve, Math.min(30_000, idleEnd - Date.now())));
      try { await browser.evaluate('document.title'); } catch (error) { log(`during the idle the page stopped answering: ${error.message}`); throw error; }
    }
    // The pool closes a session after fifteen idle minutes on a once-a-minute
    // sweep, measured from the last release, which came a little after the
    // reply above; run 7 asserted at exactly sixteen minutes and found it one
    // sweep away. The continuation waits for the close rather than a clock.
    await until(async () => (await bridge.api('/api/sessions')).data.sessions.filter(session => session.agentId === id).length === 0, 'the idle session closed by the pool', 4 * 60_000);
    log('the warm session closed on its own; continuing the conversation');
  } else {
    await bridge.api('/api/sessions', 'DELETE');
  }
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
  log('PASS first-run path: review, team, approval, restart, teammate');

  if (demoRun) {
    const { createServer } = await import('node:http');
    const { readFile: readFileAsync } = await import('node:fs/promises');
    const frontend = team.find(member => /frontend/i.test(member.role)) || team.find(member => member.id !== id);
    const qa = team.find(member => /qa|test/i.test(member.role)) || team.find(member => member.id !== id && member.id !== frontend.id);

    // D1. The team builds the site; every write is approved from the cards.
    await openChat(frontend.id);
    const built = await sendAnswering('Build the pie shop website in this repository now: a static site with index.html (home with hero and featured pies), menu.html (six pies with prices), hours.html (opening hours and address), order.html (an order form with name, phone, pie, quantity, pickup time and a client-side confirmation), one shared styles.css (warm neighbourhood-bakery look, mobile-first, readable on a 390px phone and a 1440px desktop) and one app.js. Use your file tools only and do not run shell commands; I will approve the writes. When done, list the files you created.', 'site build');
    const files = ['index.html', 'menu.html', 'hours.html', 'order.html', 'styles.css'];
    for (const file of files) await access(join(repo, file));
    observations.push({ step: 'build', files, approvals: built.answered.length, replyPreview: String(built.result.reply || '').slice(0, 300) });
    await save({ status: 'in progress' });
    log(`PASS the Frontend Developer built the site (${built.answered.length} permission cards answered for this reply)`);

    // D2. The site at both widths.
    const server = createServer(async (request, response) => {
      const file = resolve(repo, '.' + (new URL(request.url, 'http://x').pathname === '/' ? '/index.html' : new URL(request.url, 'http://x').pathname));
      if (!file.startsWith(repo + '/')) { response.writeHead(403); response.end(); return; }
      let body;
      try { body = await readFileAsync(file); } catch { response.writeHead(404); response.end(); return; }
      response.writeHead(200, { 'content-type': file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'text/html' });
      response.end(body);
    });
    await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
    const site = `http://127.0.0.1:${server.address().port}`;
    for (const page of ['index', 'menu', 'order']) {
      await browser.navigate(`${site}/${page}.html`);
      await until(() => browser.evaluate(`document.readyState === 'complete' && document.body.innerText.length > 20`), `${page} renders`, 15000);
      await shot(`site-${page}`);
    }
    const siteTitle = await browser.evaluate('document.title');
    server.close();
    observations.push({ step: 'site', title: siteTitle });

    // D3. QA tests it (reads allowed at Edit files; any command is approved from the card).
    await openChat(qa.id);
    const tested = await sendAnswering('Test the pie shop site the Frontend Developer built in this repository (index.html, menu.html, hours.html, order.html, styles.css, app.js): read every file, check every internal link resolves to an existing file, check the CSS handles a 390px phone and a 1440px desktop, and check the order form validation in app.js. Report findings as a short list with severity. Do not edit any file.', 'QA report');
    assert.ok(/high|medium|low|finding|issue/i.test(tested.result.reply), `QA reported findings: ${tested.result.reply.slice(0, 200)}`);
    observations.push({ step: 'qa', replyPreview: tested.result.reply.slice(0, 600), ...toolSummary(tested) });
    await shot('06-qa');
    log('PASS the QA Engineer tested the site');

    // D4. Chief of Staff relays the findings between teammates.
    await openChat(id);
    const relayed = await sendAnswering(`Ask ${qa.name} with squad_message for their top finding on the pie shop site, then send it to ${frontend.name} with squad_message asking them to fix it now and reply when done (use squad_replies if needed). Report what each said.`, 'coordination');
    const relayTools = (relayed.result.trace?.toolCalls || []).map(call => call.name);
    assert.ok(relayTools.some(name => /squad_message/.test(name)), `messages between agents were used: ${relayTools.join(', ')}`);
    observations.push({ step: 'coordination', tools: relayTools, receipts: (relayed.result.channelActions || []).map(action => [action.type, action.status]), replyPreview: relayed.result.reply.slice(0, 500) });
    await shot('07-coordination');
    log('PASS Chief of Staff relayed findings between teammates with squad_message');

    // D5. A channel mention answered by two members.
    const channel = (await bridge.api('/api/channels')).data.channels.find(item => item.memberIds?.includes(frontend.id) && item.memberIds?.includes(qa.id));
    assert.ok(channel, 'the team channel exists');
    await browser.navigate(bridge.origin + '/channels/' + encodeURIComponent(channel.id));
    await until(() => browser.evaluate(`!!document.querySelector('main textarea')`), 'team channel', 30000);
    await browser.fill('main textarea', `@${qa.name} in one sentence, is the order form safe to demo? @${frontend.name} in one sentence, what would you polish first?`);
    await new Promise(resolve => setTimeout(resolve, 400));
    await browser.evaluate(`(() => { const b = [...document.querySelectorAll('main button')].find(x => /send/i.test(x.getAttribute('aria-label') || '')); if (!b) throw new Error('no send button'); b.click(); })()`);
    const replies = await until(async () => {
      const state = (await bridge.api('/api/channels')).data;
      const list = state.messages.filter(message => message.channelId === channel.id && message.role !== 'user' && message.body && !/is typing/.test(message.body) && message.status !== 'error');
      return list.length >= 2 ? list : false;
    }, 'two channel replies', 600000);
    await new Promise(resolve => setTimeout(resolve, 1500));
    await shot('08-channel');
    observations.push({ step: 'channel', channel: channel.name, replies: replies.map(message => ({ from: message.authorName || message.agentId, preview: String(message.body).slice(0, 160) })) });
    log('PASS two members answered a channel mention');

    // D6. §1.6: the config preview shows the saved file and says it matches.
    await browser.navigate(bridge.origin + '/squad-members/' + encodeURIComponent(id) + '/permissions');
    await until(() => browser.evaluate(`!!document.querySelector('[data-testid="permission-config-preview"] summary')`), 'config preview', 30000);
    await browser.evaluate(`document.querySelector('[data-testid="permission-config-preview"] summary').click()`);
    // Run 3 on the installed runtime timed out here at 30 s right after the
    // channel step, while the same step alone passes in eight seconds; the
    // wait is longer and a timeout now says what the preview showed.
    const previewState = () => browser.evaluate(`(document.querySelector('[data-testid="permission-config-preview"]') || {}).textContent || ''`);
    await until(async () => /matches these settings|differs from these settings/.test(await previewState()), 'saved config read from disk', 90000).catch(async error => { throw new Error(`${error.message}; preview showed: ${String(await previewState()).slice(0, 300)}`); });
    const previewText = await browser.evaluate(`document.querySelector('[data-testid="permission-config-preview"]').textContent`);
    assert.ok(previewText.includes('Saved on disk'), 'the saved config.json is shown');
    assert.ok(previewText.includes('mcp__autohand-squad__squad_team'), 'the saved file carries the team tool names');
    await shot('09-config-preview');
    observations.push({ step: 'config-preview', verdict: previewText.includes('matches these settings') ? 'matches' : 'differs' });
    log('PASS the Permissions preview shows the saved config.json');

    // D7. One member on each other ready engine, each answering one message.
    const harnesses = (await bridge.api('/api/harnesses')).data;
    const ready = (harnesses.harnesses || harnesses || []).filter(item => ['codex', 'claude'].includes(item.id) && item.status === 'ready');
    const engines = [];
    for (const engine of ready) {
      const memberId = `asq_engine_${engine.id}`;
      const agent = { id: memberId, name: `${engine.label} Reviewer`, role: 'Reviewer', status: 'online', workspace: repo, projects: [{ path: repo }], harness: { id: engine.id }, permissions: { permissionMode: 'restricted' } };
      await bridge.api(`/api/members/${memberId}/channel-access`, 'PUT', { agent, profile: 'Act as a reviewer. Answer briefly.', profilePatch: {} });
      const started = Date.now();
      const answer = await bridge.api('/api/chat', 'POST', { agentId: memberId, agent, workspace: repo, mode: 'prompt', policy: 'restricted', prompt: 'Reply with one sentence naming which engine you are running on and the name of this repository.' }, 600000).catch(error => ({ success: false, error: error.message }));
      engines.push({ engine: engine.id, version: engine.version, member: memberId, ok: answer.success === true && Boolean(answer.data?.reply), durationMs: Date.now() - started, replyPreview: String(answer.data?.reply || answer.error || '').slice(0, 200) });
      log(`${answer.success ? 'PASS' : 'FAIL'} a ${engine.label} member answered`);
    }
    assert.ok(engines.length >= 1 && engines.every(item => item.ok), `a member on each other ready engine answered: ${JSON.stringify(engines)}`);
    observations.push({ step: 'engines', engines });
    await save({ status: 'in progress' });
  }

  // 7. Reset Squad from Settings (ADR-0161 §3.1): the bridge moves its folders
  // aside and exits; after a restart the app is a clean install at /welcome.
  await browser.navigate(bridge.origin + '/settings/system');
  await until(() => browser.evaluate(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Reset Squad…')`), 'Reset Squad row', 30000);
  await browser.click('Reset Squad…');
  await until(() => browser.evaluate(`!!document.querySelector('[data-testid="system-reset-confirm"]')`), 'reset confirmation', 10000);
  await shot('06-reset-confirm');
  await browser.evaluate(`document.querySelector('[data-testid="system-reset-confirm"]').click()`);
  await until(async () => { try { await bridge.api('/api/runtime'); return false; } catch { return true; } }, 'the bridge exits after reset', 15000);
  await bridge.restart();
  const afterReset = (await bridge.api('/api/setup')).data;
  if (afterReset.status !== 'new') {
    const channels = (await bridge.api('/api/channels')).data || {};
    log(`after reset the bridge still sees: ${channels.channels?.length || 0} channels, members ${Object.keys(channels.agentChannelAccess || {}).join(',') || 'none'}`);
  }
  assert.equal(afterReset.status, 'new', 'after reset the bridge is a clean install');
  await browser.navigate(bridge.origin + '/');
  await until(() => browser.evaluate(`location.pathname === '/welcome' && !!document.querySelector('#first-run-repository')`), 'first run again after reset', 60000);
  await shot('07-after-reset');
  observations.push({ step: 'reset', backups: (await readFile(join(evidenceDir, 'first-run-live.json'), 'utf8')).length > 0 });
  await save({ status: 'passed', runtime: runtimeDir || 'checkout dev server' });
  log('PASS Reset Squad returns the app to first run');
} catch (error) {
  await save({ status: 'failed', error: error.message, logs: bridge.logs.slice(-6000) });
  await browser?.screenshot(join(evidenceDir, 'failure.png')).catch(() => {});
  // The bridge's state dir is removed on close, so what the members were
  // doing when a step timed out (run 8 on the installed runtime: a site build
  // turn still "Working…" after nineteen minutes with thirteen tools and one
  // failed) is saved here: every run with its activity feed and raw log,
  // the queues and the sessions.
  try {
    const runs = (await bridge.api('/api/runs')).data || [];
    const details = [];
    for (const run of runs.slice(0, 12)) {
      const activity = await bridge.api(`/api/runs/${encodeURIComponent(run.id)}/activity`).catch(error => ({ error: error.message }));
      details.push({ run: { ...run, logs: undefined }, activity: activity.data || activity, logs: run.logs });
    }
    const queues = (await bridge.api('/api/queues')).data;
    const sessions = (await bridge.api('/api/sessions')).data;
    await writeFile(join(evidenceDir, 'failure-bridge.json'), JSON.stringify({ at: new Date().toISOString(), runs: details, queues, sessions }, null, 2));
  } catch (dumpError) { log(`could not save the bridge state: ${dumpError.message}`); }
  throw error;
} finally { await browser?.close(); await bridge.close(); }
