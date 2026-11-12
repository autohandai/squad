import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {startBridge,startBrowser,until} from './lib/reliability-browser.mjs';
import {prepareModelRoutingFixture} from './lib/model-routing-fixtures.mjs';
import {seedOwnedBrowserFixture} from './lib/owned-bridge-fixture.mjs';

const packaged=process.argv.includes('--packaged');
const artifact='.codex-artifacts/model-fallbacks-20261029'+(packaged?'/packaged':'');
await mkdir(artifact,{recursive:true});
const bridge=await startBridge({prepare:prepareModelRoutingFixture,...(packaged?{cwd:resolve('src-tauri/runtime'),development:false}:{})});
let browser;
try{
  const member={id:'asq_model_fixture',name:'Model Verify',role:'Reviewer',workspace:process.cwd(),projects:[{path:process.cwd()}],harness:{id:'autohand'},modelAssignment:{mode:'override',provider:'autohandai',model:'fixture-moa'},permissions:{}};
  await bridge.api('/api/members/'+member.id+'/channel-access','PUT',{agent:member,profile:''});
  // "Save fallbacks" reads "Saving…" until the window has handled the save,
  // which can be after the bridge copy already shows it. The 0.1.16 release
  // run clicked during that gap: "Missing button: Save fallbacks".
  // A save that succeeds is finished only when the window shows it saved:
  // until then the editor resets its draft to the incoming saved copy, which
  // undid the switch flip CI made right after the bridge had the save
  // ("Save fallbacks ready timed out", 3 November).
  const saveFallbacks=async({settle=true}={})=>{await until(()=>browser.evaluate("[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Save fallbacks'&&!button.disabled)"),'Save fallbacks ready');await browser.click('Save fallbacks');if(settle)await until(()=>browser.evaluate("[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Save fallbacks'&&button.disabled)"),'fallback save settled in the window');};
  const savedMember=async()=>(await bridge.api('/api/channels')).data.agentChannelAccess[member.id].agent;
  browser=await startBrowser();
  const fixtureContext=await seedOwnedBrowserFixture(bridge,browser);
  const membersKey=`autohandSquad.owner.v1.${fixtureContext.storageKey}.${encodeURIComponent('autohandSquad.v1.agents')}`;
  await browser.send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__fixtureMembersKey=${JSON.stringify(membersKey)};`});
  await browser.navigate(bridge.origin+'/squad-members/'+member.id+'/model');
  await until(()=>browser.evaluate("document.body.innerText.includes('Save model assignment')"),'member model assignment page');
  assert(await browser.evaluate("Boolean(document.querySelector('[role=combobox][aria-label=Model]'))"),'The override must offer the harness-supported model IDs instead of a free-text-only field');
  await until(()=>browser.evaluate("document.querySelector('[role=combobox][aria-label=Model]')?.disabled===false"),'model catalog loaded');
  await browser.evaluate(`(()=>{const original=window.fetch.bind(window);window.fetch=(input,options)=>{const path=new URL(typeof input==='string'?input:input.url,location.origin).pathname;if(window.__modelFailSave&&path.endsWith('/channel-access')&&options?.method==='PUT')return Promise.resolve(new Response(JSON.stringify({success:false,error:'Fixture save refused'}),{status:409,headers:{'content-type':'application/json'}}));if(window.__modelFailRefresh&&path==='/api/harnesses/models')return Promise.resolve(new Response(JSON.stringify({success:false,error:'Fixture catalog unavailable'}),{status:503,headers:{'content-type':'application/json'}}));return original(input,options);};})()`);
  await browser.evaluate("document.querySelector('[role=combobox][aria-label=Model]').click()");
  await until(()=>browser.evaluate("[...document.querySelectorAll('[role=option]')].some(option=>option.textContent.includes('fixture-fantail'))"),'supported model IDs loaded into picker');
  assert(await browser.evaluate("[...document.querySelectorAll('[role=option]')].some(option=>option.textContent.includes('Fixture Fantail'))"),'The picker shows the catalog display name alongside its exact ID');
  const chooseOption=async text=>{
    await until(()=>browser.evaluate(`[...document.querySelectorAll('[role=option]')].some(option=>option.textContent.includes(${JSON.stringify(text)}))`),'model option '+text);
    await browser.evaluate(`(()=>{const option=[...document.querySelectorAll('[role=option]')].find(option=>option.textContent.includes(${JSON.stringify(text)})&&!option.textContent.startsWith('Engine default'));option.scrollIntoView({block:'center'});option.focus();})()`);
    await browser.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await browser.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
    await until(()=>browser.evaluate("!document.querySelector('[role=listbox]')"),'selected option closes picker');
  };
  const choose=async(label,text)=>{await until(()=>browser.evaluate(`document.querySelector('[role=combobox][aria-label=${JSON.stringify(label)}]')?.disabled===false`),label+' loaded');await browser.evaluate(`document.querySelector('[role=combobox][aria-label=${JSON.stringify(label)}]').click()`);await chooseOption(text);};
  await chooseOption('fixture-fantail');
  await browser.evaluate('window.__modelFailSave=true');await browser.click('Save model assignment');
  await until(()=>browser.evaluate("[...document.querySelectorAll('[role=alert]')].some(element=>element.textContent.includes('Fixture save refused'))"),'failed primary save is visible');
  assert.equal((await savedMember()).modelAssignment.model,'fixture-moa','A failed save leaves the persisted assignment alone');
  assert(await browser.evaluate("document.querySelector('[role=combobox][aria-label=Model]').textContent.includes('fixture-fantail')"),'The unsaved primary choice survives failure');
  await until(()=>browser.evaluate("[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Save model assignment'&&!button.disabled)"),'primary save ready to retry');
  await browser.evaluate('window.__modelFailSave=false');await browser.click('Save model assignment');
  await until(async()=>(await savedMember()).modelAssignment.model==='fixture-fantail','primary model assignment saved');
  await browser.evaluate('window.__modelFailRefresh=true');await browser.click('Refresh model list');
  await until(()=>browser.evaluate("document.body.innerText.includes('Fixture catalog unavailable')"),'failed catalog refresh is visible');
  await browser.evaluate("document.querySelector('[role=combobox][aria-label=Model]').click()");
  assert(await browser.evaluate("[...document.querySelectorAll('[role=option]')].some(option=>option.textContent.includes('Fixture Moa'))"),'A refresh error retains the usable list');
  await chooseOption('fixture-fantail');await browser.evaluate('window.__modelFailRefresh=false');await browser.click('Refresh model list');
  await until(()=>browser.evaluate("document.querySelector('button')&&[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Add fallback'&&!button.disabled)"),'connected engines loaded');
  await browser.click('Add fallback');await choose('Fallback 1 model','codex-recovery');
  await browser.evaluate('window.__modelFailSave=true');await saveFallbacks({settle:false});
  await until(()=>browser.evaluate("[...document.querySelectorAll('section[aria-label=Fallbacks] [role=alert]')].some(element=>element.textContent.includes('Fixture save refused'))"),'failed fallback save is visible');
  await until(()=>browser.evaluate("[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Save fallbacks'&&!button.disabled)"),'fallback save ready to retry');
  assert(!(await savedMember()).modelRouting?.fallbacks?.length,'A failed fallback save leaves the persisted list alone');
  assert(await browser.evaluate("document.querySelector('[role=combobox][aria-label=\"Fallback 1 model\"]').textContent.includes('codex-recovery')"),'The unsaved fallback choice survives failure');
  await browser.evaluate('window.__modelFailSave=false');await saveFallbacks();
  await until(async()=>(await savedMember()).modelRouting?.fallbacks[0]?.harness.model==='codex-recovery','fallback model saved');
  await browser.click('Add fallback');await choose('Fallback engine 2','Claude Code');await choose('Fallback 2 model','claude-fixture');
  await browser.click('Move fallback 2 up');await saveFallbacks();
  await until(async()=>(await savedMember()).modelRouting?.fallbacks[0]?.harness.id==='claude','fallback order saved');
  await browser.screenshot(artifact+'/fallback-editor.png');
  await browser.evaluate('window.beforeRoutingReload=true');await browser.send('Page.reload');
  await until(()=>browser.evaluate("!window.beforeRoutingReload&&document.querySelector('[data-fallback-row=\"0\"]')?.textContent.includes('Claude')"),'saved fallback ordering reloaded');
  await browser.click('Move fallback 1 down');await saveFallbacks();
  await until(async()=>(await savedMember()).modelRouting?.fallbacks[0]?.harness.id==='codex','Codex first again');
  assert.equal((await savedMember()).modelRouting.allowAgentChanges,false,'Agent edits start disabled');
  await browser.evaluate("document.querySelector('[role=switch][aria-label=\"Let this member manage fallbacks\"]').click()");await until(()=>browser.evaluate("document.querySelector('[role=switch][aria-label=\"Let this member manage fallbacks\"]')?.getAttribute('aria-checked')==='true'"),'member fallback permission switched on');await saveFallbacks();
  await until(async()=>(await savedMember()).modelRouting.allowAgentChanges===true,'optional agent permission saved');

  await writeFile(join(bridge.directory,'fail-autohand'),'fail');
  await browser.navigate(bridge.origin+'/conversations/new?member='+member.id);
  await until(()=>browser.evaluate("Boolean(document.querySelector('textarea[placeholder=\"Talk to Model Verify...\"]'))"),'fallback chat composer');
  await browser.fill('textarea[placeholder="Talk to Model Verify..."]','A short browser fallback check.');
  await until(()=>browser.evaluate("[...document.querySelectorAll('button')].some(button=>button.getAttribute('aria-label')==='Send chat message'&&!button.disabled)"),'chat draft ready to send');
  await browser.click('Send chat message');
  await until(()=>browser.evaluate("document.body.innerText.includes('Codex fixture continued the same task.')&&document.body.innerText.includes('fallback via Codex')"),'actual fallback answer and engine identity',25000);
  assert.equal(await browser.evaluate("document.querySelectorAll('[data-message-id$=\"-u\"]').length"),1,'Failover keeps one user message in the same chat');
  const selected=(await savedMember());assert.equal(selected.harness.id,'autohand');assert.equal(selected.modelAssignment.model,'fixture-fantail');
  const engineCalls=(await readFile(join(bridge.directory,'model-calls.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.equal(engineCalls.findLast(row=>row.engine==='codex'&&row.kind==='turn').model,'codex-recovery');
  await browser.screenshot(artifact+'/fallback-answer.png');
  await browser.evaluate('window.beforeRoutingReload=true');await browser.send('Page.reload');
  await until(()=>browser.evaluate("!window.beforeRoutingReload&&document.body.innerText.includes('fallback via Codex')&&document.body.innerText.includes('Codex fixture continued the same task.')"),'fallback attribution survives history reload');
  await bridge.api('/api/members/'+member.id+'/model-routing/reset','POST',{});
  await rm(join(bridge.directory,'fail-autohand'));await writeFile(join(bridge.directory,'partial-autohand'),'partial');
  await browser.fill('textarea[placeholder="Talk to Model Verify..."]','Continue after a partial primary answer.');
  await until(()=>browser.evaluate("[...document.querySelectorAll('button')].some(button=>button.getAttribute('aria-label')==='Send chat message'&&!button.disabled)"),'second chat draft ready');
  await browser.click('Send chat message');
  await until(()=>browser.evaluate("document.body.innerText.split('Codex fixture continued the same task.').length===3"),'partial reply replaced by the fallback answer',25000);
  assert.equal(await browser.evaluate("document.body.innerText.includes('Partial answer that must be replaced.')"),false,'A failed partial answer is replaced, not concatenated to the fallback');
  await browser.screenshot(artifact+'/fallback-answer.png');
  await rm(join(bridge.directory,'partial-autohand'));await bridge.api('/api/members/'+member.id+'/model-routing/reset','POST',{});
  // Reproduce the receipt-before-roster ordering from hosted run
  // 41590739539. A channel refresh sometimes hid the missing receipt field.
  await browser.evaluate(`(async()=>{window.__modelHeldChannels=await(await fetch('/api/channels')).json();window.__modelHoldChannels=true;const original=window.fetch.bind(window);window.fetch=(input,options)=>{const path=new URL(typeof input==='string'?input:input.url,location.origin).pathname;if(window.__modelHoldChannels&&path==='/api/channels')return Promise.resolve(new Response(JSON.stringify(window.__modelHeldChannels),{headers:{'content-type':'application/json'}}));return original(input,options);};})()`);
  await browser.fill('textarea[placeholder="Talk to Model Verify..."]','MCP_ROUTING_PROBE');
  await until(()=>browser.evaluate("[...document.querySelectorAll('button')].some(button=>button.getAttribute('aria-label')==='Send chat message'&&!button.disabled)"),'member tool request ready');
  await browser.click('Send chat message');
  // The member's tool turn runs a real bridge turn on the fixture engine; the CI runner takes longer than the ten-second default (the 30 October and 2 November runs timed out here).
  await until(async()=>(await savedMember()).modelRouting.fallbacks[0]?.harness.model==='codex-second','member fallback tool persisted its profile revision',60000);
  await until(()=>browser.evaluate("JSON.parse(localStorage.getItem(window.__fixtureMembersKey)||'[]').find(agent=>agent.id==='asq_model_fixture')?.modelRouting?.fallbacks[0]?.harness.model==='codex-second'"),'committed receipt projects the fallback model before a roster refresh',5000);
  await browser.evaluate('window.__modelHoldChannels=false');
  await browser.navigate(bridge.origin+'/squad-members/'+member.id+'/model');
  await until(()=>browser.evaluate("document.querySelector('[role=combobox][aria-label=\"Fallback 1 model\"]')?.textContent.includes('codex-second')"),'member tool receipt updates the editor',60000);
  assert.equal((await savedMember()).modelAssignment.model,'fixture-fantail','The tool leaves the primary model alone');
  await writeFile(join(bridge.directory,'fail-autohand'),'fail');await bridge.api('/api/members/'+member.id+'/model-routing/reset','POST',{});
  const thread=(await bridge.api('/api/members/'+member.id+'/threads','POST',{root:{id:'model-thread-parent',role:'user',body:'Fallback thread verification'}})).data;
  await browser.navigate(bridge.origin+'/conversations/new?member='+member.id);
  await until(()=>browser.evaluate("Boolean(document.querySelector('[data-testid=previous-chats]'))"),'history control ready');
  await browser.click('History');
  await until(()=>browser.evaluate("[...document.querySelectorAll('[data-history-kind=thread] button')].some(button=>button.textContent.includes('Fallback thread verification'))"),'saved independent thread listed in History');
  await browser.evaluate("[...document.querySelectorAll('[data-history-kind=thread] button')].find(button=>button.textContent.includes('Fallback thread verification')).click()");
  await until(()=>browser.evaluate("Boolean(document.querySelector('textarea[aria-label=\"Thread reply\"]'))"),'thread composer ready');
  await browser.fill('textarea[aria-label="Thread reply"]','Please continue within this thread.');
  await until(()=>browser.evaluate("document.querySelector('[role=dialog] form button[type=submit]')?.disabled===false"),'thread reply ready to send');
  await browser.evaluate("document.querySelector('[role=dialog] form button[type=submit]').click()");
  await until(()=>browser.evaluate("document.querySelector('[role=dialog]')?.textContent.includes('fallback via Codex · codex-second')"),'fallback engine and model displayed in the reply thread',25000);
  await browser.screenshot(artifact+'/fallback-thread.png');
  assert.equal((await bridge.api('/api/members/'+member.id+'/threads/'+thread.id)).data.messages.find(message=>message.role==='agent').routing.used.model,'codex-second');
  assert.deepEqual(browser.errors,[]);
  console.log('PASS catalog IDs/names, failed save/refresh recovery, connected engine/model selection, ordered edits, optional member tools, reload persistence, native failover identity and partial-answer replacement in one chat.');
}catch(error){
  // The bridge's side of a failure: CI shows only this output.
  try{const runs=(await bridge.api('/api/runs')).data||[];console.error('bridge runs',JSON.stringify(runs.slice(0,3).map(run=>({status:run.status,harness:run.harness,title:String(run.title||'').slice(0,60),reply:String(run.reply||'').slice(0,80),logs:(run.logs||[]).slice(-10).map(entry=>`${entry.source}: ${String(entry.line).slice(0,300)}`)})),null,1));const toolRows=(await readFile(join(bridge.directory,'model-calls.jsonl'),'utf8').catch(()=>'')).trim().split('\n').filter(line=>line.includes('routing-tool')).slice(-2);console.error('member tool responses',toolRows.map(line=>line.slice(0,600)).join('\n'));const member=(await bridge.api('/api/channels')).data.agentChannelAccess['asq_model_fixture']?.agent;console.error('bridge member',JSON.stringify({profileRevision:member?.profileRevision,fallbacks:member?.modelRouting?.fallbacks?.map(route=>route.harness.model)}));if(browser)console.error('window member',await browser.evaluate("JSON.stringify(JSON.parse(localStorage.getItem(window.__fixtureMembersKey)||'[]').filter(agent=>agent.id==='asq_model_fixture').map(agent=>({profileRevision:agent.profileRevision,fallbacks:agent.modelRouting?.fallbacks?.map(route=>route.harness.model)})))"));}catch(dumpError){console.error('bridge state unavailable:',dumpError.message);}
  if(browser){await browser.screenshot(artifact+'/model-picker.png').catch(()=>{});console.error(await browser.evaluate("JSON.stringify({text:document.body.innerText.slice(-3500),errors:window.__modelVerifyErrors,buttons:[...document.querySelectorAll('button')].filter(button=>button.getAttribute('aria-label')?.includes('chat message')).map(button=>({label:button.getAttribute('aria-label'),disabled:button.disabled}))})").catch(()=>''));}console.error(bridge.logs.slice(-1500));throw error;}
finally{await browser?.close();await bridge.close();}
