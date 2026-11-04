import { test, expect } from '@playwright/test';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startBridge } from '../scripts/lib/reliability-browser.mjs';

let bridge, member;
const title = 'Release research';
test.beforeAll(async () => {
  bridge = await startBridge({ prepare: async directory => {
    const home = join(directory, 'home'), workspace = join(home, 'project');
    await mkdir(home); await mkdir(workspace);
    const preload = join(directory, 'home.mjs');
    await writeFile(preload, `import os from 'node:os';import{syncBuiltinESMExports}from'node:module';os.homedir=()=>${JSON.stringify(home)};syncBuiltinESMExports();`);
    const engine = join(directory, 'fixture-codex');
    const html = `<!doctype html><meta charset="utf-8"><style>body{font:16px system-ui;margin:40px;color:#20201e}h1{font-size:32px}button{padding:8px 16px}article{margin:28px 0}</style><h1>Release research</h1><p>Created by Noah for the release review.</p><button onclick="document.querySelector('article').textContent='Reviewed and ready'">Review findings</button><article>Three findings need review.</article><script>window.proof={};try{window.parent.document.body.dataset.artifactEscaped='yes';window.proof.parent=true}catch{window.proof.parent=false}try{window.proof.storage=window.parent.localStorage.getItem('outside-artifact')}catch{window.proof.storage=false}window.proof.ipc=!!window.__TAURI_INTERNALS__;fetch('/api/system/settings',{method:'PUT',body:'{}'}).then(()=>window.proof.bridge=true).catch(()=>window.proof.bridge=false);</script>`;
    const program = `#!${process.execPath}
const fs=require('node:fs'),child=require('node:child_process'),readline=require('node:readline'),toml=require(${JSON.stringify(resolve('node_modules/toml'))});
const args=process.argv.slice(2);if(args[0]==='--version'){console.log('codex 1.0.0');process.exit(0)}if(args[0]==='login'){console.log('Logged in using fixture');process.exit(0)}
const say=t=>{console.log(JSON.stringify({type:'thread.started',thread_id:'artifact-fixture-thread'}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:t}}));console.log(JSON.stringify({type:'turn.completed'}))};
(async()=>{if(!String(args.at(-1)).includes('artifact-fixture:'))return say('Ready.');
const merged=args.flatMap((v,i)=>v==='-c'?[toml.parse(args[i+1])]:[]),field=k=>merged.find(v=>v.mcp_servers?.['autohand-squad']?.[k]!==undefined)?.mcp_servers['autohand-squad'][k];
fs.writeFileSync(${JSON.stringify(join(workspace, 'research.html'))},${JSON.stringify(html)});
const proxy=child.spawn(field('command'),field('args'),{env:{...process.env,...field('env')},stdio:['pipe','pipe','pipe']});let sequence=0;const pending=new Map();readline.createInterface({input:proxy.stdout}).on('line',line=>{const r=JSON.parse(line);pending.get(r.id)?.(r)});const rpc=(method,params)=>new Promise(done=>{const id=++sequence;pending.set(id,done);proxy.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\\n')});
try{await rpc('initialize',{protocolVersion:'2025-06-18'});const r=await rpc('tools/call',{name:'squad_publish_artifact',arguments:{path:'research.html',title:'Release research',description:'Verified findings for the release review.'}});if(r.error||r.result?.isError)throw Error(JSON.stringify(r));}finally{proxy.kill()}say('I created the release research.');})().catch(e=>{console.error(e.message);process.exit(1)});
`;
    await writeFile(engine, program); await chmod(engine, 0o755);
    member = { id: 'library-noah', name: 'Noah', role: 'Researcher', status: 'online', workspace, projects: [{ path: workspace }], harness: { id: 'codex', executablePath: engine }, permissions: { permissionMode: 'restricted' }, memory: [] };
    return { NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`, AUTOHAND_SQUAD_COMPUTER_USE: 'bundled', AUTOHAND_SQUAD_COMPUTER_USE_RUNTIME_DIR: directory, OPENAI_API_KEY: 'fixture-no-provider' };
  } });
  await bridge.api(`/api/members/${member.id}/channel-access`, 'PUT', { agent: member, profile: '', profilePatch: {} });
});
test.afterAll(async () => { await bridge?.close(); });

test('Squad MCP is visible and generated artifacts open from chat, Library and knowledge', async ({ page }, info) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(member => {
    if (window !== window.top) return;
    localStorage.setItem('autohandSquad.v1.onboarding', '{"version":1,"status":"skipped"}');
    localStorage.setItem('autohandSquad.v1.agents', JSON.stringify([member]));
    localStorage.setItem('outside-artifact', 'private-parent-value');
  }, member);
  await page.goto(bridge.origin + '/settings/connectors');
  const managed = page.getByTestId('squad-managed-connector');
  await expect(managed).toContainText('Autohand Squad');
  await expect(managed).toContainText('Managed by Squad');
  await expect(managed.getByRole('switch')).toHaveCount(0);
  await managed.getByRole('button', { name: 'View tools' }).click();
  await expect(managed).toContainText('squad_publish_artifact');
  await page.screenshot({ path: info.outputPath('squad-mcp.png'), fullPage: true });

  await page.goto(bridge.origin + `/squad-members/${member.id}/library`);
  await expect(page.getByTestId('member-artifact-library')).toContainText('The work you keep, in one place');
  // A real bridge turn executes the fixture engine and managed stdio MCP.
  // It writes the HTML file and publishes through the same authenticated
  // tool any of the supported engines receives. No provider calls.
  const completed = await bridge.api('/api/chat', 'POST', { agentId: member.id, agent: member, workspace: member.workspace, prompt: 'artifact-fixture: create the release research and save it.', resumeSession: false, squadMembers: [member] }, 45000);
  expect(completed.success, JSON.stringify(completed)).toBe(true);
  await expect.poll(async () => (await bridge.api(`/api/artifacts?owner=${member.id}`)).data.artifacts.length).toBe(1);
  const saved = (await bridge.api(`/api/artifacts?owner=${member.id}`)).data.artifacts[0];
  expect(saved.ownerId).toBe(member.id);
  await page.getByRole('button', { name: 'Refresh artifacts' }).click();
  await expect(page.getByRole('button', { name: /Release research Verified findings/ })).toBeVisible();
  await page.screenshot({ path: info.outputPath('member-library.png'), fullPage: true });
  await page.getByRole('button', { name: /Release research Verified findings/ }).click();
  const preview = page.getByTestId('artifact-preview');
  await expect(preview.getByRole('heading')).toHaveText(title);
  const frame = preview.frameLocator('iframe');
  await frame.getByRole('button', { name: 'Review findings' }).click();
  await expect(frame.locator('article')).toHaveText('Reviewed and ready');
  const proof = await frame.locator('body').evaluate(() => window.proof);
  expect(proof).toEqual({ parent: false, storage: false, ipc: false, bridge: false });
  expect(await page.evaluate(() => document.body.dataset.artifactEscaped)).toBeUndefined();
  await page.screenshot({ path: info.outputPath('artifact-preview.png') });
  const download = page.waitForEvent('download');
  await preview.getByRole('link', { name: 'Download artifact' }).click();
  expect((await download).suggestedFilename()).toBe('research.html');
  await preview.getByRole('button', { name: 'Close artifact' }).click();
  await page.getByRole('button', { name: 'Knowledge base', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Memory|Knowledge/i }).first()).toBeVisible();
  expect((await bridge.api(`/api/memory?owner=${member.id}&kind=artifact`)).data.records[0].id).toBe(saved.id);
  await page.goto(bridge.origin + saved.href);
  await expect(preview.getByRole('heading')).toHaveText(title);
  await preview.getByRole('button', { name: 'Close artifact' }).click();
  // The completed reply carries the durable artifact link for chat rendering.
  expect(JSON.stringify(completed)).toContain(saved.href);
  await page.goto(bridge.origin + `/conversations/new?member=${member.id}`);
  const composer = page.locator('main textarea:visible').last();
  await composer.fill('artifact-fixture: save the release research to your Library.');
  await composer.press('Enter');
  const card = page.getByRole('button', { name: 'Open artifact: Release research', exact: true }).last();
  await expect(card).toBeVisible({ timeout: 30000 });
  await page.screenshot({ path: info.outputPath('chat-artifact.png'), fullPage: true });
  await card.click();
  await expect(preview.getByRole('heading')).toHaveText(title);
  await preview.getByRole('button', { name: 'Close artifact' }).click();
  await page.goto(bridge.origin + `/quick-chat?member=${member.id}`);
  await page.getByRole('button', { name: 'Open artifact: Release research', exact: true }).last().click();
  await expect(page).toHaveURL(bridge.origin + saved.href);
  await expect(preview.getByRole('heading')).toHaveText(title);
  await preview.getByRole('button', { name: 'Close artifact' }).click();
  // Native quick-chat forwarding emits popstate even if the main window
  // is already at this exact artifact URL. Closing must not make it stale.
  await page.evaluate(() => window.dispatchEvent(new PopStateEvent('popstate')));
  await expect(preview.getByRole('heading')).toHaveText(title);
  await page.evaluate(() => window.dispatchEvent(new PopStateEvent('popstate')));
  await expect(preview.getByRole('heading')).toHaveText(title);
  await preview.getByRole('button', { name: 'Close artifact' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
