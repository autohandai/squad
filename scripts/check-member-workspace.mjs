import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { initialAgents } from '../src/data.js';
import { startBridge, startBrowser, until } from './lib/reliability-browser.mjs';

await mkdir('.codex-artifacts/reliability', { recursive: true });
const directory = await mkdtemp(join(process.cwd(), '.codex-artifacts/reliability/workspace-'));
const first = join(directory, 'first');
const second = join(directory, 'second');
const picked = join(directory, 'picked');
await Promise.all([first, second, picked].map(path => mkdir(path)));
const member = { ...initialAgents[0], name: 'Workspace member', workspace: first, projects: [{ path: first }, { path: second }], skills: [] };
const bridge = await startBridge();
let browser;
try {
  browser = await startBrowser();
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    if (!sessionStorage.getItem('workspace.seeded')) {
      localStorage.setItem('autohandSquad.v1.agents', ${JSON.stringify(JSON.stringify([member]))});
      localStorage.setItem('autohandSquad.v1.removedAgents', ${JSON.stringify(JSON.stringify(initialAgents.slice(1).map(agent => agent.id)))});
      localStorage.setItem('autohandSquad.v1.onboarding', '{"version":1,"status":"skipped"}');
      sessionStorage.setItem('workspace.seeded','true');
    }
    const original = window.fetch.bind(window);
    window.fetch = async (input, options) => {
      const path = new URL(typeof input === 'string' ? input : input.url, location.origin).pathname;
      if (path === '/api/chat/warm') return new Response('{"success":true,"data":{}}', {headers:{'content-type':'application/json'}});
      if (path === '/api/workspaces/pick') return new Response(JSON.stringify(sessionStorage.getItem('workspace.cancel') ? {success:false,error:'cancelled'} : {success:true,data:{path:${JSON.stringify(picked)}}}), {status:sessionStorage.getItem('workspace.cancel')?409:200,headers:{'content-type':'application/json'}});
      if (path.endsWith('/channel-access') && sessionStorage.getItem('workspace.fail')) return new Response('{"success":false,"error":"Controlled folder save failure"}', {status:503,headers:{'content-type':'application/json'}});
      if (path === '/api/chat/stream') { sessionStorage.setItem('workspace.launch',options.body); return new Response('{"success":false,"error":"Controlled launch receipt; no provider invoked"}', {status:503,headers:{'content-type':'application/json'}}); }
      return original(input,options);
    }` });
  const route = bridge.origin + '/conversations/new?member=' + member.id;
  await browser.navigate(route);
  const open = () => browser.evaluate(`document.querySelector('button[aria-label^="Workspace for Workspace member:"]').click()`);
  const active = () => browser.evaluate(`JSON.parse(localStorage.getItem('autohandSquad.v1.agents')).find(member=>member.id===${JSON.stringify(member.id)}).workspace`);
  await until(() => browser.evaluate(`!!document.querySelector('button[aria-label^="Workspace for Workspace member:"]')`), 'one workspace control');
  assert.equal(await browser.evaluate(`document.querySelectorAll('button[aria-label="Add workspace"]').length`), 0, 'No separate add-workspace control remains');
  await open();
  await until(() => browser.evaluate(`document.querySelectorAll('[cmdk-item]').length===2`), 'only assigned folders shown');
  await browser.screenshot('.codex-artifacts/reliability/member-workspace-picker.png');
  await browser.fill('[aria-label="Find a working folder"]', 'second');
  await until(() => browser.evaluate(`document.querySelectorAll('[cmdk-item]').length===1`), 'search narrows assigned folders');
  await browser.evaluate(`document.querySelector('[cmdk-item]').click()`);
  await until(async () => await active() === second, 'saved primary workspace');
  await until(() => browser.evaluate(`!document.querySelector('[data-slot="popover-content"][aria-label="Working folder"]')`), 'picker closes after applying a folder');
  await browser.navigate(route);
  await until(() => browser.evaluate(`document.querySelector('button[aria-label^="Workspace for Workspace member:"]')?.getAttribute('title')===${JSON.stringify(second)}`), 'workspace survives reopen');
  console.log('PASS one picker replaces both controls; assigned folder selection survives reopening.');

  await open();
  await browser.fill('[aria-label="Find a working folder"]', join(directory, 'missing'));
  await browser.evaluate(`document.querySelector('[cmdk-item]').click()`);
  await until(() => browser.evaluate(`document.querySelector('[role="alert"]')?.textContent.includes('does not exist')`), 'invalid path explanation');
  assert.equal(await active(), second);
  await browser.fill('[aria-label="Find a working folder"]', 'first');
  await browser.evaluate(`sessionStorage.setItem('workspace.fail','true');document.querySelector('[cmdk-item]').click()`);
  await until(() => browser.evaluate(`document.querySelector('[role="alert"]')?.textContent.includes('Controlled folder save failure')`), 'failed save remains in picker');
  assert.equal(await active(), second);
  await browser.evaluate(`sessionStorage.removeItem('workspace.fail');sessionStorage.setItem('workspace.cancel','true')`);
  await browser.click('Choose another folder…');
  await until(() => browser.evaluate(`!document.querySelector('[role="status"]')?.textContent.includes('Choosing a working folder')`), 'cancel finished');
  assert.equal(await active(), second);
  console.log('PASS invalid folder, failed save and cancelled chooser retain the current workspace.');

  await browser.evaluate(`sessionStorage.removeItem('workspace.cancel')`);
  await browser.click('Choose another folder…');
  await until(async () => await active() === picked, 'native selection applies immediately');
  await until(() => browser.evaluate(`!document.querySelector('[data-slot="popover-content"][aria-label="Working folder"]')`), 'picker closes after choosing another folder');
  assert.equal(await browser.evaluate(`JSON.parse(localStorage.getItem('autohandSquad.v1.agents'))[0].projects.filter(project=>project.path===${JSON.stringify(picked)}).length`), 1);
  await browser.fill('textarea', 'Inspect this workspace');
  await browser.evaluate(`document.querySelector('textarea').closest('form').requestSubmit()`);
  await until(() => browser.evaluate(`!!sessionStorage.getItem('workspace.launch')`), 'launch receipt');
  const launch = await browser.evaluate(`JSON.parse(sessionStorage.getItem('workspace.launch'))`);
  assert.equal(launch.workspace, picked);
  assert.ok(launch.agent.projects.some(project => project.path === picked), 'The request carries the selected folder assignment');
  console.log('PASS choosing another folder needs no second Add action and the next request uses that folder.');
  assert.deepEqual(browser.errors, []);
} finally { await browser?.close(); await bridge.close(); await rm(directory, {recursive:true,force:true}); }
