#!/usr/bin/env node
// Real bridge + disposable executable fixtures. No vendor, credentials,
// installed app, or provider requests are used.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { BREAK_REPLY } from '../server/members/availability.mjs';

const directory = await mkdtemp(join(tmpdir(), 'squad-goal-http-'));
const callsFile = join(directory, 'calls.jsonl');
const fake = join(directory, 'fixture-codex');
const fakeSdk = join(directory, 'fixture-sdk.mjs');
const rootDir = resolve(new URL('..', import.meta.url).pathname);
const socket = createServer();
await new Promise(resolve => socket.listen(0,'127.0.0.1',resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const origin = `http://127.0.0.1:${port}`;
let bridge;
let logs = '';
const delay = (ms) => new Promise(resolve => setTimeout(resolve,ms));
async function until(fn, label, timeout=7000) {
  const end=Date.now()+timeout;
  while(Date.now()<end){const value=await fn().catch(()=>null);if(value)return value;await delay(15);}
  throw new Error(`${label} timed out; bridge: ${logs.slice(-2500)}`);
}
const api = async(path,body)=>{
  const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await response.json();return {status:response.status,...data};
};
const calls=async()=> (await readFile(callsFile,'utf8').catch(()=> '')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
const member=(id)=>({id,name:id,harness:{id:'codex',executablePath:fake},projects:[{path:rootDir}]});
const payload=(id,prompt)=>({agentId:id,agent:member(id),workspace:rootDir,prompt,profile:'Use the chosen permission rules.'});
try {
  await mkdir(join(directory,'codex'),{recursive:true});
  await writeFile(join(directory,'codex','auth.json'),'{}');
  await writeFile(fake,`#!${process.execPath}
const fs=require('node:fs');
const file=${JSON.stringify(callsFile)};
const args=process.argv.slice(2);
if(args[0]==='--version'){console.log('codex 1.0.0');process.exit(0);}
if(args[0]==='login'){console.log('Logged in using fixture');process.exit(0);}
if(args[0]==='auth'){console.log(JSON.stringify({loggedIn:true,authMethod:'fixture'}));process.exit(0);}
const claude=args[0]==='-p';
const prompt=claude?args[1]:args.at(-1);
const member=process.env.AUTOHAND_SQUAD_MEMBER;
const previous=fs.existsSync(file)?fs.readFileSync(file,'utf8').trim().split('\\n').filter(Boolean).map(JSON.parse):[];
const turn=previous.filter(x=>x.member===member&&x.kind==='start').length+1;
const append=x=>fs.appendFileSync(file,JSON.stringify(x)+'\\n');
append({kind:'start',member,args,cwd:process.cwd()});
process.on('SIGTERM',()=>{append({kind:'abort',member});process.exit(143);});
const emit=x=>console.log(JSON.stringify(x));
if(claude){
 emit({type:'system',subtype:'init',session_id:'fixture-'+member});
 emit({type:'assistant',message:{content:[{type:'tool_use',id:'plan',name:'TodoWrite',input:{todos:[{content:'Inspect selected workspace artifact',status:'in_progress'}]}}]}});
 emit({type:'user',message:{content:[{type:'tool_result',tool_use_id:'plan',content:'Updated checklist'}]}});
}else{
 emit({type:'thread.started',thread_id:'fixture-'+member});
 emit({type:'item.completed',item:{id:'plan',type:'todo_list',items:[{text:'Inspect selected workspace artifact',completed:false}]}});
}
if(prompt.includes('HOLD fixture')){setTimeout(()=>process.exit(0),45000);return;}
const isGoal=prompt.includes('Pursue this explicit goal');
const report={status:'completed',summary:'Selected workspace verified.',checklist:[{id:'verify',title:'Inspect selected workspace artifact',status:'completed'}],evidence:['Fixture observed selected workspace']};
const text=isGoal&&turn===1?'First step inspected; work remains.':isGoal?'Verified. <squad_goal>'+JSON.stringify(report)+'</squad_goal>':'Inspected. <squad_progress>'+JSON.stringify({items:report.checklist})+'</squad_progress>';
const finishReply=()=>{if(claude){
 emit({type:'assistant',message:{id:'reply',content:[{type:'text',text}]}});
 emit({type:'result',subtype:'success'});
}else{
 emit({type:'item.completed',item:{id:'reply',type:'agent_message',text}});
 emit({type:'turn.completed'});
}};
if(prompt.includes('SLOW fixture'))setTimeout(finishReply,150);else finishReply();
`);
  await writeFile(fakeSdk,`
import {appendFileSync} from 'node:fs';
const file=${JSON.stringify(callsFile)};
const append=(x)=>appendFileSync(file,JSON.stringify(x)+'\\n');
export class AutohandSDK {
 constructor(options){this.options=options;this.turn=0;this.member=options.envVars.AUTOHAND_CLIENT_NAME.replace('autohand-squad-','');}
 async start(){append({kind:'sdk-start',member:this.member,cwd:this.options.cwd,profile:this.options.appendSystemPrompt});}
 async *streamPrompt({message}){
  this.turn++;append({kind:'sdk-turn',member:this.member,cwd:this.options.cwd,message});
  yield {type:'tool_start',toolId:'plan',toolName:'todo_write',args:{tasks:[{content:'Verify saved artifact bytes',status:'in_progress',activeForm:'Verifying saved artifact bytes'}]}};
  yield {type:'tool_end',toolId:'plan',toolName:'todo_write',success:true};
  if(message.includes('HOLD fixture')){await new Promise(resolve=>this.waiter=resolve);return;}
  const report={status:'completed',summary:'SDK workspace verified.',checklist:[{id:'verify',title:'Verify saved artifact bytes',status:'completed'}],evidence:['Fixture observed SDK workspace']};
  yield {type:'message_end',content:this.turn===1?'SDK first step inspected; work remains.':'Verified. <squad_goal>'+JSON.stringify(report)+'</squad_goal>'};
 }
 async interrupt(){append({kind:'sdk-abort',member:this.member});this.waiter?.();}
 async close(){this.waiter?.();}
}
`);
  await chmod(fake,0o700);
  bridge=spawn(process.execPath,['server.mjs','--host','127.0.0.1','--port',String(port)],{
    cwd:rootDir,env:{...process.env,AUTOHAND_SQUAD_HOME:join(directory,'squad'),AUTOHAND_SQUAD_APP_STATE_DIR:join(directory,'app'),AUTOHAND_HOME:join(directory,'autohand'),AUTOHAND_USER_CONFIG_PATH:join(directory,'config.json'),CODEX_HOME:join(directory,'codex'),OPENAI_API_KEY:'fixture-only-no-provider',ANTHROPIC_API_KEY:'fixture-only-no-provider',AUTOHAND_AGENT_SDK_DIR:directory,AUTOHAND_AGENT_SDK_ENTRY:fakeSdk},stdio:['ignore','pipe','pipe'],
  });
  bridge.stdout.on('data',data=>logs+=data);bridge.stderr.on('data',data=>logs+=data);
  await until(async()=>{const r=await api('/api/goals');return r.success;},'bridge start');
  const streamResponse=await fetch(origin+'/api/chat/stream',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...payload('pursuit','Verify selected workspace'),mode:'goal'})});
  assert.equal(streamResponse.status,200);
  const sse=await streamResponse.text();
  const doneBlock=sse.split('\n\n').find(block=>block.startsWith('event: done\n'));
  assert.ok(doneBlock,`final done missing: ${sse}`);
  const done=JSON.parse(doneBlock.split('\ndata: ')[1]);
  assert.equal(done.goal.status,'completed',JSON.stringify(done.goal));assert.equal(done.goal.turnCount,2);assert.equal(done.reply,'Selected workspace verified.');
  assert.ok(sse.includes('event: progress'));assert.equal((sse.match(/event: done\n/g)||[]).length,1);
  const visibleMessages=sse.split('\n\n').filter(b=>b.startsWith('event: sdk\n')).map(b=>JSON.parse(b.split('\ndata: ')[1])).filter(e=>e.type==='message_end');
  assert.ok(visibleMessages.every(e=>!e.content.includes('<squad_')),'private goal report is hidden');
  const invocations=(await calls()).filter(c=>c.member==='pursuit'&&c.kind==='start');
  assert.equal(invocations.length,2);assert.equal(invocations[0].cwd,rootDir);const execAt=invocations[1].args.indexOf('exec');assert.ok(execAt>=0,'codex exec present after any global -c overrides (ADR-0104)');assert.deepEqual(invocations[1].args.slice(execAt,execAt+3),['exec','resume','fixture-pursuit']);
  assert.equal((await api('/api/goals?agentId=pursuit')).data.length,1);

  const claudeLaunch=payload('claude-pursuit','Verify selected workspace');claudeLaunch.agent.harness.id='claude';
  const claudeResponse=await fetch(origin+'/api/chat/stream',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...claudeLaunch,mode:'goal'})});
  const claudeSse=await claudeResponse.text();
  const claudeDone=JSON.parse(claudeSse.split('\n\n').find(b=>b.startsWith('event: done\n')).split('\ndata: ')[1]);
  assert.equal(claudeDone.goal.status,'completed',JSON.stringify(claudeDone.goal));assert.equal(claudeDone.goal.turnCount,2);assert.equal(claudeDone.goal.harness,'claude');
  assert.ok(claudeSse.includes('event: progress'));
  const claudeCalls=(await calls()).filter(c=>c.member==='claude-pursuit'&&c.kind==='start');
  assert.ok(claudeCalls[1].args.includes('--resume'));assert.equal(claudeCalls[1].args[claudeCalls[1].args.indexOf('--resume')+1],'fixture-claude-pursuit');

  // A disposable usable token selects the fake SDK; no provider ever receives it.
  await writeFile(join(directory,'config.json'),JSON.stringify({provider:'autohandai',auth:{token:'fixture-only-no-provider'},autohandai:{model:'auto'}}));
  const sdkLaunch=payload('sdk-pursuit','Verify SDK workspace');sdkLaunch.agent.harness={id:'autohand'};
  const sdkResponse=await fetch(origin+'/api/chat/stream',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...sdkLaunch,mode:'goal'})});
  const sdkSse=await sdkResponse.text();
  const sdkDone=JSON.parse(sdkSse.split('\n\n').find(b=>b.startsWith('event: done\n')).split('\ndata: ')[1]);
  assert.equal(sdkDone.goal.status,'completed',JSON.stringify(sdkDone.goal));assert.equal(sdkDone.goal.turnCount,2);assert.equal(sdkDone.goal.harness,'autohand');
  assert.equal((await calls()).filter(c=>c.member==='sdk-pursuit'&&c.kind==='sdk-start').length,1,'goal continuation reuses the warm SDK instance');
  assert.equal((await calls()).filter(c=>c.member==='sdk-pursuit'&&c.kind==='sdk-turn').length,2);
  assert.ok(sdkSse.includes('event: progress'));

  const sdkHold=payload('sdk-break','HOLD fixture');sdkHold.agent.harness={id:'autohand'};
  const sdkStarted=await api('/api/chat',{...sdkHold,mode:'goal'});
  await until(async()=> (await calls()).some(c=>c.member==='sdk-break'&&c.kind==='sdk-turn'),'SDK in-flight turn');
  await api('/api/members/sdk-break/break',{active:true});
  await until(async()=> (await calls()).some(c=>c.member==='sdk-break'&&c.kind==='sdk-abort'),'SDK interrupt');
  assert.equal((await api('/api/goals/'+sdkStarted.data.goalId)).data.status,'paused');

  const detached=await fetch(origin+'/api/chat/stream',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...payload('detached','SLOW fixture'),mode:'goal'})});
  const reader=detached.body.getReader();const first=await reader.read();
  const firstEvent=new TextDecoder().decode(first.value);
  const detachedId=JSON.parse(firstEvent.split('\ndata: ')[1].split('\n\n')[0]).id;
  await reader.cancel();
  const detachedGoal=await until(async()=>{const g=(await api('/api/goals/'+detachedId)).data;return g.status==='completed'?g:null;},'goal after browser disconnect');
  assert.equal(detachedGoal.turnCount,2,'disconnect detaches presentation; persisted pursuit continues');

  const regular=await api('/api/chat',payload('ordinary','Inspect fixture'));
  assert.equal(regular.success,true);assert.equal(regular.data.reply,'Inspected.');
  assert.equal((await calls()).filter(c=>c.member==='ordinary'&&c.kind==='start').length,1,'ordinary request never pursues automatically');

  const start=await api('/api/chat',{...payload('breaker','HOLD fixture'),mode:'goal'});
  await until(async()=> (await calls()).some(c=>c.member==='breaker'&&c.kind==='start'),'in-flight goal');
  const breakResult=await api('/api/members/breaker/break',{active:true});
  assert.equal(breakResult.data.onBreak,true);assert.ok(breakResult.data.pausedGoals.includes(start.data.goalId));
  await until(async()=> (await calls()).some(c=>c.member==='breaker'&&c.kind==='abort'),'external child abort');
  const goal=(await api('/api/goals/'+start.data.goalId)).data;assert.equal(goal.status,'paused');
  const chatBefore=(await calls()).length;
  const declined=await api('/api/chat',payload('breaker','Incoming handoff'));
  assert.equal(declined.data.reply,BREAK_REPLY);assert.equal(declined.data.declined,true);
  const declineStream=await fetch(origin+'/api/chat/stream',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload('breaker','New channel mention'))});
  assert.ok((await declineStream.text()).includes('"declined":true'));
  const declinedRun=await api('/api/runs',payload('breaker','Incoming task'));assert.equal(declinedRun.status,409);assert.equal(declinedRun.reason,'break');
  assert.equal((await api('/api/goals/'+start.data.goalId+'/resume',{})).status,409);
  assert.equal((await calls()).length,chatBefore,'refused requests launch no subprocess');
  await api('/api/members/breaker/break',{active:false});
  assert.equal((await api('/api/members/breaks')).data.breaker.onBreak,false);
  const cancelled=await api('/api/goals/'+start.data.goalId+'/cancel',{});assert.equal(cancelled.data.status,'cancelled');

  // A normal live chat also stops its external child when break begins.
  const ordinaryHold=fetch(origin+'/api/chat/stream',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload('live','HOLD fixture'))});
  await until(async()=> (await calls()).some(c=>c.member==='live'&&c.kind==='start'),'ordinary in-flight child');
  const liveBreak=await api('/api/members/live/break',{active:true});assert.equal(liveBreak.data.stoppedChats,1);
  await until(async()=> (await calls()).some(c=>c.member==='live'&&c.kind==='abort'),'ordinary child abort');
  assert.ok((await (await ordinaryHold).text()).includes('event: error'));
  console.log('Goal bridge checks passed: Autohand SDK/Codex/Claude fixture pursuit, chosen workspace/resume/warm SDK reuse, native live plan, metadata hiding, ordinary single turn, break pause/abort/decline, controls and no refused spawn.');
} finally {
  if(bridge&&!bridge.killed){bridge.kill('SIGTERM');await Promise.race([new Promise(resolve=>bridge.once('exit',resolve)),delay(3000)]);if(bridge.exitCode===null)bridge.kill('SIGKILL');}
  await rm(directory,{recursive:true,force:true});
}
