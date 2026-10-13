import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { roleTemplates } from '../src/data.js';
import { startBridge, startBrowser, until } from './lib/reliability-browser.mjs';

const failures = [];
const filter = process.argv[process.argv.indexOf('--filter') + 1];
const filtered = process.argv.includes('--filter');
let checksRun = 0;
// Fixture only: exercise real installation and runtime-file generation without
// depending on external skill hosting. No provision response is replaced.
async function prepareSkills(directory) {
  const skillsDir = join(directory, 'skill-repo');
  const skills = [...new Set(roleTemplates.flatMap(template => template.skills))].map(id => ({ id, name: id, directory: id, files: ['SKILL.md'] }));
  for (const skill of skills) {
    await mkdir(join(skillsDir, skill.id), { recursive: true });
    await writeFile(join(skillsDir, skill.id, 'SKILL.md'), `---\nname: ${skill.id}\ndescription: Isolated reliability-test skill fixture.\n---\nUse only inside this disposable test.\n`);
  }
  await writeFile(join(skillsDir, 'registry.json'), JSON.stringify({ skills }));
  const preload = join(directory, 'skill-catalog-fixture.mjs');
  await writeFile(preload, `const original = globalThis.fetch; globalThis.fetch = (url, options) => String(url) === 'https://skilled.autohand.ai/skills-index.json' ? Promise.resolve(new Response(${JSON.stringify(JSON.stringify({ skills }))}, { headers: { 'content-type': 'application/json' } })) : original(url, options);`);
  return { AUTOHAND_SKILLS_REPO_DIR: skillsDir, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import=${preload}`.trim() };
}
async function check(label, run) {
  if (filtered && !label.includes(filter)) return;
  checksRun += 1;
  const bridge = await startBridge({ prepare: prepareSkills });
  let browser;
  try { browser = await startBrowser(); await run(bridge, browser); console.log(`ok ${label}`); }
  catch (error) { failures.push({ label, error: error.message }); console.error(`FAIL ${label}: ${error.message}`); }
  finally { await browser?.close(); await bridge.close(); }
}
async function enter(bridge, browser, workspace = process.cwd(), flags = {}, savedProgress = {}) {
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    if (!localStorage.getItem('reliability.onboarding-seeded')) {
      localStorage.setItem('autohandSquad.v1.onboarding', JSON.stringify({ version: 1, status: 'incomplete', selectedWorkspace: ${JSON.stringify(workspace)}, lastStep: 'teammate', ...${JSON.stringify(savedProgress)} }));
      localStorage.setItem('reliability.onboarding-seeded', 'true');
      sessionStorage.setItem('reliability.failures', JSON.stringify({provision:true, ...${JSON.stringify(flags)}}));
    }
    const original = window.fetch.bind(window);
    window.fetch = async (input, options) => {
      const path = new URL(typeof input === 'string' ? input : input.url, location.origin).pathname;
      const flags = JSON.parse(sessionStorage.getItem('reliability.failures') || '{}');
      if (path === '/api/agents/provision') {
        const requests = JSON.parse(sessionStorage.getItem('reliability.provisions') || '[]');
        requests.push(JSON.parse(options.body)); sessionStorage.setItem('reliability.provisions', JSON.stringify(requests));
        await new Promise(resolve => setTimeout(resolve, 200));
        if (flags.provision) return new Response(JSON.stringify({ success:false, error:'Temporary provisioning failure. Retry setup.' }), {status:503, headers:{'content-type':'application/json'}});
      }
      if (path === '/api/workspaces/profile' && flags.profile) return new Response(JSON.stringify({ success:false, error:'Folder check temporarily unavailable.' }), {status:503, headers:{'content-type':'application/json'}});
      const response = await original(input, options);
      if (path === '/api/runtime' && flags.runtime) {
        const payload = await response.json(); payload.data.available = false;
        return new Response(JSON.stringify(payload), { headers:{'content-type':'application/json'} });
      }
      if (path === '/api/provider-settings' && flags.provider) {
        const payload = await response.json(); for (const provider of Object.values(payload.data.providers)) provider.enabled = false;
        return new Response(JSON.stringify(payload), { headers:{'content-type':'application/json'} });
      }
      return response;
    }` });
  await browser.navigate(bridge.origin + '/welcome');
  await until(() => browser.evaluate(`document.querySelector('main')?.textContent.includes('Meet your first teammate') && !document.body.textContent.includes('Looking at the folder…')`), 'folder profile');
}
async function setFailures(browser, patch) {
  await browser.evaluate(`sessionStorage.setItem('reliability.failures', JSON.stringify({ ...JSON.parse(sessionStorage.getItem('reliability.failures')), ...${JSON.stringify(patch)} }))`);
}
const startDisabled = browser => browser.evaluate(`[...document.querySelectorAll('main button')].find(item => item.innerText.includes('Start the conversation'))?.disabled`);
async function selectRole(browser) {
  await browser.evaluate(`(() => { const best = [...document.querySelectorAll('main button')].find(item => item.innerText.includes('Best fit')); if (!best) throw new Error('No role suggestion'); best.click(); })()`);
  await until(() => browser.evaluate(`!!document.querySelector('#first-run-name')`), 'first teammate');
}
await check('invalid folders cannot complete onboarding', async (bridge, browser) => {
  await enter(bridge, browser, process.cwd() + '/missing-onboarding-folder');
  await selectRole(browser);
  const disabled = await startDisabled(browser);
  assert.equal(disabled, true, 'Start must be blocked after folder validation fails');
});
await check('interrupted setup restores selected role and typed name', async (bridge, browser) => {
  await enter(bridge, browser); await selectRole(browser);
  await browser.fill('#first-run-name', 'Recovery teammate');
  await browser.navigate(bridge.origin + '/welcome');
  await until(() => browser.evaluate(`document.querySelector('#first-run-name')?.value === 'Recovery teammate'`), 'restored teammate selection and name', 2500);
});
await check('provisioning failure keeps onboarding incomplete and makes retry visible', async (bridge, browser) => {
  await enter(bridge, browser); await selectRole(browser);
  await browser.click('Start the conversation');
  await until(() => browser.evaluate(`document.body.textContent.includes('Temporary provisioning failure')`), 'actionable provisioning failure', 2500);
  assert.equal(await browser.evaluate(`location.pathname`), '/welcome');
  const onboarding = await browser.evaluate(`JSON.parse(localStorage.getItem('autohandSquad.v1.onboarding'))`);
  assert.notEqual(onboarding.status, 'completed');
});
await check('folder validation can be retried without losing setup', async (bridge, browser) => {
  await enter(bridge, browser, process.cwd(), { profile: true }); await selectRole(browser);
  assert.equal(await startDisabled(browser), true);
  assert.ok(await browser.evaluate(`document.body.textContent.includes('Folder check temporarily unavailable')`));
  await setFailures(browser, { profile: false }); await browser.click('Retry folder');
  await until(async () => (await startDisabled(browser)) === false, 'folder retry readiness');
  assert.ok(await browser.evaluate(`!!document.querySelector('#first-run-name')?.value`));
});
await check('invalid saved role and member identity recover through role selection', async (bridge, browser) => {
  await enter(bridge, browser, process.cwd(), {}, { selectedRoleId: 'removed-role', memberName: 'Saved custom name', nameTouched: true, memberId: '../invalid-id' });
  await until(() => browser.evaluate(`document.querySelector('main h1')?.textContent.includes('Meet your first teammate')`), 'unavailable saved role recovery', 2500);
  assert.ok(await browser.evaluate(`document.body.textContent.includes('previously selected role is no longer available')`));
  await selectRole(browser);
  assert.equal(await browser.evaluate(`document.querySelector('#first-run-name').value`), 'Saved custom name');
  await browser.click('Start the conversation');
  await until(() => browser.evaluate(`document.body.textContent.includes('Temporary provisioning failure')`), 'safe saved identity replacement');
  const requests = await browser.evaluate(`JSON.parse(sessionStorage.getItem('reliability.provisions'))`);
  assert.match(requests[0].agentId, /^asq_[a-z0-9_-]+$/);
  assert.notEqual(requests[0].agentId, '../invalid-id');
});
for (const [flag, message] of [['runtime', 'local Autohand runtime is not answering'], ['provider', 'No model provider is configured']]) {
  await check(`${flag} readiness blocks start and preserves choices during recovery`, async (bridge, browser) => {
    await enter(bridge, browser, process.cwd(), { [flag]: true }); await selectRole(browser);
    await browser.fill('#first-run-name', 'Prerequisite recovery');
    assert.equal(await startDisabled(browser), true);
    assert.ok(await browser.evaluate(`document.body.textContent.includes(${JSON.stringify(message)})`));
    await setFailures(browser, { [flag]: false }); await browser.navigate(bridge.origin + '/welcome');
    await until(async () => (await startDisabled(browser)) === false, `${flag} recovery`);
    assert.equal(await browser.evaluate(`document.querySelector('#first-run-name').value`), 'Prerequisite recovery');
  });
}
await check('rapid submissions and refresh retry provision exactly one saved member', async (bridge, browser) => {
  await enter(bridge, browser); await selectRole(browser);
  await browser.fill('#first-run-name', 'Confirmed teammate');
  await browser.evaluate(`(() => { const start = [...document.querySelectorAll('main button')].find(item => item.innerText.includes('Start the conversation')); start.click(); start.click(); document.querySelector('#first-run-name').dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true})); })()`);
  await until(() => browser.evaluate(`document.body.textContent.includes('Temporary provisioning failure')`), 'failed first submission');
  const firstRequests = await browser.evaluate(`JSON.parse(sessionStorage.getItem('reliability.provisions'))`);
  assert.equal(firstRequests.length, 1, 'rapid submission guard');
  const savedId = (await browser.evaluate(`JSON.parse(localStorage.getItem('autohandSquad.v1.onboarding'))`)).memberId;
  assert.equal(savedId, firstRequests[0].agentId);
  assert.ok(!(await browser.evaluate(`JSON.parse(localStorage.getItem('autohandSquad.v1.agents'))`)).some(agent => agent.id === savedId), 'failed provision must not publish a phantom member');
  await setFailures(browser, { provision: false }); await browser.navigate(bridge.origin + '/welcome');
  await until(async () => (await startDisabled(browser)) === false, 'restored retry readiness');
  await browser.click('Start the conversation');
  await until(() => browser.evaluate(`location.pathname === '/conversations/new' && new URLSearchParams(location.search).get('member') === ${JSON.stringify(savedId)}`), 'confirmed member conversation', 20000);
  const requests = await browser.evaluate(`JSON.parse(sessionStorage.getItem('reliability.provisions'))`);
  assert.equal(requests.length, 2); assert.equal(requests[1].agentId, savedId);
  assert.equal((await browser.evaluate(`JSON.parse(localStorage.getItem('autohandSquad.v1.onboarding'))`)).status, 'completed');
  const members = await browser.evaluate(`JSON.parse(localStorage.getItem('autohandSquad.v1.agents'))`);
  const created = members.filter(agent => agent.id === savedId);
  assert.equal(created.length, 1); assert.equal(created[0].name, 'Confirmed teammate');
  assert.equal(created[0].skillInstall.status, 'installed');
  const agentHome = join(bridge.directory, 'app', 'agents', savedId);
  assert.equal(JSON.parse(await readFile(join(agentHome, 'profile.json'), 'utf8')).name, 'Confirmed teammate');
  assert.ok((await readFile(join(agentHome, 'AGENTS.md'), 'utf8')).includes('Confirmed teammate'));
  assert.deepEqual((await readdir(join(bridge.directory, 'app', 'agents'))).filter(id => id === savedId), [savedId]);
  assert.ok(await browser.evaluate(`document.querySelector('main textarea')?.value.length > 0`), 'first message is drafted');
  await browser.screenshot('.codex-artifacts/reliability/onboarding-confirmed.png');
  await bridge.restart(); await browser.navigate(bridge.origin + '/');
  await until(() => browser.evaluate(`location.pathname !== '/welcome' && document.body.textContent.includes('Confirmed teammate')`), 'completed setup after bridge restart');
  assert.equal(browser.errors.length, 0, browser.errors.join('\n'));
});
if (!checksRun) throw new Error('No onboarding checks matched the filter.');
if (failures.length) { console.error(JSON.stringify(failures, null, 2)); process.exitCode = 1; }
else console.log('Onboarding recovery checks passed (real bridge/browser, actual provisioning with fixture skill catalog, injected failures; no provider execution).');
