import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { roleTemplates } from '../src/lib/member-profiles.js';
import { builtInPoliciesForRank } from '../src/lib/permission-policy.js';
import { startBridge, startBrowser, until } from './lib/reliability-browser.mjs';
import { hasFileInspection } from './lib/live-collaboration-evidence.mjs';

// Explicit provider check. Prepared role roster is seeded in disposable browser
// state; model replies and API responses are never replaced.
const source=process.env.SQUAD_LIVE_CONFIG || process.env.AUTOHAND_USER_CONFIG_PATH || join(process.env.AUTOHAND_HOME || join(homedir(),'.autohand'),'config.json');
const original=JSON.parse(await readFile(source,'utf8'));
const evidence=join(process.cwd(),'.codex-artifacts','reliability');await mkdir(evidence,{recursive:true});
const workspace=await mkdtemp(join(evidence,'live-collaboration-project-'));
await writeFile(join(workspace,'README.md'),'# Disposable collaboration proof\n\nMarker: SQUAD_COLLABORATION_983\n\nImplement clamp(value, min, max) in clamp.mjs as a named export. Return min below the range, max above it, and value within it. Throw RangeError when min > max. Independent tests belong in clamp.test.mjs using node:test. No dependencies or git operations.\n');
const members=[['builder','Builder','frontend-developer'],['verifier','Verifier','common-qa-engineer'],['reviewer','Reviewer','solution-architect']].map(([id,name,roleId],index)=>{
  const role=roleTemplates.find(role=>role.id===roleId);
  return {id:'asq_live_'+id,name,role:role.title,employeeType:role.id,status:'online',workspace,projects:[{path:workspace}],skills:[],brainCard:role.brainCard,profileFiles:role.profileFiles,instructions:role.starter+'\nFor this check, work only in the assigned disposable project. '+(index===0?'Implement clamp.mjs, then mention only @Verifier with a clear request to write/run independent tests and involve Reviewer.':index===1?'Verify the earlier implementation by writing clamp.test.mjs using node:test and running node --test clamp.test.mjs. Do not edit clamp.mjs. Then mention only @Reviewer to inspect both files and the test evidence.':'Independently read clamp.mjs and clamp.test.mjs, run the tests if useful, and return REVIEW_VERDICT with findings, observed test result and SQUAD_COLLABORATION_983. Do not change files or delegate further.'),permissions:{permissionMode:'restricted',builtInToolPolicyEnabled:true,builtInPolicies:{...builtInPoliciesForRank(2),run_command:'allow',shell:'allow',write_file:index<2?'allow':'block',apply_patch:index<2?'allow':'block',delete_path:'block',git_commit:'block',git_push:'block',squad_create_channel:'block'}}};
});
const observations=[];
const capturedTurns=new Map();
const handledErrors=new Set();
let lastSnapshot;
const save=extra=>writeFile(join(evidence,'live-collaboration.json'),JSON.stringify({source:'real bridge/browser/provider; prepared role roster, no response fixtures',workspace,observations,...(lastSnapshot?{snapshot:lastSnapshot}:{}),...extra},null,2),{mode:0o600});
const bridge=await startBridge({prepare:async directory=>{
  const config=Object.fromEntries(['provider','auth','autohandai','openrouter','openai','ollama','llmgateway','bedrock','deepseek','zai','nvidia','cerebras'].filter(key=>original[key]!==undefined).map(key=>[key,original[key]]));
  config.mcp={servers:[]};config.hooks={};await writeFile(join(directory,'config.json'),JSON.stringify(config),{mode:0o600});
  return {AUTOHAND_AGENT_SDK_ENTRY:'',AUTOHAND_AGENT_SDK_DIR:''};
}});
let browser,progress;
try {
  for(const member of members) assert.equal((await bridge.api('/api/agents/provision','POST',{agentId:member.id,agent:member,workspace})).success,true,'Real role provisioning must succeed.');
  browser=await startBrowser();
  await browser.send('Page.addScriptToEvaluateOnNewDocument',{source:`
    if(location.protocol!=='http:') throw new Error('Live check requires its isolated HTTP origin.');
    if(!localStorage.getItem('live.cycle.seeded')) {localStorage.setItem('autohandSquad.v1.onboarding',JSON.stringify({version:1,status:'skipped'}));localStorage.setItem('autohandSquad.v1.agents',JSON.stringify(${JSON.stringify(members)}));localStorage.setItem('autohandSquad.v1.improvement',JSON.stringify({enabled:false}));localStorage.setItem('live.cycle.seeded','true');}
    window.liveTurns=[];const original=window.fetch.bind(window);window.fetch=async(input,options)=>{
      const response=await original(input,options),path=new URL(typeof input==='string'?input:input.url,location.origin).pathname;
      if(path==='/api/chat/stream') {
        const request=JSON.parse(options.body);const record={captureId:crypto.randomUUID(),agentId:request.agentId,requestId:request.requestId,events:0};window.liveTurns.push(record);
        (async()=>{const decoder=new TextDecoder();let pending='';for await(const chunk of response.clone().body) {
          pending+=decoder.decode(chunk,{stream:true}).replaceAll('\\r\\n','\\n');let end;
          while((end=pending.indexOf('\\n\\n'))>=0){const frame=pending.slice(0,end);pending=pending.slice(end+2);const kind=frame.match(/^event: (.+)$/m)?.[1];const data=frame.split('\\n').filter(line=>line.startsWith('data: ')).map(line=>line.slice(6)).join('\\n');if(!data)continue;record.events++;if(kind==='done')record.result=JSON.parse(data);if(kind==='error')record.error=JSON.parse(data);}
        }})().catch(error=>{record.captureError=error.message;});
      }return response;
    };`});
  await browser.navigate(bridge.origin+'/conversations/new?member=asq_live_builder');
  await until(()=>browser.evaluate(`!!document.querySelector('main textarea')`),'real implementation conversation');
  const prompt='Read README.md and write clamp.mjs exactly as described. Your only implementation work is that module; Verifier owns the test file and test execution. After saving, finish your reply with an immediate handoff to Verifier by prefixing that name with an at sign. Do not prefix any other teammate with an at sign: every mention starts that member immediately. Describe the later review step using the plain name Reviewer. Verifier must write and run node:test cases for below, within, above and invalid bounds, then delegate to Reviewer for independent code/test review after tests finish. Reviewer must report REVIEW_VERDICT. Return the final reviewed evidence to this conversation. Work only in this disposable project; no dependencies or git operations.';
  await browser.fill('main textarea',prompt);
  await until(()=>browser.evaluate(`!!document.querySelector('button[aria-label="Send chat message"]:not(:disabled)')`),'live send action ready');
  await browser.click('Send chat message');
  await until(()=>browser.evaluate(`JSON.parse(localStorage.getItem('autohandSquad.v1.messages')||'{}').asq_live_builder?.some(message=>message.role==='user')`),'real implementation request dispatched');
  await save({status:'in progress'});
  progress=setInterval(()=>console.log('Waiting for real implementation, independent tests and review'),30000);
  const deadline=Date.now()+1800000;
  let result,retries=0;
  while(Date.now()<deadline) {
    const snapshot=await browser.evaluate(`({turns:window.liveTurns,messages:JSON.parse(localStorage.getItem('autohandSquad.v1.messages')||'{}'),tasks:JSON.parse(localStorage.getItem('autohandSquad.v1.tasks')||'[]').filter(task=>task.originAgentId==='asq_live_builder')})`);
    for(const turn of snapshot.turns) capturedTurns.set(turn.captureId,turn);
    snapshot.turns=[...capturedTurns.values()];
    lastSnapshot=snapshot;
    await save({status:'in progress',snapshot});
    const failed=snapshot.turns.find(turn=>(turn.error || turn.captureError) && !handledErrors.has(turn.captureId));
    const messageFailure=members.flatMap(member=>snapshot.messages[member.id]||[]).find(message=>message.status==='error' && !handledErrors.has(message.id));
    if(failed || messageFailure) {
      const reason=messageFailure?.body || failed?.error?.error || failed?.captureError || 'Live recipient failed.';
      if(!/uncached input-token throughput.*(reached|exhausted)/is.test(reason) || retries>=3) throw new Error(reason);
      retries++;
      if(failed) handledErrors.add(failed.captureId);
      if(messageFailure) handledErrors.add(messageFailure.id);
      observations.push({providerFailure:reason,recovery:'test driver waits for the next minute, then presses the normal explicit Retry control',retry:retries});
      console.log('Observed provider minute limit; waiting before explicit UI retry '+retries);
      // This is a user action in the browser probe, not product auto replay.
      const resumeAt=Date.now()+65000;
      while(Date.now()<resumeAt) await new Promise(resolve=>setTimeout(resolve,1000));
      for(const turn of await browser.evaluate('window.liveTurns')) capturedTurns.set(turn.captureId,turn);
      const checkpoint=await browser.evaluate(`JSON.parse(localStorage.getItem('autohandSquad.v1.tasks')||'[]').find(task=>task.originAgentId==='asq_live_builder' && task.handoffs?.some(handoff=>handoff.status==='failed'))`);
      await browser.navigate(bridge.origin+'/conversations/new?member=asq_live_builder'+(checkpoint?'&panel=tasks':''));
      const label=checkpoint?'Retry checkpoint':'Retry';
      await until(()=>browser.evaluate(`Array.from(document.querySelectorAll('button')).some(button=>button.textContent.trim()===${JSON.stringify(label)})`),'explicit provider retry control',30000);
      await browser.click(label);
      continue;
    }
    const parent=snapshot.tasks[0];
    if(parent?.status==='blocked') throw new Error(parent.summary || 'Live collaboration is blocked.');
    if(parent?.status==='completed' && snapshot.messages.asq_live_builder?.some(message=>message.body?.includes('REVIEW_VERDICT') && message.id?.endsWith('-result'))) {result=snapshot;break;}
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  assert.ok(result,'Live three-role cycle must return a reviewed result within the observation deadline.');
  assert.equal(result.tasks.length,1);assert.equal(result.tasks[0].handoffs.length,2);assert.ok(result.tasks[0].handoffs.every(handoff=>handoff.status==='completed'));
  assert.deepEqual(result.tasks[0].handoffs.map(handoff=>[handoff.fromAgentId,handoff.toAgentId]),[['asq_live_builder','asq_live_verifier'],['asq_live_verifier','asq_live_reviewer']],'Implementation, independent QA and review must run in order.');
  for(const member of members) {
    const attempts=result.turns.filter(turn=>turn.agentId===member.id);
    const turns=attempts.filter(turn=>turn.result && !turn.error && !turn.result.error && !/uncached input-token throughput.*(reached|exhausted)/is.test(turn.result.reply||''));
    assert.equal(turns.length,1,'Each named role must have exactly one successful execution; refused attempts stay in evidence.');
    assert.ok(turns[0].result,'Each named role must have a real execution receipt.');
    assert.ok(turns[0].result.trace?.toolCalls?.length,'Each named role must inspect or act through actual tools.');
    observations.push({member:member.name,role:member.role,result:turns[0].result,attempts:attempts.length});
  }
  assert.ok(observations.find(row=>row.member==='Verifier').result.trace.toolCalls.some(call=>['run_command','shell'].includes(call.name)),'QA must actually execute tests.');
  for(const file of ['clamp.mjs','clamp.test.mjs']) assert.ok(hasFileInspection(observations.find(row=>row.member==='Reviewer').result.trace,file),'Reviewer must actually inspect '+file+'.');
  const module=await readFile(join(workspace,'clamp.mjs'),'utf8'),tests=await readFile(join(workspace,'clamp.test.mjs'),'utf8');
  assert.match(module,/clamp/);assert.match(tests,/node:test/);
  const verification=spawnSync(process.execPath,['--test','clamp.test.mjs'],{cwd:workspace,encoding:'utf8',timeout:30000});
  assert.equal(verification.status,0,verification.stdout+verification.stderr);
  const independent=spawnSync(process.execPath,['--input-type=module','-e',"import assert from 'node:assert/strict';import {clamp} from './clamp.mjs';assert.equal(clamp(-2,0,3),0);assert.equal(clamp(2,0,3),2);assert.equal(clamp(5,0,3),3);assert.throws(()=>clamp(1,3,0),RangeError);"],{cwd:workspace,encoding:'utf8',timeout:30000});
  assert.equal(independent.status,0,independent.stderr);
  observations.push({independentVerification:verification.stdout,contractVerification:'lower/within/upper/invalid bounds passed'});
  await browser.screenshot(join(evidence,'live-collaboration.png'));
  await bridge.restart();await browser.navigate(bridge.origin+'/conversations/new?member=asq_live_builder');
  await until(()=>browser.evaluate(`document.querySelector('main')?.textContent.includes('REVIEW_VERDICT')`),'provider verdict after restart');
  assert.deepEqual(browser.errors,[]);await save({status:'passed',snapshot:result,reopenedAfterRestart:true});
  console.log('PASS real implementation, independent QA execution and review return on one persisted task; files and tests verified, verdict survives restart');
} catch(error) {await save({status:'failed',error:error.message});await browser?.screenshot(join(evidence,'live-collaboration-failure.png')).catch(()=>{});throw error;}
finally {if(progress)clearInterval(progress);await browser?.close();await bridge.close();}
