import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { startBridge, startBrowser, until } from './lib/reliability-browser.mjs';
import { initialAgents, initialChannels } from '../src/data.js';

const packaged = process.argv.find(argument => argument.startsWith('--runtime='))?.slice('--runtime='.length);
const evidence = resolve(packaged ? '.codex-artifacts/fresh-install-staged' : '.codex-artifacts/fresh-install');
await mkdir(evidence, { recursive: true });
const fixtures = await mkdtemp(join(evidence, 'repositories-'));
async function repo(name, files) {
  const path = join(fixtures, name); await mkdir(path);
  execFileSync(process.platform === 'darwin' ? '/usr/bin/git' : 'git', ['init', '-q', path]);
  for (const [name, content] of Object.entries(files)) await writeFile(join(path, name), content);
  return path;
}
const web = await repo('web', { 'package.json': JSON.stringify({ dependencies: { react: '1', vite: '1' } }), 'index.html': '<main>Hello</main>' });
const mobile = await repo('mobile', { 'Package.swift': '// swift-tools-version:6.0\n', 'Screen.swift': 'import SwiftUI\n' });
const service = await repo('service', { 'go.mod': 'module example.test/service\n', 'main.go': 'package main\n' });
const plain = join(fixtures, 'not-a-repo'); await mkdir(plain);
await mkdir(join(web, 'src'));

assert.deepEqual(initialAgents, [], 'no demo roster is shipped');
assert.deepEqual(initialChannels, [], 'no demo channels are shipped');
let bridge, browser, second;
const saved = key => browser.evaluate(`(() => { const raw=localStorage.getItem('autohandSquad.v1.' + ${JSON.stringify(key)}); try { return JSON.parse(raw || 'null'); } catch { return raw; } })()`);
const state = async () => (await bridge.api('/api/channels')).data;
const startDisabled = () => browser.evaluate(`[...document.querySelectorAll('button')].find(item=>item.textContent==='Start with Chief of Staff')?.disabled`);
const add = async path => { await until(() => browser.evaluate(`!!document.querySelector('#first-run-repository')`), 'repository input'); await browser.fill('#first-run-repository', path); await browser.click('Add repository'); };
const ready = () => until(async () => await startDisabled() === false, 'repository analysis and runtime readiness', 60000);
const reload = async () => {
  await browser.evaluate('window.oldSetupDocument=true');
  await browser.send('Page.reload');
  await until(() => browser.evaluate(`!window.oldSetupDocument && !!document.querySelector('[data-testid="first-run"]')`), 'new setup document', 30000);
};
try {
  bridge = await startBridge({ ...(packaged ? { cwd:resolve(packaged), development:false } : {}), prepare: async () => ({ GIT_CEILING_DIRECTORIES: fixtures, ...(process.platform === 'darwin' ? { PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin' } : {}) }) });
  assert.equal((await bridge.api('/api/setup')).data.status, 'new');
  assert.equal((await bridge.api('/api/setup/repositories', 'POST', { paths: [] })).status, 400);
  assert.equal((await bridge.api('/api/setup/repositories', 'POST', { paths: [plain] })).status, 400);
  const single = (await bridge.api('/api/setup/repositories', 'POST', { paths: [web, join(web, 'src')] })).data;
  assert.equal(single.repositories.length, 1, 'subfolders of one repo are deduplicated');
  assert.ok(single.recommendations.some(item => item.template.id === 'frontend-developer'));
  const native = (await bridge.api('/api/setup/repositories', 'POST', { paths: [mobile] })).data;
  assert.equal(native.recommendations[0].template.id, 'mobile-developer', 'different project changes the recommendation');
  const mixed = (await bridge.api('/api/setup/repositories', 'POST', { paths: [web, service, mobile] })).data;
  for (const role of ['frontend-developer', 'backend-engineer', 'mobile-developer']) assert.ok(mixed.recommendations.some(item => item.template.id === role), role);
  assert.equal((await state()).channels.length, 0, 'analysis does not create channels');
  assert.deepEqual((await state()).agentChannelAccess, {}, 'analysis does not create members');
  console.log('PASS actual repository analysis: single, multiple, canonical roots, differing stacks, invalid selection, no implicit creation');

  browser = await startBrowser();
  await browser.navigate(bridge.origin + '/');
  await until(() => browser.evaluate(`!!document.querySelector('#first-run-repository')`), 'clean first run', 30000);
  assert.deepEqual(await saved('agents'), []);
  assert.deepEqual(await saved('channels'), []);
  assert.equal(await startDisabled(), true);
  assert.equal(await browser.evaluate(`document.body.textContent.includes('Skip for now')`), false);
  const theme = await saved('theme');
  assert.equal(theme.mode, 'system');
  assert.equal(await saved('skin'), 'default');
  await browser.navigate(bridge.origin + '/squad');
  await until(() => browser.evaluate(`location.pathname==='/welcome'`), 'cannot bypass repository setup');
  await add(web); await ready();
  await add(mobile); await ready();
  await reload(); await ready();
  assert.equal((await saved('onboarding')).selectedRepositories.length, 2, 'multiple choices survive reload');
  await add(plain);
  await until(() => browser.evaluate(`document.body.textContent.includes('is not a Git repository')`), 'invalid repository feedback');
  assert.equal(await startDisabled(), true);
  await browser.click('Remove ' + plain); await ready();
  await browser.screenshot(join(evidence, 'repository-suggestions.png'));
  await browser.send('Emulation.setDeviceMetricsOverride', { width:390, height:844, deviceScaleFactor:1, mobile:true });
  assert.equal(await browser.evaluate(`document.documentElement.scrollWidth <= 391`),true,'setup fits a narrow screen');
  await browser.screenshot(join(evidence,'repositories-mobile.png'));
  await browser.send('Emulation.setDeviceMetricsOverride', { width:1440, height:1100, deviceScaleFactor:1, mobile:false });
  await browser.send('Emulation.setEmulatedMedia', { features:[{name:'prefers-color-scheme',value:'light'}] });
  await until(()=>browser.evaluate(`!document.documentElement.classList.contains('dark')`),'setup follows system appearance');
  await browser.screenshot(join(evidence,'repositories-light.png'));

  // Real provisioning failure: invalid provider config blocks readiness and
  // preserves the setup identity before any published team is visible.
  const configFile = join(bridge.directory, 'config.json');
  const validConfig = await readFile(configFile, 'utf8');
  await writeFile(configFile, '{broken');
  const failed = await bridge.api('/api/setup/complete', 'POST', { paths: [web, mobile] });
  assert.notEqual(failed.status, 200);
  await writeFile(configFile, validConfig);
  await bridge.restart();
  await reload(); await ready();

  // A lost HTTP response is recoverable without an extra coordinator.
  await browser.evaluate(`(() => {
    const original=window.fetch.bind(window); let fail=true;
    window.fetch=async(input,options)=>{
      if (fail && String(input).endsWith('/api/setup/complete')) { fail=false; throw new Error('Temporary connection failure. Retry setup.'); }
      return original(input,options);
    };
  })()`);
  await browser.click('Start with Chief of Staff');
  await until(() => browser.evaluate(`document.body.textContent.includes('nothing was lost')`), 'completion failure stays recoverable');
  assert.equal((await saved('onboarding')).status, 'active');
  await browser.click('Start with Chief of Staff');
  const receipts = await Promise.all([bridge.api('/api/setup/complete', 'POST', { paths: [web, mobile] }), bridge.api('/api/setup/complete', 'POST', { paths: [web, mobile] })]);
  assert.ok(receipts.every(result => result.status === 200), JSON.stringify(receipts.map(result => ({status:result.status,error:result.error}))));
  assert.equal(receipts[0].data.memberId, receipts[1].data.memberId, 'concurrent finish requests share identity');
  await until(() => browser.evaluate(`location.pathname==='/channels/channel_general'`), 'rendered default channel', 60000);
  const completed = (await bridge.api('/api/setup')).data;
  let snapshot = await state();
  assert.equal(snapshot.channels.length, 1);
  assert.equal(snapshot.channels[0].name, 'general');
  assert.deepEqual(snapshot.channels[0].memberIds, [completed.memberId]);
  assert.equal(snapshot.channels[0].projects.length, 2);
  assert.equal(Object.keys(snapshot.agentChannelAccess).length, 1);
  assert.equal(completed.member.name, 'Chief of Staff');
  assert.equal(completed.member.role, 'Chief of Staff');
  assert.equal(completed.member.harness.id, 'autohand');
  assert.equal(completed.member.projects.length, 2);
  assert.deepEqual(completed.member.memory, []);
  assert.equal(snapshot.messages.length, 0);
  assert.equal(snapshot.threads.length, 0);
  await browser.screenshot(join(evidence, 'chief-and-general.png'));
  console.log('PASS browser: required repositories, reload, invalid selection, neutral defaults, failed delivery, concurrent completion, one provisioned Chief and one channel');

  // A new window with no local storage must hydrate the bridge-owned roster,
  // not synthesize any build-time defaults or re-run setup.
  second = await startBrowser(); await bridge.restart();
  await second.navigate(bridge.origin + '/');
  await until(() => second.evaluate(`JSON.parse(localStorage.getItem('autohandSquad.v1.agents') || '[]').length===1 && location.pathname==='/squad'`), 'restore into new browser', 30000);
  assert.equal((await bridge.api('/api/setup/complete', 'POST', { paths: [] })).data.memberId, completed.memberId, 'receipt retry is independent of stale client inputs');
  await second.close(); second=null;

  await browser.navigate(bridge.origin + '/welcome');
  await until(() => browser.evaluate(`document.body.textContent.includes('Review Frontend Developer')`), 'post-setup recommendations', 30000);
  await browser.click('Review Frontend Developer');
  await until(() => browser.evaluate(`!!document.querySelector('#member-name')`), 'explicit specialist review');
  assert.ok(await browser.evaluate(`document.querySelector('#member-description')?.value?.length > 0 || document.querySelector('main').textContent.includes('Frontend Developer')`));
  assert.equal(Object.keys((await state()).agentChannelAccess).length, 1, 'review does not create a specialist');
  await browser.fill('#member-name', 'Frontend teammate');
  const createLabel = await browser.evaluate(`[...document.querySelectorAll('main button')].find(item => !item.disabled && item.textContent.trim()==='Save member')?.textContent.trim()`);
  assert.ok(createLabel, 'explicit create control');
  await browser.click(createLabel);
  await until(async () => Object.keys((await state()).agentChannelAccess).length === 2, 'explicit specialist is created', 120000);
  await until(() => browser.evaluate(`location.pathname.includes('/members/') && location.search.includes('tab=chat') || location.pathname.includes('/conversations')`), 'created specialist conversation', 20000);
  snapshot = await state();
  assert.equal(snapshot.channels.length, 1, 'explicit teammate creation does not add a channel');
  assert.ok(Object.values(snapshot.agentChannelAccess).some(access => access.agent.name === 'Frontend teammate'));
  await browser.navigate(bridge.origin + '/welcome');
  assert.equal(Object.keys((await state()).agentChannelAccess).length, 2);
  assert.deepEqual(browser.errors, [], 'no browser exceptions');
  console.log('PASS explicit specialist review and creation; restart and empty-browser recovery preserve the team');
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ status: 'passed', runtime:packaged ? resolve(packaged) : 'development source', memberId: completed.memberId, repositories: completed.repositories.map(item=>item.name), starterMembers: 1, starterChannels: 1, explicitMembers: 2, liveProvider: false }, null, 2));
} catch (error) {
  if (second) console.error('Second-window state:', JSON.stringify(await second.evaluate(`({path:location.pathname,agents:localStorage.getItem('autohandSquad.v1.agents'),setup:localStorage.getItem('autohandSquad.v1.onboarding'),text:document.body.textContent.slice(-1200)})`).catch(()=>null)), second.errors);
  await browser?.screenshot(join(evidence, 'failure.png')).catch(()=>{});
  console.error(bridge?.logs.split('\n').slice(-14).join('\n'));
  throw error;
} finally {
  await second?.close(); await browser?.close(); await bridge?.close(); await rm(fixtures, { recursive: true, force: true });
}
