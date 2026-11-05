import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { initialAgents } from '../src/data.js';
import { startBridge, startBrowser, until } from './lib/reliability-browser.mjs';

const output = '.codex-artifacts/quick-chat';
await mkdir(output, { recursive: true });
const workspace = await mkdtemp(join(process.cwd(), `${output}/project-`));
const bridge = await startBridge({ development: process.env.AUTOHAND_CHECK_PRODUCTION !== '1', prepare: async directory => { await mkdir(join(directory, "squad"), { recursive: true }); await writeFile(join(directory, "squad", "settings.json"), JSON.stringify({ quickChatShowUsage: false })); return {}; } });
let browser;
try {
  browser = await startBrowser({ disableBackForwardCache: true });
  await browser.send('Network.enable');
  const member = { ...initialAgents[0], id: 'quick-layout-eva', name: 'Eva', role: 'QA Engineer', avatar: '/avatars/birds/kiwi.webp', workspace, projects: [{ path: workspace }], skills: [] };
  const body = '## Verdict\n\nThe user-facing surface is well specified. This long reply must wrap inside Quick Chat and remain readable without clipped words.\n\n' +
    '`' + 'long_identifier_'.repeat(45) + '`\n\n| Field | Result |\n| --- | --- |\n| Long value | ' + 'detail_'.repeat(55) + ' |\n\n```text\n' + 'wide_output_'.repeat(60) + '\n```\n\nHandoff: the suite is ready to run. Preserve this final sentence and the composer.';
  const storage = { agents: [member], removedAgents: initialAgents.map(item => item.id), tasks: [], messages: { [member.id]: [{ id: 'quick-layout-answer', role: 'agent', agentId: member.id, authorName: 'Eva', body, status: 'complete', createdAt: new Date().toISOString() }, { id: 'quick-layout-summary', role: 'agent', agentId: member.id, authorName: 'Eva', body: '## Ready for review\n\nThe sign-in and onboarding flows are ready. The accessibility check is the remaining follow-up.\n\n**Handoff:** Iris will review the results when the checks finish.', status: 'complete', createdAt: new Date().toISOString() }] }, channels: [], automations: [], onboarding: { version: 1, status: 'skipped', lastStep: 'skipped' }, skin: 'default', theme: { mode: 'light', lightTheme: 'autohand-light', darkTheme: 'autohand-dark' } };
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `const actualFetch=window.fetch;window.__usageReads=0;window.__fetches=[];window.fetch=(url,opts)=>{window.__fetches.push(String(url));if(new URL(typeof url==='string'?url:url.url,location.href).pathname==='/api/harnesses/usage'){window.__usageReads++;return Promise.resolve(new Response(JSON.stringify({success:true,data:{harnesses:[{id:'claude',label:'Claude Code',windows:[{id:'weekly',label:'Weekly',usedPercent:40,resetsAt:new Date(Date.now()+160800000).toISOString()},{id:'model',label:'Fable',usedPercent:0,resetsAt:new Date(Date.now()+160800000).toISOString()}]},{id:'codex',label:'Codex',windows:[{id:'weekly',label:'Weekly',usedPercent:53,resetsAt:new Date(Date.now()+432000000).toISOString()}]}]}}),{headers:{'content-type':'application/json'}}));}return actualFetch(url,opts);};window.__nativePreferenceCalls=[];window.__TAURI_INTERNALS__={invoke:async(command)=>{window.__nativePreferenceCalls.push(command);if(window.__failNativePreferences)throw new Error('Command not found');return null;}};if(!sessionStorage.getItem('quick-layout-seeded')){localStorage.clear();for(const[key,value]of Object.entries(${JSON.stringify(storage)}))localStorage.setItem('autohandSquad.v1.'+key,key==='skin'?value:JSON.stringify(value));sessionStorage.setItem('quick-layout-seeded','true');}` });
  const clickReady = async selector => { await until(() => browser.evaluate(`!!document.querySelector(${JSON.stringify(selector)}+':not(:disabled)')`), 'control ready'); await browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); };
  const reports = [];
  for (const [width, height] of [[380, 520], [420, 600]]) {
    await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await browser.navigate(`${bridge.origin}/quick-chat?member=${member.id}`);
    await until(() => browser.evaluate(`!!document.querySelector('[data-message-id="quick-layout-answer"] p') && !!document.querySelector('textarea')`), 'quick reply rendered', 30000);
    const report = await browser.evaluate(`(() => { const root=document.querySelector('[data-testid="mac-quick-chat"]');const message=document.querySelector('[data-message-id="quick-layout-answer"]');const paragraph=message.querySelector('p');const composer=document.querySelector('[data-testid="quick-chat-composer"]');return { width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,documentHeight:document.documentElement.scrollHeight,rootWidth:root.getBoundingClientRect().width,messageWidth:message.getBoundingClientRect().width,paragraphWidth:paragraph.getBoundingClientRect().width,composerBottom:composer.getBoundingClientRect().bottom }; })()`);
    reports.push(report);
    await browser.screenshot(`${output}/layout-${width}.png`);
    await writeFile(`${output}/layout-report.json`, JSON.stringify(reports, null, 2));
    assert.ok(report.paragraphWidth <= width - 20, `Reply prose is clipped: ${JSON.stringify(report)}`);
    assert.ok(report.documentWidth <= width && report.documentHeight <= height, 'Quick Chat stays inside its native window');
    assert.ok(report.composerBottom <= height, 'Composer remains visible');
  }
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
  await browser.navigate(`${bridge.origin}/settings/quick-chat`);
  await until(() => browser.evaluate(`!!document.querySelector('#quick-chat-enabled:not(:disabled)')`), 'Quick Chat preferences ready');
  await clickReady('#quick-chat-usage');
  await until(async () => (await bridge.api('/api/system/settings')).data.quickChatShowUsage, 'usage enabled and persisted');
  await until(() => browser.evaluate(`!!document.querySelector('[aria-label="Quick Chat menu bar mode"]:not(:disabled)')`), 'menu mode ready after save');
  const selectPoint = await browser.evaluate(`(() => { const rect=document.querySelector('[aria-label="Quick Chat menu bar mode"]').getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};})()`);
  await browser.send('Input.dispatchMouseEvent', {type:'mousePressed',...selectPoint,button:'left',clickCount:1});
  await browser.send('Input.dispatchMouseEvent', {type:'mouseReleased',...selectPoint,button:'left',clickCount:1});
  await until(() => browser.evaluate(`!!document.querySelector('[role=option]')`), 'menu mode options');
  await browser.evaluate(`[...document.querySelectorAll('[role=option]')].find(item=>item.textContent.includes('Agent avatars')).click()`);
  await until(async () => (await bridge.api('/api/system/settings')).data.quickChatMenuBarMode === 'active-agents', 'individual icon preference persisted');
  assert.ok(await browser.evaluate(`window.__nativePreferenceCalls.includes('squad_refresh_quick_chat')`), 'saved preferences request native reconciliation');
  await browser.evaluate(`window.__failNativePreferences=true`);
  await clickReady('#quick-chat-enabled');
  await until(async () => !(await bridge.api('/api/system/settings')).data.quickChatEnabled, 'Quick Chat disabled and persisted');
  await until(() => browser.evaluate(`document.body.innerText.includes('Reopen an updated Squad desktop app')`), 'older native shell reports that saved preferences cannot be applied');
  await browser.evaluate(`window.__failNativePreferences=false`);
  await browser.navigate(`${bridge.origin}/settings/quick-chat`);
  await until(() => browser.evaluate(`document.querySelector('#quick-chat-enabled')?.getAttribute('data-state')==='unchecked'`), 'disabled preference survives reload');
  await clickReady('#quick-chat-enabled');
  await until(async () => (await bridge.api('/api/system/settings')).data.quickChatEnabled, 'Quick Chat re-enabled');
  await browser.screenshot(`${output}/settings.png`);
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 600, deviceScaleFactor: 1, mobile: false });
  await browser.navigate(`${bridge.origin}/quick-chat?member=${member.id}`);
  await until(() => browser.evaluate(`document.querySelector('[data-testid=quick-chat-usage]')?.innerText.includes('53% used')`), 'provider usage rows rendered', 35000);
  assert.equal(await browser.evaluate(`document.querySelector('[aria-label="Claude Code Fable used"]').getAttribute('aria-valuenow')`), '0', 'genuine zero is visible');
  await browser.fill('textarea', 'Preserve this unsent Quick Chat draft.');
  await bridge.api('/api/system/settings', 'PUT', { quickChatEnabled: false });
  await browser.evaluate(`window.dispatchEvent(new Event('squad:quick-chat-settings'))`);
  await until(() => browser.evaluate(`document.body.innerText.includes('Quick Chat is off')`), 'already-open Quick Chat follows disable');
  assert.equal(await browser.evaluate(`document.querySelector('textarea').value`), 'Preserve this unsent Quick Chat draft.', 'disable preserves the mounted draft');
  await bridge.api('/api/system/settings', 'PUT', { quickChatEnabled: true });
  await browser.evaluate(`window.dispatchEvent(new Event('squad:quick-chat-settings'))`);
  await until(() => browser.evaluate(`!document.body.innerText.includes('Quick Chat is off')`), 'already-open Quick Chat re-enabled');
  assert.equal(await browser.evaluate(`document.querySelector('textarea').value`), 'Preserve this unsent Quick Chat draft.');
  await browser.evaluate(`document.querySelector('.quick-chat-history [data-slot="scroll-area-viewport"]').scrollTo({top:100000,behavior:'instant'})`);
  await bridge.api('/api/system/settings', 'PUT', { quickChatAppearance: 'solid' });
  await browser.evaluate(`window.dispatchEvent(new Event('squad:quick-chat-settings'))`);
  await until(() => browser.evaluate(`document.documentElement.dataset.quickChatAppearance==='solid'`), 'solid appearance applied without reload');
  assert.equal(await browser.evaluate(`document.querySelector('textarea').value`), 'Preserve this unsent Quick Chat draft.');
  await bridge.api('/api/system/settings', 'PUT', { quickChatAppearance: 'glass' });
  await browser.evaluate(`window.dispatchEvent(new Event('squad:quick-chat-settings'))`);
  await until(() => browser.evaluate(`document.documentElement.dataset.quickChatAppearance==='glass'`), 'glass appearance applied without reload');
  await browser.screenshot(`${output}/usage-light.png`);
  await browser.evaluate(`localStorage.setItem('autohandSquad.v1.theme',JSON.stringify({mode:'dark',lightTheme:'autohand-light',darkTheme:'autohand-dark'}));window.dispatchEvent(new Event('focus'));`);
  await until(() => browser.evaluate(`document.documentElement.dataset.themeSurface==='dark'`), 'Quick Chat dark appearance');
  await browser.screenshot(`${output}/usage-dark.png`);
  console.log('Quick Chat layout passed at 380x520 and 420x600, including long Markdown, real preference controls, native refresh IPC, persisted disable, usage rows and preserved drafts.');
} catch(error) {
  if (browser) { await browser.screenshot(`${output}/failure.png`).catch(()=>{}); await writeFile(`${output}/failure.json`, JSON.stringify({ errors: browser.errors, requests: [...browser.requests.values()].filter(item => item.url.includes("/api/")), page: await browser.evaluate(`({text:document.body.innerText,reads:window.__usageReads,fetches:window.__fetches})`).catch(()=>null), settings: await bridge.api('/api/system/settings') },null,2)); }
  throw error;
} finally { await browser?.close(); await bridge.close(); await rm(workspace, { recursive: true, force: true }); }
