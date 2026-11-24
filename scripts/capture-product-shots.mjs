#!/usr/bin/env node
// Product screenshots for the website's Squad page. A throwaway bridge serves
// dist/ with a calm demo squad (no real people, no real paths): members with
// bird avatars, #client-site with a four-member handoff, memories, an Inbox
// with a decision and an unread reply, fallbacks on the harness page. Headless
// Chrome captures each page dark, Full layout, as the desktop shell on macOS.
// Usage: node scripts/capture-product-shots.mjs <outDir>
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startBrowser, until, stop, delay } from './lib/reliability-browser.mjs';
import { seedOwnedBrowserFixture } from './lib/owned-bridge-fixture.mjs';
import { prepareModelRoutingFixture } from './lib/model-routing-fixtures.mjs';
import { ensureDataset } from '../server/ownership/datasets.mjs';
import { ownerKey } from '../server/ownership/identity.mjs';

const out = resolve(process.argv[2] || '.codex-artifacts/product-shots');
const only = process.argv[3] ? process.argv[3].split(',') : null;
await mkdir(out, { recursive: true });

const freePort = async () => { const s = createNetServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; };
const NOW = Date.now();
const at = minutesAgo => new Date(NOW - minutesAgo * 60000).toISOString();
const hhmm = iso => new Date(iso).toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' });

// ---- demo squad ------------------------------------------------------------
const directory = await mkdtemp(join(tmpdir(), 'squad-shots-'));
const home = join(directory, 'home');
const projects = { site: join(home, 'projects', 'client-site'), app: join(home, 'projects', 'squad-app') };
for (const path of Object.values(projects)) await mkdir(path, { recursive: true });
await writeFile(join(projects.site, 'README.md'), '# Client site\n');
await writeFile(join(projects.app, 'README.md'), '# Squad app\n');
const project = (path, name) => ({ id: `project-${name}`, name, label: name, path, kind: 'project' });
const siteProject = project(projects.site, 'client-site');
const appProject = project(projects.app, 'squad-app');

const base = (id, name, role, bird, extra = {}) => ({
  id: `asq_demo_${id}`, name, role, status: 'online', staffId: `demo-${id}`, workspace: projects.site,
  avatar: `/avatars/birds/${bird}.webp`, description: '', projects: [siteProject, appProject],
  memory: [], skills: [], permissions: {}, stats: {}, modelAssignment: { mode: 'inherit' },
  harness: { id: 'autohand', executablePath: '', model: '', effort: '', access: '' },
  conversationStartedAt: at(60 * 24 * 9), ...extra,
});
const memory = (text, minutesAgo, source = 'chat') => ({ id: `mem-${Math.abs(hash(text))}`, text, at: at(minutesAgo), source });
function hash(text) { let h = 0; for (const c of text) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }

const maya = base('maya', 'Maya', 'Chief of Staff', 'kakapo', { workspace: projects.app });
const noah = base('noah', 'Noah', 'Frontend Engineer', 'kea', {
  memory: [
    memory('The client site is plain HTML, CSS and JS; no build step, so keep it that way.', 60 * 26),
    memory('Menu prices come from menu.json; never hard-code them in the page.', 60 * 50),
    memory('Alex prefers small pull requests with a screenshot of the change.', 60 * 24 * 4),
    memory('Run the accessibility check before handing a page to Eva.', 60 * 24 * 6),
    memory('autohand skill installed: web-design-guidelines', 60 * 24 * 8),
    memory('autohand skill installed: frontend-testing', 60 * 24 * 8),
  ],
  modelRouting: { fallbacks: [{ harness: { id: 'codex', model: 'gpt-5.5-codex', effort: '', access: '' } }, { harness: { id: 'claude', model: 'sonnet', effort: '', access: '' } }] },
});
const eva = base('eva', 'Eva', 'QA Engineer', 'kiwi');
const iris = base('iris', 'Iris', 'Code Reviewer', 'tui');
const kai = base('kai', 'Kai', 'DevOps Engineer', 'fantail');
const lena = base('lena', 'Lena', 'Product Designer', 'kereru');
const sam = base('sam', 'Sam', 'Technical Writer', 'pukeko', { workspace: projects.app });
const ari = base('ari', 'Ari', 'Security Engineer', 'ruru', { status: 'paused', paused: true });
const members = [maya, noah, eva, iris, kai, lena, sam, ari];

// Direct messages: the latest line is what the Squad directory shows.
const dm = (agent, pairs) => pairs.flatMap(([question, answer, minutesAgo], index) => [
  { id: `${agent.staffId}-u${index}`, role: 'user', body: question, status: 'complete', startedAt: at(minutesAgo + 1), createdAt: at(minutesAgo + 1) },
  { id: `${agent.staffId}-a${index}`, role: 'agent', body: answer, status: 'complete', startedAt: at(minutesAgo + 1), createdAt: at(minutesAgo), completedAt: at(minutesAgo), durationMs: 24000 },
]);
const messages = {
  [maya.id]: dm(maya, [['What is on for the client this week?', 'Spring menu page goes live Thursday. Noah has the build, Eva and Iris are lined up behind him, and Kai has a preview slot booked.', 7]]),
  [noah.id]: dm(noah, [['Can the menu filter remember the last choice?', 'Yes. It keeps the choice in the address, so a shared link opens on the same filter.', 60 * 3]]),
  [eva.id]: dm(eva, [['Anything flaky in the checkout tests?', 'One: the order modal test waited on an animation. Fixed it to wait for focus instead; 40 runs, all green.', 60 * 20]]),
  [iris.id]: dm(iris, [['Is the review queue clear?', 'Clear apart from the menu page, which I take after Eva.', 60 * 26]]),
  [kai.id]: dm(kai, [['Is the preview server still up?', 'Up on port 4174, serving the latest build.', 60 * 5]]),
  [lena.id]: dm(lena, [['Can you mock the seasonal banner?', 'Three options in the canvas; the second keeps the photo and reads best on a phone.', 60 * 28]]),
  [sam.id]: dm(sam, [['Draft the release notes for 2.4', 'Drafted in docs/release-notes.md: three fixes, one new setting, nothing breaking.', 60 * 30]]),
  [ari.id]: dm(ari, [['Review the dependency report', 'Two low-risk updates, no known vulnerabilities. Pausing until the next audit.', 60 * 24 * 3]]),
};

// #client-site: one request, four handoffs in its thread.
const CHANNEL = 'client-site';
const threadId = 'thread_demo_spring_menu';
const rootId = `${threadId}-root`;
const rootAt = at(95);
const reply = (agent, minutesAgo, body) => ({ id: `${threadId}-${agent.id}`, channelId: CHANNEL, channelName: CHANNEL, role: 'agent', agentId: agent.id, body, status: 'complete', time: hhmm(at(minutesAgo)), threadId, parentMessageId: rootId, startedAt: at(minutesAgo + 2), createdAt: at(minutesAgo), updatedAt: at(minutesAgo), completedAt: at(minutesAgo), workspace: projects.site });
const earlierRoot = 'thread_demo_kickoff-root';
const channelMessages = [
  { id: earlierRoot, channelId: CHANNEL, role: 'user', body: 'Kick-off notes for the spring refresh are in the canvas. Noah leads the build; ask Lena for anything visual.', time: hhmm(at(60 * 26)), threadId: 'thread_demo_kickoff', parentMessageId: '', targetMemberIds: [maya.id], targetLabel: '@Maya', createdAt: at(60 * 26), updatedAt: at(60 * 26) },
  { id: 'thread_demo_kickoff-maya', channelId: CHANNEL, channelName: CHANNEL, role: 'agent', agentId: maya.id, body: 'Got it. I set the plan: build Tuesday, QA and review Wednesday, preview Thursday morning. I will post here as each step lands.', status: 'complete', time: hhmm(at(60 * 26 - 3)), threadId: 'thread_demo_kickoff', parentMessageId: earlierRoot, createdAt: at(60 * 26 - 3), updatedAt: at(60 * 26 - 3), completedAt: at(60 * 26 - 3) },
  { id: rootId, channelId: CHANNEL, role: 'user', body: 'Build the spring menu page for the client site and get it ready to preview.', time: hhmm(rootAt), threadId, parentMessageId: '', targetMemberIds: [noah.id, eva.id, iris.id, kai.id], targetLabel: '@Noah, @Eva, @Iris, @Kai', createdAt: rootAt, updatedAt: rootAt },
  reply(noah, 80, 'Built the spring menu page: menu.html, a seasonal section in styles.css, and a filter for vegetarian and gluten-free dishes. Prices load from menu.json. Handing to Eva for QA.'),
  reply(eva, 66, 'QA done. The page loads its assets, every filter shows the right dishes, the order button opens the modal and Escape closes it. Checked at phone and desktop widths. Over to Iris.'),
  reply(iris, 52, 'Reviewed the change. Headings are in order, the filter buttons say which one is pressed, and focus returns to the menu when the modal closes. One small fix made: alt text on the hero photo. Ready to serve.'),
  reply(kai, 41, 'Serving the build on http://127.0.0.1:4174 from ~/projects/client-site. Preview link shared with Alex; nothing else is using the port.'),
];
const channelsState = {
  version: 1, revision: 1, updatedAt: at(40),
  channels: [
    { id: 'general', name: 'general', visibility: 'public', memberIds: members.map(m => m.id), section: '', createdAt: at(60 * 24 * 30), updatedAt: at(60 * 3) },
    { id: CHANNEL, name: CHANNEL, visibility: 'public', memberIds: [maya.id, noah.id, eva.id, iris.id, kai.id, lena.id], projects: [{ path: projects.site }], section: '', createdAt: at(60 * 24 * 12), updatedAt: at(40) },
    { id: 'release', name: 'release', visibility: 'private', memberIds: [maya.id, kai.id, sam.id, iris.id], projects: [{ path: projects.app }], section: '', createdAt: at(60 * 24 * 20), updatedAt: at(60 * 4) },
    { id: 'design', name: 'design', visibility: 'public', memberIds: [lena.id, noah.id, maya.id], section: '', createdAt: at(60 * 24 * 15), updatedAt: at(60 * 28) },
    { id: 'docs', name: 'docs', visibility: 'public', memberIds: [sam.id, maya.id], section: '', createdAt: at(60 * 24 * 15), updatedAt: at(60 * 30) },
  ],
  threads: [
    { id: 'thread_demo_kickoff', channelId: CHANNEL, parentMessageId: earlierRoot, title: 'Kick-off notes', creatorId: 'user', memberIds: [maya.id], targetLabel: '@Maya', autoMode: false, selfJudge: false, createdAt: at(60 * 26), updatedAt: at(60 * 26 - 3) },
    { id: threadId, channelId: CHANNEL, parentMessageId: rootId, title: 'Build the spring menu page for the client site and get it ready to preview.', creatorId: 'user', memberIds: [noah.id, eva.id, iris.id, kai.id], targetLabel: '@Noah, @Eva, @Iris, @Kai', autoMode: false, selfJudge: false, createdAt: rootAt, updatedAt: at(41) },
  ],
  messages: channelMessages,
};

// Inbox: a handoff to decide, a release approval, one unread reply, one stopped task.
const tasks = [{
  id: 'task_demo_handoff', title: 'Pricing page copy for the 2.4 release', agentId: sam.id, currentOwnerId: iris.id, originAgentId: sam.id, project: 'squad-app', status: 'handoff-pending', source: 'local-chat',
  createdAt: at(70), updatedAt: at(16), summary: 'Sam finished the copy and asks for a review before it goes to the release branch.',
  assignments: [
    { id: 'assign_demo_1', agentId: sam.id, sourceAgentId: sam.id, status: 'completed', reason: 'Write the copy.', requiredContext: '', expectedOutput: '', sourceEvidence: '', createdAt: at(70), updatedAt: at(20), attempt: 1 },
    { id: 'assign_demo_2', agentId: iris.id, sourceAgentId: sam.id, status: 'pending', reason: 'Review the copy.', requiredContext: '', expectedOutput: '', sourceEvidence: '', createdAt: at(16), updatedAt: at(16), attempt: 1, handoffId: 'handoff_demo_1' },
  ],
  handoffs: [{ id: 'handoff_demo_1', fromAgentId: sam.id, toAgentId: iris.id, status: 'pending', reason: 'Sam finished the copy and asks for a review before it goes to the release branch.', requiredContext: 'The draft and the style guide.', expectedOutput: 'A go, or corrections.', sourceEvidence: '', createdAt: at(16), updatedAt: at(16), checkpointId: 'checkpoint_demo_1', attempt: 1 }],
  timeline: [{ id: 'timeline_demo_1', type: 'handoff.created', at: at(16), actorAgentId: sam.id, targetAgentId: iris.id, summary: 'Sam handed the review to Iris.' }],
}, {
  id: 'task_demo_blocked', title: 'Deploy the preview to staging', agentId: kai.id, currentOwnerId: kai.id, originAgentId: kai.id, project: 'client-site', status: 'blocked', source: 'local-chat',
  createdAt: at(200), updatedAt: at(110), summary: 'The staging deploy token is not set on this machine yet.', assignments: [], handoffs: [], timeline: [],
}];
const running = (agent, title, minutesAgo, project = 'client-site') => ({ id: `task_demo_${agent.staffId}`, title, agentId: agent.id, currentOwnerId: agent.id, originAgentId: agent.id, project, status: 'running', source: 'local-chat', createdAt: at(minutesAgo + 30), updatedAt: at(minutesAgo), summary: '', assignments: [], handoffs: [], timeline: [] });
tasks.push(
  running(maya, 'Weekly client update for Thursday', 6, 'squad-app'),
  running(noah, 'Seasonal banner on the home page', 12),
  running(eva, 'Checkout regression pass at phone widths', 25),
  running(lena, 'Banner options for the spring refresh', 48),
  running(sam, 'Release notes for 2.4', 34, 'squad-app'),
);
const workflows = { version: 1, channels: { release: [{
  id: 'wf_demo_release', name: 'Release checklist', enabled: true, dispatch: 'app', trigger: { type: 'manual' }, createdAt: at(900), updatedAt: at(900),
  steps: [{ id: 'step_demo_1', kind: 'member', memberId: kai.id, prompt: 'Tag 2.4 and publish the release notes', approval: true }],
  runs: [{ id: 'wfrun_demo_1', workflowId: 'wf_demo_release', channelId: 'release', startedAt: at(22), status: 'waiting_approval', stepIndex: 0, stepResults: [], pendingApproval: { id: 'approval_step_demo_1', stepId: 'step_demo_1', by: 'user', emoji: '✅', requestedAt: at(22), messageId: '' }, trigger: { type: 'manual' } }],
}] } };
const allRead = at(-5);
const reads = Object.fromEntries(members.filter(m => m.id !== maya.id).map(m => [m.id, allRead]));

// ---- bridge (isolated, with a demo identity) --------------------------------
const identity = createServer((request, response) => {
  if (!/^Bearer fixture/i.test(String(request.headers.authorization || ''))) { response.writeHead(401); response.end('{"success":false}'); return; }
  const data = request.url === '/v1/profile' ? { success: true, profile: { id: 'demo-owner', email: 'alex@example.com', name: 'Alex Rivera' } } : request.url === '/v1/accounts' ? { success: true, accounts: [] } : null;
  response.writeHead(data ? 200 : 404, { 'content-type': 'application/json' }); response.end(JSON.stringify(data || { success: false }));
});
await new Promise(r => identity.listen(0, '127.0.0.1', r));
const issuer = `http://127.0.0.1:${identity.address().port}`;
const serviceRoot = join(directory, 'squad'), appRoot = join(directory, 'app');
await mkdir(serviceRoot, { recursive: true }); await mkdir(appRoot, { recursive: true });
await writeFile(join(serviceRoot, 'channels.json'), JSON.stringify(channelsState));
await writeFile(join(serviceRoot, 'channel-workflows.json'), JSON.stringify(workflows));
const paths = await ensureDataset(serviceRoot, ownerKey({ kind: 'user', issuer, id: 'demo-owner' }));
for (const name of (await readdir(serviceRoot)).filter(n => !n.startsWith('ownership-') && n !== 'owners')) await rename(join(serviceRoot, name), join(paths.dataRoot, name));
const config = join(directory, 'config.json');
await writeFile(config, JSON.stringify({ provider: 'autohandai', auth: { token: 'fixture-demo', email: 'alex@example.com', expiresAt: '2099-01-01T00:00:00Z' } }));
const prepared = await prepareModelRoutingFixture(directory);
const port = await freePort();
const origin = `http://127.0.0.1:${port}`;
let logs = '';
const child = spawn(process.execPath, ['server.mjs', '--host', '127.0.0.1', '--port', String(port)], {
  cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, ...prepared, HOME: home, AUTOHAND_SQUAD_NATIVE_NOTIFICATIONS: 'macos', AUTOHAND_SQUAD_IDENTITY_ORIGIN: issuer, AUTOHAND_HOME: join(directory, 'autohand'), AUTOHAND_SQUAD_HOME: serviceRoot, AUTOHAND_SQUAD_APP_STATE_DIR: appRoot, AUTOHAND_USER_CONFIG_PATH: config },
});
child.stdout.on('data', d => { logs += d; }); child.stderr.on('data', d => { logs += d; });
const api = async (path, method = 'GET', body) => {
  const context = path.startsWith('/api/ownership/context') ? null : await fetch(origin + '/api/ownership/context').then(r => r.json());
  const response = await fetch(origin + path, { method, headers: { 'content-type': 'application/json', ...(context?.data?.generation ? { 'x-squad-context': context.data.generation } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, ...await response.json() };
};
const bridge = { origin, api };

let browser;
try {
  await until(async () => (await api('/api/ownership/context')).data?.state === 'ready', 'bridge ownership ready', 60000);
  await until(async () => (await api('/api/runtime')).success, 'bridge runtime', 60000);
  browser = await startBrowser();
  await seedOwnedBrowserFixture(bridge, browser, {
    members, messages,
    storage: {
      'autohandSquad.v1.tasks': JSON.stringify(tasks),
      'autohandSquad.v1.agentReads': JSON.stringify(reads),
      'autohandSquad.v1.channelReads': JSON.stringify({ general: allRead, [CHANNEL]: allRead, release: allRead, design: allRead, docs: allRead }),
      'autohandSquad.v1.sidebarCollapsed': 'false',
    },
  });
  // Device preferences (unscoped) and the desktop shell on macOS, so the app
  // leaves the traffic-light space it leaves in the real window.
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    try { localStorage.setItem('autohandSquad.v1.theme', JSON.stringify({ mode: 'dark', lightTheme: 'autohand-light', darkTheme: 'autohand-dark' })); localStorage.setItem('autohandSquad.v1.layout', 'full'); localStorage.setItem('autohandSquad.v1.avatarStyle', 'flat'); } catch {}
    if (localStorage.getItem('shots.web') !== '1') { const shell = () => { document.documentElement.dataset.shell = 'desktop'; document.documentElement.dataset.platform = 'mac'; }; if (document.documentElement) shell(); document.addEventListener('DOMContentLoaded', shell, { once: true }); }
  ` });

  const text = () => browser.evaluate("(document.querySelector('main') || document.body).innerText");
  const settle = async () => {
    await delay(900);
    await browser.evaluate("document.activeElement?.blur?.(); document.querySelectorAll('[data-sonner-toast],[role=status]').forEach(el => el.closest('[data-sonner-toaster]')?.remove())");
    // The app writes /Users/<name>/… as ~/…; the demo home lives in a temp
    // folder, so show it the way it reads on a real machine.
    await browser.evaluate(`(() => { const prefixes = ${JSON.stringify([home, '/private' + home])}; const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); for (let node; (node = walker.nextNode());) for (const prefix of prefixes) if (node.nodeValue.includes(prefix)) node.nodeValue = node.nodeValue.split(prefix).join('~'); })()`);
    await delay(300);
  };
  const shoot = async (name, { width = 1440, height = 900, scale = 1 } = {}) => {
    await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
    await settle();
    await browser.screenshot(join(out, `${name}.png`));
    console.log('shot', name);
  };
  const open = async (path, ready, label) => {
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await browser.navigate(origin + path);
    try { await until(ready, label, 25000); }
    catch (error) { await settle(); await browser.screenshot(join(out, `debug-${label.replace(/\W+/g, '-')}.png`)); console.log('NOT READY', label, (await text()).slice(0, 600)); }
  };
  const want = name => !only || only.includes(name);

  if (want('squad-directory')) {
    await open('/squad', async () => (await text()).includes('Technical Writer') && (await text()).includes('Release notes for 2.4'), 'Squad directory');
    await shoot('squad-directory', { scale: 2 });
  }
  if (want('channel-handoffs')) {
    await open(`/channels/${CHANNEL}`, async () => (await text()).includes('Serving the build'), 'channel thread');
    await shoot('channel-handoffs', { scale: 2 });
  }
  if (want('member-memory')) {
    await open(`/squad-members/${noah.id}/memory`, async () => (await text()).includes('menu.json'), 'Noah memory');
    await shoot('member-memory', { scale: 2 });
  }
  if (want('needs-you')) {
    await open('/inbox', async () => { const t = await text(); return t.includes('Release checklist') && t.includes('Pricing page copy') && t.includes('Deploy the preview'); }, 'Inbox');
    await shoot('needs-you', { scale: 2 });
  }
  if (want('member-harness')) {
    await open(`/squad-members/${noah.id}/harness`, () => browser.evaluate("!!document.querySelector('section[aria-label=Fallbacks] [data-fallback-row]')"), 'harness with fallbacks');
    await shoot('member-harness', { scale: 2 });
  }
  if (want('member-permissions')) {
    await open(`/squad-members/${noah.id}/permissions`, async () => (await text()).includes('Permission'), 'Noah permissions');
    await shoot('member-permissions', { scale: 2 });
  }
  if (want('web-squad-directory')) {
    await browser.evaluate("localStorage.setItem('shots.web', '1')");
    await open('/squad', async () => (await text()).includes('Technical Writer') && (await browser.evaluate('!document.documentElement.dataset.shell')), 'web Squad directory');
    await shoot('web-squad-directory', { width: 1280, height: 800, scale: 2.5 });
  }
  if (browser.errors.length) console.log('page errors:', browser.errors);
} catch (error) {
  console.error(logs.slice(-3000));
  throw error;
} finally {
  await browser?.close();
  await stop(child);
  identity.close();
  await rm(directory, { recursive: true, force: true }).catch(() => {});
}
