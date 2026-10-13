import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startBridge, startBrowser, until } from './lib/reliability-browser.mjs';

const failures=[];let checks=0;
const selected=process.argv.find(arg=>arg.startsWith('--case='))?.slice(7);
async function prepare(directory) {
  const project=join(process.cwd(),'.codex-artifacts','reliability','collaboration-project');await mkdir(project,{recursive:true});await writeFile(join(project,'README.md'),'Disposable collaboration evidence.\n');
  const entry=join(directory,'collaboration-sdk.mjs');
  await writeFile(entry,`
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
export class AutohandSDK {
  constructor(options) {this.options=options;}
  async start() {} async close() {} async interrupt() {this.interrupted=true;}
  async *streamPrompt({message:prompt}) {
    const profile=JSON.parse(readFileSync(join(this.options.envVars.AUTOHAND_HOME,'profile.json'),'utf8'));
    const scenario=readFileSync(${JSON.stringify(join(directory,'scenario'))},'utf8');
    appendFileSync(${JSON.stringify(join(directory,'turns.jsonl'))},JSON.stringify({id:profile.id,name:profile.name,prompt,system:this.options.appendSystemPrompt})+'\\n');
    if(prompt.includes('RECEIPT_PURPOSE_MARKER')) {yield {type:'message_end',content:'CHANNEL_PURPOSE_EXECUTED_ONCE'};return;}
    if(profile.name==='Implementer') {yield {type:'message_end',content:scenario==='root-parallel'?'IMPLEMENTATION_EVIDENCE: @Tester check implementation. @Security inspect risks.':'IMPLEMENTATION_EVIDENCE: ready for testing. @Tester test this evidence and ask Reviewer to review it.'};return;}
    if(profile.name==='Tester') {
      if(prompt.includes('BUSY_MARKER')) {while(!existsSync(${JSON.stringify(join(directory,'release-qa'))}) && !this.interrupted) await new Promise(resolve=>setTimeout(resolve,50));if(!this.interrupted) yield {type:'message_end',content:'BUSY_REQUEST_FINISHED'};return;}
      if(scenario==='root-parallel') {yield {type:'message_end',content:'QA_EVIDENCE: implementation accepted.'};return;}
      if(scenario==='receipt-retry') {yield {type:'message_end',content:'QA_EVIDENCE: checked implementation.'+String.fromCharCode(10)+'SQUAD_ACTION: '+JSON.stringify({type:'create_channel',name:'checkpoint-evidence',members:['Tester'],purpose:'RECEIPT_PURPOSE_MARKER: keep the confirmed check.'})+String.fromCharCode(10)+'@Reviewer inspect this completed check and return the verdict.'};return;}
      if(scenario==='partial-failure') {yield {type:'message_delta',delta:'PARTIAL_QA_EVIDENCE: started inspection.'};yield {type:'error',error:'QA provider failed before completion.'};return;}
      yield {type:'message_end',content:'QA_EVIDENCE: checked the implementation. @Reviewer review the earlier implementation and my check, then return your verdict.'+(scenario==='parallel-review'?' @Security verify the same evidence and report risks.':'')};return;
    }
    if(profile.name==='Reviewer' || profile.name==='Security') {
      const release=profile.name==='Reviewer'?${JSON.stringify(join(directory,'release-review'))}:${JSON.stringify(join(directory,'release-security'))};
      if(scenario==='receipt-retry' && !existsSync(release)) {yield {type:'error',error:'Review failed after the confirmed QA channel effect.'};return;}
      while(!existsSync(release) && !this.interrupted) await new Promise(resolve=>setTimeout(resolve,50));
      if(!this.interrupted) yield {type:'message_end',content:(profile.name==='Reviewer'?'REVIEW_EVIDENCE':'SECURITY_EVIDENCE')+': implementation and QA evidence accepted; report this verdict to the original user.'};
    }
  }
}
`);
  return {AUTOHAND_AGENT_SDK_ENTRY:entry,AUTOHAND_AGENT_SDK_DIR:directory};
}
async function check(label,scenario,run) {
  if(selected && !label.includes(selected)) return;
  let bridge,browser;
  console.log('RUN '+label);
  try {bridge=await startBridge({prepare});await writeFile(join(bridge.directory,'scenario'),scenario);browser=await startBrowser();await run(bridge,browser);checks++;console.log('PASS '+label);}
  catch(error) {
    failures.push({label,error:error.message});console.error('FAIL '+label+': '+error.message);
    if(browser) await writeFile('.codex-artifacts/reliability/collaboration-cycle-failure-state.json',JSON.stringify({label,ui:await browser.evaluate(`({path:location.href,main:document.querySelector('main')?.innerText.slice(0,1500),messages:Object.fromEntries(Object.entries(JSON.parse(localStorage.getItem('autohandSquad.v1.messages')||'{}')).filter(([id])=>id.startsWith('asq_cycle_'))),tasks:JSON.parse(localStorage.getItem('autohandSquad.v1.tasks')||'[]').filter(task=>[task.originAgentId,task.currentOwnerId,task.agentId].some(id=>id?.startsWith('asq_cycle_')))})`).catch(()=>null),bridge:bridge.logs.slice(-2500)},null,2));
  }
  finally {await browser?.close();await bridge?.close();}
}
async function enter(bridge,browser,{onBreak=false,member='asq_cycle_noah',prompt='Implement the scoped check, delegate QA to Tester and review to Reviewer, then return the final reviewed evidence here.'}={}) {
  const workspace=join(process.cwd(),'.codex-artifacts','reliability','collaboration-project');
  const agents=[['noah','Implementer','Frontend Developer'],['eva','Tester','QA Engineer'],['iris','Reviewer','Code Reviewer'],['security','Security','Security Engineer']].map(([key,name,role])=>({id:'asq_cycle_'+key,name,role,status:onBreak && key==='eva'?'paused':'online',...(onBreak && key==='eva'?{onBreak:true}:{}),workspace,skills:[],projects:[{path:workspace}],permissions:{builtInPolicies:{squad_create_channel:'allow'}},instructions:'Use only the assigned disposable project and report evidence.'}));
  await browser.send('Page.addScriptToEvaluateOnNewDocument',{source:`if(location.protocol==='http:' && !localStorage.getItem('cycle.seeded')) {localStorage.setItem('autohandSquad.v1.onboarding',JSON.stringify({version:1,status:'skipped'}));localStorage.setItem('autohandSquad.v1.agents',JSON.stringify(${JSON.stringify(agents)}));localStorage.setItem('autohandSquad.v1.messages',JSON.stringify({}));localStorage.setItem('autohandSquad.v1.tasks',JSON.stringify([]));localStorage.setItem('autohandSquad.v1.improvement',JSON.stringify({enabled:false}));localStorage.setItem('cycle.seeded','true');}`});
  await browser.send('Page.addScriptToEvaluateOnNewDocument',{source:`if(location.protocol==='http:'){const actual=window.fetch.bind(window);window.fetch=(input,options)=>{if(String(input).endsWith('/api/chat/stream') && options?.body){const body=JSON.parse(options.body);const records=JSON.parse(localStorage.getItem('cycle.requests')||'[]');records.push({agentId:body.agentId,requestId:body.requestId,handoffId:body.collaboration?.handoff?.id});localStorage.setItem('cycle.requests',JSON.stringify(records));}return actual(input,options);};}`});
  await reopen(bridge,browser,'/conversations/new?member='+member);
  await until(()=>browser.evaluate(`!!document.querySelector('main textarea')`),'source conversation',60000);
  await browser.fill('main textarea',prompt);
  await until(()=>browser.evaluate(`!!document.querySelector('button[aria-label="Send chat message"]:not(:disabled)')`),'send action ready');
  await browser.click('Send chat message');
}
async function reopen(bridge,browser,path) {await browser.navigate(bridge.origin+path);await until(()=>browser.evaluate(`!!document.querySelector('main textarea')`),'conversation ready after cold navigation',60000);}
const tasks=browser=>browser.evaluate(`JSON.parse(localStorage.getItem('autohandSquad.v1.tasks')||'[]').filter(task=>[task.originAgentId,task.currentOwnerId,task.agentId].some(id=>id?.startsWith('asq_cycle_')))`);
const messages=browser=>browser.evaluate(`JSON.parse(localStorage.getItem('autohandSquad.v1.messages')||'{}')`);
const turns=async bridge=>(await readFile(join(bridge.directory,'turns.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);

await check('delegated review stays on one parent task and returns final evidence to the original conversation','chain',async(bridge,browser)=>{
  await enter(bridge,browser);
  await until(async()=> (await turns(bridge)).some(turn=>turn.name==='Reviewer'),'reviewer dispatched',20000);
  const pending=await tasks(browser);
  assert.equal(pending.length,1,'A second delegation must retain its original parent task.');
  assert.equal(pending[0].workspace,join(process.cwd(),'.codex-artifacts','reliability','collaboration-project'));
  assert.equal(pending[0].handoffs.length,2);assert.notEqual(pending[0].status,'completed','Parent cannot finish while its review is running.');
  const reviewer=(await turns(bridge)).find(turn=>turn.name==='Reviewer');
  assert.ok(reviewer.system.includes(pending[0].id),'Reviewer must receive the same parent context.');
  assert.ok(reviewer.prompt.includes('IMPLEMENTATION_EVIDENCE'));assert.ok(reviewer.prompt.includes('QA_EVIDENCE'));
  assert.ok(reviewer.prompt.includes('return the final reviewed evidence here'),'Original user request must survive the second hop.');
  await writeFile(join(bridge.directory,'release-review'),'continue');
  await until(async()=> (await messages(browser)).asq_cycle_noah?.some(message=>message.body?.includes('REVIEW_EVIDENCE')),'review verdict returned to origin',20000);
  const completed=await tasks(browser);assert.equal(completed.length,1);assert.equal(completed[0].status,'completed');
  assert.equal(completed[0].currentOwnerId,'asq_cycle_noah');
  assert.ok(completed[0].handoffs.every(handoff=>handoff.status==='completed'));
  await bridge.restart();await reopen(bridge,browser,'/conversations/new?member=asq_cycle_noah');
  await until(()=>browser.evaluate(`document.querySelector('main')?.textContent.includes('REVIEW_EVIDENCE')`),'returned verdict after restart');
  assert.equal((await tasks(browser))[0].id,completed[0].id);assert.equal((await turns(bridge)).length,3,'Reopening must not replay completed handoffs.');
  assert.deepEqual(browser.errors,[]);
});
await check('a recipient failure after partial output remains a failed handoff','partial-failure',async(bridge,browser)=>{
  await enter(bridge,browser);
  await until(async()=> (await messages(browser)).asq_cycle_eva?.some(message=>message.status==='error'),'recipient error visible',20000);
  await until(async()=> (await tasks(browser)).some(task=>task.handoffs?.some(handoff=>['failed','completed'].includes(handoff.status))),'handoff terminal result');
  const failed=(await tasks(browser))[0];
  assert.equal(failed.status,'blocked','Partial text cannot turn a provider failure into completion.');
  assert.equal(failed.handoffs[0].status,'failed');assert.match(failed.handoffs[0].failureReason,/QA provider failed/);
  assert.ok(!(await turns(bridge)).some(turn=>turn.name==='Reviewer'));
  assert.deepEqual(browser.errors,[]);
});
await check('Retry checkpoint dispatches once from saved context and returns the reviewed result','partial-failure',async(bridge,browser)=>{
  await enter(bridge,browser);
  await until(async()=> (await tasks(browser))[0]?.handoffs.some(handoff=>handoff.status==='failed'),'failed checkpoint available');
  const failed=(await tasks(browser))[0];
  await writeFile(join(bridge.directory,'scenario'),'chain');
  await writeFile(join(bridge.directory,'release-review'),'continue');
  await reopen(bridge,browser,'/conversations/new?member=asq_cycle_noah&panel=tasks');
  await until(()=>browser.evaluate(`Array.from(document.querySelectorAll('button')).some(button=>button.textContent.trim()==='Retry checkpoint')`),'checkpoint retry control');
  await browser.evaluate(`{const button=Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()==='Retry checkpoint');button.click();button.click();}`);
  await until(async()=> (await turns(bridge)).filter(turn=>turn.name==='Tester').length===2,'one recipient retry dispatched',12000);
  await until(async()=> (await tasks(browser))[0]?.status==='completed','retried checkpoint completed',20000);
  const completed=(await tasks(browser))[0];assert.equal(completed.id,failed.id);
  assert.equal(completed.handoffs[0].id,failed.handoffs[0].id);assert.equal(completed.handoffs[0].attempt,2);
  assert.equal((await turns(bridge)).filter(turn=>turn.name==='Implementer').length,1,'Retry must retain the completed source execution.');
  assert.equal((await turns(bridge)).filter(turn=>turn.name==='Tester').length,2,'Rapid clicks must dispatch one retry.');
  assert.equal((await turns(bridge)).filter(turn=>turn.name==='Reviewer').length,1);
  const requests=await browser.evaluate(`JSON.parse(localStorage.getItem('cycle.requests')||'[]').filter(request=>request.agentId==='asq_cycle_eva')`);
  assert.equal(requests.length,2);assert.equal(requests[0].requestId,requests[1].requestId);assert.equal(requests[1].requestId,completed.handoffs[0].requestId,'Retry must reuse the saved receiving request identity.');
  assert.ok((await messages(browser)).asq_cycle_noah.some(message=>message.body?.includes('REVIEW_EVIDENCE')));
  await bridge.restart();await reopen(bridge,browser,'/conversations/new?member=asq_cycle_noah');
  await until(()=>browser.evaluate(`document.querySelector('main')?.textContent.includes('REVIEW_EVIDENCE')`),'retry verdict retained after restart');
  assert.equal((await turns(bridge)).length,4);assert.deepEqual(browser.errors,[]);
});
await check('Retry on a delegated error message executes its saved checkpoint','partial-failure',async(bridge,browser)=>{
  await enter(bridge,browser);
  await until(async()=> (await tasks(browser))[0]?.handoffs.some(handoff=>handoff.status==='failed'),'failed delegated reply');
  const failed=(await tasks(browser))[0];
  await writeFile(join(bridge.directory,'scenario'),'chain');await writeFile(join(bridge.directory,'release-review'),'continue');
  await browser.evaluate(`{const button=Array.from(document.querySelectorAll('button')).find(button=>button.getAttribute('aria-label')==='Tester' || button.getAttribute('aria-label')?.startsWith('Tester, '));if(!button) throw new Error('Tester sidebar control missing');button.click();}`);
  await until(()=>browser.evaluate(`location.search.includes('member=asq_cycle_eva') && Array.from(document.querySelectorAll('button')).some(button=>button.textContent.trim()==='Retry')`),'delegated message retry');
  await browser.click('Retry');
  await until(async()=> (await tasks(browser))[0]?.status==='completed','message retry completed saved parent');
  assert.equal((await tasks(browser))[0].id,failed.id);assert.equal((await tasks(browser))[0].handoffs[0].id,failed.handoffs[0].id);
  assert.equal((await turns(bridge)).filter(turn=>turn.name==='Implementer').length,1);assert.equal((await turns(bridge)).filter(turn=>turn.name==='Tester').length,2);
  const requests=await browser.evaluate(`JSON.parse(localStorage.getItem('cycle.requests')||'[]').filter(request=>request.agentId==='asq_cycle_eva')`);assert.equal(requests.length,2);assert.equal(requests[0].requestId,requests[1].requestId);
  assert.ok((await messages(browser)).asq_cycle_noah.some(message=>message.body?.includes('REVIEW_EVIDENCE')));assert.deepEqual(browser.errors,[]);
});
await check('Retry on the source-conversation handoff error preserves completed implementation','partial-failure',async(bridge,browser)=>{
  await enter(bridge,browser);
  await until(async()=> (await tasks(browser))[0]?.handoffs.some(handoff=>handoff.status==='failed'),'failed receiving checkpoint');
  const failed=(await tasks(browser))[0];
  await writeFile(join(bridge.directory,'scenario'),'chain');await writeFile(join(bridge.directory,'release-review'),'continue');
  await until(()=>browser.evaluate(`Array.from(document.querySelectorAll('button')).some(button=>button.textContent.trim()==='Retry')`),'source handoff error retry control');
  await browser.click('Retry');
  await until(async()=> (await tasks(browser)).some(task=>task.status==='completed'),'source retry returned verdict',20000);
  const completed=await tasks(browser);assert.equal(completed.length,1,'Retry must retain the existing parent rather than create another task.');assert.equal(completed[0].id,failed.id);
  assert.equal((await turns(bridge)).filter(turn=>turn.name==='Implementer').length,1,'Retrying the recipient error in the source conversation must not execute the completed source again.');
  assert.equal((await turns(bridge)).filter(turn=>turn.name==='Tester').length,2);
  assert.ok((await messages(browser)).asq_cycle_noah.some(message=>message.body?.includes('REVIEW_EVIDENCE')));
  const executions=(await turns(bridge)).length;
  await browser.click('Retry');
  await until(async()=> (await messages(browser)).asq_cycle_noah.some(message=>message.body?.includes('checkpoint is completed')),'completed checkpoint explained rather than replayed');
  assert.equal((await turns(bridge)).length,executions);assert.deepEqual(browser.errors,[]);
});
await check('parallel review results preserve siblings and complete the parent only after both verdicts return','parallel-review',async(bridge,browser)=>{
  await enter(bridge,browser);
  await until(async()=> {const seen=await turns(bridge);return ['Reviewer','Security'].every(name=>seen.some(turn=>turn.name===name));},'parallel reviewers dispatched',20000);
  const pending=await tasks(browser);assert.equal(pending.length,1);assert.equal(pending[0].handoffs.length,3);
  assert.equal(new Set(pending[0].handoffs.map(handoff=>handoff.id)).size,3);
  await writeFile(join(bridge.directory,'release-review'),'continue');
  await until(async()=> (await tasks(browser))[0]?.handoffs.some(handoff=>handoff.toAgentId==='asq_cycle_iris' && handoff.status==='completed'),'first parallel verdict');
  const waiting=(await tasks(browser))[0];assert.equal(waiting.status,'running');assert.equal(waiting.handoffs.length,3);
  assert.equal(waiting.handoffs.find(handoff=>handoff.toAgentId==='asq_cycle_security').status,'accepted');
  assert.ok(!(await messages(browser)).asq_cycle_noah.some(message=>message.body?.includes('REVIEW_EVIDENCE')),'The source result must wait for all requested review.');
  await writeFile(join(bridge.directory,'release-security'),'continue');
  await until(async()=> (await messages(browser)).asq_cycle_noah.some(message=>message.body?.includes('REVIEW_EVIDENCE') && message.body.includes('SECURITY_EVIDENCE')),'combined verdict returned to source',20000);
  const completed=(await tasks(browser))[0];assert.equal(completed.status,'completed');assert.equal(completed.handoffs.length,3);
  assert.ok(completed.handoffs.every(handoff=>handoff.status==='completed'));
  assert.equal(new Set(completed.timeline.filter(event=>event.type==='handoff.created').map(event=>event.id)).size,3);
  await bridge.restart();await reopen(bridge,browser,'/conversations/new?member=asq_cycle_noah');
  await until(()=>browser.evaluate(`document.querySelector('main')?.textContent.includes('SECURITY_EVIDENCE')`),'parallel verdict after restart');
  assert.equal((await turns(bridge)).length,4);assert.equal((await tasks(browser))[0].handoffs.length,3);
  assert.deepEqual(browser.errors,[]);
});
await check('a recipient on a break refuses delegation without task transfer or runtime dispatch','break',async(bridge,browser)=>{
  assert.equal((await bridge.api('/api/members/asq_cycle_eva/break','POST',{active:true})).success,true);
  await enter(bridge,browser,{onBreak:true});
  await until(async()=> (await messages(browser)).asq_cycle_noah?.some(message=>message.declined==='break'),'visible recipient break refusal',20000);
  assert.equal((await tasks(browser)).length,0);assert.equal((await turns(bridge)).length,1);
  assert.ok(!(await turns(bridge)).some(turn=>turn.name==='Tester'));
  assert.deepEqual(browser.errors,[]);
});
await check('parallel mentions from the original member share one parent task','root-parallel',async(bridge,browser)=>{
  await enter(bridge,browser);
  await until(async()=> (await turns(bridge)).some(turn=>turn.name==='Security'),'root parallel work accepted');
  const pending=(await tasks(browser));assert.equal(pending.length,1,'Root parallel mentions must share one parent.');
  assert.equal(pending[0].handoffs.length,2);
  await writeFile(join(bridge.directory,'release-security'),'continue');
  await until(async()=> (await tasks(browser))[0]?.status==='completed','both root results returned');
  assert.equal((await tasks(browser))[0].currentOwnerId,'asq_cycle_noah');
  assert.equal((await turns(bridge)).length,3);assert.deepEqual(browser.errors,[]);
});
await check('a busy recipient declines a second handoff and can retry after its current request finishes','busy',async(bridge,browser)=>{
  await enter(bridge,browser,{member:'asq_cycle_eva',prompt:'BUSY_MARKER: hold this independent request.'});
  await until(async()=> (await turns(bridge)).some(turn=>turn.prompt.includes('BUSY_MARKER')),'independent recipient request active');
  const competing=await bridge.api('/api/chat','POST',{agentId:'asq_cycle_eva',agent:{id:'asq_cycle_eva',name:'Tester'},prompt:'Concurrent receiving request',workspace:join(process.cwd(),'.codex-artifacts','reliability','collaboration-project'),collaboration:{role:'receiver'}});
  assert.equal(competing.success,true,JSON.stringify(competing));assert.equal(competing.data.declined,'busy','The bridge must reject a busy handoff from another client too.');
  assert.equal((await turns(bridge)).filter(turn=>turn.name==='Tester').length,1);
  // Normal sidebar navigation retains the app and the in-flight request.
  // A full page navigation instead disconnects and stops the previous stream.
  await browser.click('Implementer');
  await until(()=>browser.evaluate(`location.search.includes('member=asq_cycle_noah')`),'source selected from sidebar');
  await browser.fill('main textarea','Implement the scoped check and ask Tester for independent QA.');
  await until(()=>browser.evaluate(`!!document.querySelector('button[aria-label="Send chat message"]:not(:disabled)')`),'source send ready');
  await browser.click('Send chat message');
  await until(async()=> (await tasks(browser))[0]?.handoffs.some(handoff=>handoff.status==='failed'),'busy handoff refused');
  const refused=(await tasks(browser))[0];assert.equal(refused.status,'blocked');assert.match(refused.handoffs[0].failureReason,/already working/);
  assert.equal((await turns(bridge)).filter(turn=>turn.name==='Tester').length,1,'A busy recipient must not receive a second runtime execution.');
  await writeFile(join(bridge.directory,'release-qa'),'continue');
  await until(async()=> (await messages(browser)).asq_cycle_eva.some(message=>message.body==='BUSY_REQUEST_FINISHED'),'busy request finished');
  await writeFile(join(bridge.directory,'release-review'),'continue');
  await reopen(bridge,browser,'/conversations/new?member=asq_cycle_noah&panel=tasks');
  await until(()=>browser.evaluate(`Array.from(document.querySelectorAll('button')).some(button=>button.textContent.trim()==='Retry checkpoint')`),'busy checkpoint retry');
  await browser.click('Retry checkpoint');
  await until(async()=> (await tasks(browser))[0]?.status==='completed','busy checkpoint resumed explicitly');
  assert.equal((await tasks(browser))[0].id,refused.id);assert.equal((await turns(bridge)).filter(turn=>turn.name==='Tester').length,2);
  assert.deepEqual(browser.errors,[]);
});
await check('interrupted accepted review is blocked after browser closure and bridge restart','chain',async(bridge,browser)=>{
  await enter(bridge,browser);
  await until(async()=> (await turns(bridge)).some(turn=>turn.name==='Reviewer'),'review accepted before interruption',20000);
  await until(async()=> (await messages(browser)).asq_cycle_iris?.some(message=>message.status==='loading'),'in-flight recipient transcript persisted');
  const accepted=(await tasks(browser))[0];assert.equal(accepted.status,'running');
  // Discard coordinator callbacks as an abrupt app close would; graceful
  // navigation can otherwise persist a valid network-error result first.
  await browser.send('Emulation.setScriptExecutionDisabled',{value:true});
  await browser.navigate('about:blank');
  await browser.send('Emulation.setScriptExecutionDisabled',{value:false});
  await bridge.restart();
  await reopen(bridge,browser,'/conversations/new?member=asq_cycle_noah');
  await until(async()=> (await messages(browser)).asq_cycle_iris?.some(message=>message.interrupted && message.status==='error'),'recipient transcript repaired after restart',20000);
  const recovered=(await tasks(browser))[0];
  assert.equal(recovered.id,accepted.id);
  assert.equal(recovered.status,'blocked','Lost orchestration must not remain an active task after restart.');
  assert.ok(recovered.handoffs.some(handoff=>handoff.status==='failed' && /interrupted|restart/i.test(handoff.failureReason)),'The checkpoint must explain the interruption and offer explicit recovery.');
  assert.equal((await turns(bridge)).length,3,'Restart must not silently replay accepted work.');
  await writeFile(join(bridge.directory,'release-review'),'continue');
  await reopen(bridge,browser,'/conversations/new?member=asq_cycle_noah&panel=tasks');
  await until(()=>browser.evaluate(`Array.from(document.querySelectorAll('button')).some(button=>button.textContent.trim()==='Retry checkpoint')`),'interrupted checkpoint retry');
  await browser.click('Retry checkpoint');
  await until(async()=> (await messages(browser)).asq_cycle_noah.some(message=>message.body?.includes('REVIEW_EVIDENCE')),'review returned through saved QA checkpoint');
  assert.equal((await tasks(browser))[0].status,'completed');
  assert.equal((await turns(bridge)).filter(turn=>turn.name==='Implementer').length,1);
  assert.equal((await turns(bridge)).filter(turn=>turn.name==='Tester').length,1,'Completed QA must not execute again when review is retried.');
  assert.equal((await turns(bridge)).filter(turn=>turn.name==='Reviewer').length,2);
  assert.deepEqual(browser.errors,[]);
});
await check('review retry preserves a confirmed QA channel effect and its purpose execution','receipt-retry',async(bridge,browser)=>{
  await enter(bridge,browser);
  await until(async()=> (await tasks(browser))[0]?.handoffs.some(handoff=>handoff.toAgentId==='asq_cycle_iris' && handoff.status==='failed'),'review failed after confirmed channel effect',20000);
  const before=JSON.parse(await readFile(join(bridge.directory,'squad','channels.json'),'utf8'));
  assert.equal(before.channels.filter(channel=>channel.name==='checkpoint-evidence').length,1);
  const receipts=before.agentChannelActions;assert.equal(receipts.length,1);assert.equal(receipts[0].status,'created');assert.ok(receipts[0].deliveries.every(delivery=>delivery.status==='completed'));
  const qaCalls=(await turns(bridge)).filter(turn=>turn.name==='Tester').length;assert.equal(qaCalls,2,'QA and its real channel-purpose dispatch must both execute.');
  await bridge.restart();await writeFile(join(bridge.directory,'release-review'),'continue');
  await reopen(bridge,browser,'/conversations/new?member=asq_cycle_noah');
  await until(()=>browser.evaluate(`Array.from(document.querySelectorAll('button')).some(button=>button.textContent.trim()==='Retry')`),'source error child retry control');
  await browser.click('Retry');
  await until(async()=> (await messages(browser)).asq_cycle_noah.some(message=>message.body?.includes('REVIEW_EVIDENCE')),'review returned through confirmed QA result');
  assert.equal((await tasks(browser))[0].status,'completed');
  const after=JSON.parse(await readFile(join(bridge.directory,'squad','channels.json'),'utf8'));
  assert.deepEqual(after.agentChannelActions,receipts,'Committed channel-action receipts must not be replayed by review retry.');
  assert.equal(after.channels.filter(channel=>channel.name==='checkpoint-evidence').length,1);assert.equal(after.messages.length,before.messages.length);
  assert.equal((await turns(bridge)).filter(turn=>turn.name==='Tester').length,qaCalls);assert.equal((await turns(bridge)).filter(turn=>turn.name==='Reviewer').length,2);
  assert.deepEqual(browser.errors,[]);
});
if(failures.length){console.error(JSON.stringify(failures,null,2));process.exitCode=1;}
else console.log(checks+' collaboration cycle checks passed (real browser/bridge and controlled runtime, no live provider).');
