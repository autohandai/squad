#!/usr/bin/env node
// Real bridge/state/scheduler; only the model response is controlled.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startBridge, startBrowser, until } from './lib/reliability-browser.mjs';
import { initialAgents } from '../src/data.js';

await mkdir(join(process.cwd(), '.codex-artifacts'), { recursive: true });
const workspace = await mkdtemp(join(process.cwd(), '.codex-artifacts/natural-automation-'));
const bridge = await startBridge({
  prepare: async directory => {
    await writeFile(join(directory,'config.json'),JSON.stringify({provider:'autohandai',auth:{token:'fixture-only-no-provider',email:'reliability@example.test',expiresAt:'2099-01-01T00:00:00Z',user:{name:'Reliability Photo',email:'reliability@example.test',avatar:'/avatars/birds/kiwi.webp'}}}));
    const entry = join(directory, 'member.mjs');
    const action = {type: 'schedule', title: 'Say hi every two minutes', instructions: 'Say hi to Igor in this conversation.', schedule: {kind: 'interval', everyMinutes: 2}, timezone: 'Pacific/Auckland'};
    await writeFile(entry, `export class AutohandSDK {
      async start() {} async interrupt() {} async close() {}
      async *streamPrompt({message}) {
        yield {type:'message_start'};
        yield {type:'message_end',content:/create yourself a reminder|Draft an automation:/.test(message) ? ${JSON.stringify(`SQUAD_ACTION: ${JSON.stringify(action)}`)} : 'Hi Igor, this is your scheduled reminder.'};
      }
    }`);
    return {AUTOHAND_AGENT_SDK_ENTRY: entry, AUTOHAND_AGENT_SDK_DIR: directory};
  },
});
let browser;
try {
  const agent = {id: 'natural-eva', name: 'Eva', role: 'QA Engineer', workspace, projects: [{path: workspace}], harness: {id: 'autohand'}};
  const request = {agentId: agent.id, agent, workspace, mode: 'prompt', requestId: 'natural-two-minute-reminder', prompt: 'create yourself a reminder to say hi to me every 2 minutes'};
  const started = await bridge.api('/api/runs', 'POST', request);
  assert.equal(started.success, true, JSON.stringify(started));
  const run = await until(async () => {
    const result = await bridge.api(`/api/runs/${started.data.id}`);
    return ['completed','failed','stopped'].includes(result.data?.status) ? result.data : false;
  }, 'natural reminder');
  assert.equal(run.status, 'completed');
  assert.match(run.command,/--yes|--unrestricted/,'an ordinary member turn defaults to automatic execution');
  const receipt = run.channelActions.find(action => action.type === 'schedule');
  assert.equal(receipt.status, 'confirmed', 'a requested reminder is authorized, not a pending confirmation');
  const routines = (await bridge.api(`/api/routines?memberId=${agent.id}`)).data.routines;
  assert.equal(routines.length, 1, 'the reminder exists in the member automation store');
  assert.equal(routines[0].enabled, true);
  assert.equal(routines[0].schedule.everyMinutes, 2, 'two minutes must not silently become five');
  assert.ok(routines[0].nextAt);
  assert.equal(routines[0].needsApp, false, 'the real bridge can run this member');
  assert.equal((await bridge.api('/api/routines/proposals?status=proposed')).data.proposals.length, 0);
  const repeated = await bridge.api('/api/runs', 'POST', request);
  await until(async () => (await bridge.api(`/api/runs/${repeated.data.id}`)).data?.finishedAt, 'idempotent request');
  assert.equal((await bridge.api(`/api/routines?memberId=${agent.id}`)).data.routines.length, 1);
  const drafted = await bridge.api('/api/routines/draft', 'POST', {memberId:agent.id,agent,workspace,text:'Say hi every two minutes',timeZone:'Pacific/Auckland'});
  assert.equal(drafted.success,true,JSON.stringify(drafted));
  assert.equal(drafted.data.draft.schedule.everyMinutes,2);
  assert.equal((await bridge.api(`/api/routines?memberId=${agent.id}`)).data.routines.length,1,'editor drafting must not create another active schedule');
  for (const policy of ['ask','block']) {
    const member = {...agent,id:`natural-${policy}`,permissions:{builtInPolicies:{squad_schedule:policy}}};
    const started = await bridge.api('/api/runs','POST',{...request,agentId:member.id,agent:member,requestId:`policy-${policy}`});
    const done = await until(async()=>{const run=(await bridge.api(`/api/runs/${started.data.id}`)).data;return run.finishedAt ? run : false;},`explicit ${policy}`);
    assert.equal(done.channelActions[0].status,policy==='ask'?'proposed':'failed');
    assert.equal((await bridge.api(`/api/routines?memberId=${member.id}`)).data.routines.length,0);
  }
  const restricted={...agent,id:'natural-restricted',launch:{policy:'restricted'}};
  await bridge.api(`/api/members/${restricted.id}/channel-access`,'PUT',{agent:restricted,profile:''});
  const restrictedStart=await bridge.api('/api/runs','POST',{agentId:restricted.id,workspace,prompt:'Say hi.'});
  assert.equal(restrictedStart.success,true,JSON.stringify(restrictedStart));
  assert.match(restrictedStart.data.command,/--restricted/,'the saved explicit execution restriction is retained');
  const fired = await bridge.api(`/api/routines/${routines[0].id}/run`,'POST',{});
  assert.equal(fired.success,true,JSON.stringify(fired));
  await until(async()=>{const record=(await bridge.api(`/api/routines/${routines[0].id}`)).data;return record.lastRun?.status==='completed' && record.lastRun?.reply ? record : false;},'real automation output saved');
  const legacy={memberId:agent.id,legacyAutomationId:'old-browser-schedule',title:'Imported reminder',instructions:'Say hi.',workspace,schedule:{kind:'interval',everyMinutes:30,timeZone:'Pacific/Auckland'},enabled:true};
  const imported=await bridge.api('/api/routines','POST',legacy);
  assert.equal(imported.success,true,JSON.stringify(imported));
  await bridge.api(`/api/routines/${imported.data.id}`,'PUT',{title:'Edited imported reminder',enabled:false});
  const retriedImport=await bridge.api('/api/routines','POST',legacy);
  assert.equal(retriedImport.data.id,imported.data.id,'concurrent/repeated legacy imports keep the same schedule identity');
  assert.equal(retriedImport.data.title,'Edited imported reminder','an old browser copy cannot undo a later edit');
  assert.equal(retriedImport.data.enabled,false,'an old browser copy cannot reactivate a paused schedule');
  assert.equal((await bridge.api(`/api/routines/${imported.data.id}`,'DELETE')).success,true);
  assert.equal((await bridge.api(`/api/routines/${imported.data.id}`)).status,404);
  if (process.argv.includes('--browser')) {
    browser = await startBrowser();
    await browser.send('Network.enable');
    const storage = { agents: [{...agent,status:'online',memory:[],skills:[],stats:{},permissions:{},modelAssignment:{mode:'inherit'}}], removedAgents: initialAgents.map(member => member.id), automations: [], tasks: [], messages: {}, channels: [], channelMessages: {}, channelThreads: {}, onboarding:{version:1,status:'skipped',lastStep:'skipped'}, sidebarCollapsed:false };
    const seedSource = `if (!localStorage.getItem('naturalProof.seeded')) {localStorage.clear();for(const [key,value] of Object.entries(${JSON.stringify(storage)}))localStorage.setItem('autohandSquad.v1.'+key,JSON.stringify(value));localStorage.setItem('naturalProof.seeded','true');}`;
    await browser.send('Page.addScriptToEvaluateOnNewDocument', {source:seedSource});
    const navigateInApp = path => browser.evaluate(`history.pushState({},'',${JSON.stringify(path)});window.dispatchEvent(new PopStateEvent('popstate'));`);
    await browser.navigate(`${bridge.origin}/squad-members/${agent.id}/triggers`);
    await until(() => browser.evaluate(`document.querySelector('main')?.innerText.includes('Say hi every two minutes')`), 'chat-created Automation in member profile', 15000);
    await until(()=>browser.evaluate(`!!document.querySelector('aside [data-testid="account-avatar"] img')?.naturalWidth`),'signed-in photo in account footer');
    const accountPoint = await browser.evaluate(`(() => {const r=document.querySelector('button[aria-label="Open account menu"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await browser.send('Input.dispatchMouseEvent',{type:'mousePressed',...accountPoint,button:'left',clickCount:1});
    await browser.send('Input.dispatchMouseEvent',{type:'mouseReleased',...accountPoint,button:'left',clickCount:1});
    await until(()=>browser.evaluate(`!!document.querySelector('[role="menu"] [data-testid="account-avatar"] img')?.naturalWidth`),'same photo in account menu');
    await browser.screenshot(join(process.cwd(),'.codex-artifacts/natural-workflows/account-photo.png'));
    await browser.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await browser.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await browser.screenshot(join(process.cwd(), '.codex-artifacts/natural-workflows/member-automations.png'));
    await navigateInApp(`/conversations/new?member=${agent.id}&panel=automations`);
    await until(()=>browser.evaluate(`document.querySelector('[data-testid="execution-automations"]')?.innerText.includes('Say hi every two minutes')`),'same Automation in Execution');
    await browser.evaluate(`document.querySelector('[data-testid="execution-automations"] button[role="switch"]').click()`);
    await until(async()=>!(await bridge.api(`/api/routines/${routines[0].id}`)).data.enabled,'Pause saved by Execution');
    await browser.screenshot(join(process.cwd(), '.codex-artifacts/natural-workflows/execution-automations.png'));
    await navigateInApp(`/squad-members/${agent.id}/triggers`);
    await until(()=>browser.evaluate(`document.querySelector('[data-testid="member-automations"] button[role="switch"]')?.getAttribute('aria-checked')==='false'`),'profile agrees that it is paused');
    await browser.close(); browser = null;
    const config=JSON.parse(await readFile(join(bridge.directory,'config.json'),'utf8'));
    config.auth.user.avatar='/avatars/missing-account-photo.webp';
    await writeFile(join(bridge.directory,'config.json'),JSON.stringify(config));
    await bridge.restart();
    browser = await startBrowser();
    await browser.send('Page.addScriptToEvaluateOnNewDocument', {source:seedSource});
    await browser.navigate(`${bridge.origin}/conversations/new?member=${agent.id}`);
    await until(()=>browser.evaluate(`document.querySelector('main')?.innerText.includes('Hi Igor, this is your scheduled reminder.')`),'actual reminder delivered after restart',30000);
    assert.equal((await bridge.api(`/api/routines/${routines[0].id}`)).data.enabled,false);
    const assertFallback=async label=>{
      await until(()=>browser.evaluate(`document.querySelector('aside [data-testid="account-avatar"]')?.innerText==='RP' && !document.querySelector('aside [data-testid="account-avatar"] img')`),`${label} in the footer`);
      const point=await browser.evaluate(`(() => {const r=document.querySelector('button[aria-label="Open account menu"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      await browser.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
      await browser.send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
      await until(()=>browser.evaluate(`document.querySelector('[role="menu"] [data-testid="account-avatar"]')?.innerText==='RP' && !document.querySelector('[role="menu"] [data-testid="account-avatar"] img')`),`${label} in the account menu`);
    };
    await assertFallback('broken-photo fallback');
    await browser.screenshot(join(process.cwd(),'.codex-artifacts/natural-workflows/account-photo-fallback.png'));
    assert.deepEqual(browser.errors,[]);
    await browser.close();browser=null;
    delete config.auth.user.avatar;
    await writeFile(join(bridge.directory,'config.json'),JSON.stringify(config));
    await bridge.restart();
    browser=await startBrowser();
    await browser.send('Page.addScriptToEvaluateOnNewDocument',{source:seedSource});
    await browser.navigate(`${bridge.origin}/conversations/new?member=${agent.id}`);
    await assertFallback('missing-photo fallback');
    assert.deepEqual(browser.errors,[]);
  }
  console.log('Natural automation checks passed: immediate scheduling, exact two-minute timing, idempotency, editor draft, explicit ask/block, real run output'+(browser?', both rendered lists, persisted Pause and delivery after restart.':'.'));
} catch (error) {
  if (browser) {
    console.error(JSON.stringify({browserErrors:browser.errors,page:await browser.evaluate('document.body.innerText').catch(()=>null),pending:[...browser.requests.values()].filter(item=>item.status==='pending'),routines:await bridge.api('/api/routines')}));
    await browser.screenshot(join(process.cwd(),'.codex-artifacts/natural-workflows/failure.png')).catch(()=>{});
  }
  console.error(bridge.logs.slice(-6000));
  throw error;
} finally {
  await browser?.close();
  await bridge.close();
  await rm(workspace, { recursive: true, force: true });
}
