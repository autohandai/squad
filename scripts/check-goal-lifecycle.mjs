#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GoalManager } from '../server/goal-manager.mjs';
import { MemberAvailability, BREAK_REPLY } from '../server/members/availability.mjs';
import { cleanWorkResult, extractWorkMarkers, planFromTool, withWorkProgress } from '../server/work-progress.mjs';
import { codexAdapter } from '../server/harness/index.mjs';

const root = await mkdtemp(join(tmpdir(), 'squad-goal-check-'));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(read, predicate, timeout = 2500) {
  const end = Date.now() + timeout;
  let value;
  while (Date.now() < end) { value = await read(); if (predicate(value)) return value; await delay(5); }
  throw new Error(`Timed out: ${JSON.stringify(value)}`);
}
const item = (status) => ({ id: 'verify', title: 'Verify saved artifact bytes', status });
const report = (status, checklist = [item('completed')], evidence = ['Observed artifact digest']) => ({
  reply: `Verified artifact.\n<squad_goal>${JSON.stringify({ status, checklist, evidence, summary: status === 'completed' ? 'Artifact verified.' : 'Verification remains.' })}</squad_goal>`,
});
const launch = { agentId: 'eva', workspace: '/workspace/selected', agent: { id: 'eva', harness: { id: 'claude', executablePath: '/selected/claude' }, apiKey: 'not-persisted' }, profile: 'Selected permission rules', prompt: 'Verify the artifact' };

try {
  // Protocol strips complete, malformed, split and interrupted metadata.
  const chunks = [];
  const progress = withWorkProgress({ send: (event, data) => chunks.push({ event, data }) });
  const text = report('completed').reply;
  for (const delta of text) progress.send('sdk', { type: 'message_delta', delta });
  progress.send('sdk', { type: 'message_end', content: text });
  progress.send('done', { reply: text });
  assert.equal(chunks.filter(({event,data}) => event === 'sdk' && data.type === 'message_delta').map(({data}) => data.delta).join('').trim(), 'Verified artifact.');
  assert.ok(chunks.some(({event,data}) => event === 'progress' && data.items[0].status === 'completed'));
  assert.equal(chunks.find(({event}) => event === 'done').data.goalReport.status, 'completed');
  assert.equal(extractWorkMarkers('Reply <squad_goal>{bad').cleanText, 'Reply');
  assert.equal(extractWorkMarkers('Reply <squad_progress>bad</squad_progress>').progress, null);
  assert.equal(cleanWorkResult({ reply: text, trace: { messages: [{ content: text }], events: [{type:'assistant_event',content:text}] } }).trace.messages[0].content, 'Verified artifact.');
  const before = chunks.length;
  progress.send('sdk', { type: 'tool_start', tool: {id:'failed',name:'TodoWrite',args:{todos:[item('completed')]}} });
  progress.send('sdk', { type: 'tool_end', toolId:'failed', success:false });
  assert.equal(chunks.slice(before).some(({event})=> event === 'progress'), false, 'failed planner tool never publishes completed work');
  progress.send('sdk', { type:'tool_start',tool:{id:'okay',name:'update_plan',args:{plan:[item('in_progress')]}} });
  progress.send('sdk', { type:'tool_end',toolId:'okay',success:true });
  assert.equal(chunks.at(-2).event, 'sdk');
  assert.ok(chunks.some(({event,data})=>event==='progress'&&data.items[0].status==='in_progress'));
  // Pinned Autohand v0.9.7 uses todo_write/tasks/content/activeForm, not
  // update_plan/plan/step. The SDK forwards it through the tool lifecycle.
  const autohandTasks = [
    { content: 'Inspect the changed module', status: 'completed', activeForm: 'Inspecting the changed module' },
    { content: 'Run the focused checks', status: 'in_progress', activeForm: 'Running the focused checks' },
    { content: 'Verify the final result', status: 'pending', activeForm: 'Verifying the final result' },
  ];
  const actualPlan = planFromTool({ toolName: 'todo_write', args: { tasks: autohandTasks } });
  assert.deepEqual(actualPlan.items.map(({title,status})=>({title,status})), autohandTasks.map(({content,status})=>({title:content,status})));
  const nativeChunks = [];
  const nativeStream = withWorkProgress({ send: (event,data)=>nativeChunks.push({event,data}) });
  nativeStream.send('sdk',{type:'tool_start',tool:{id:'real-todo',name:'todo_write',args:{tasks:autohandTasks}}});
  assert.equal(nativeChunks.some(({event})=>event==='progress'),false);
  nativeStream.send('sdk',{type:'tool_end',toolId:'real-todo',toolName:'todo_write',success:true});
  assert.deepEqual(nativeChunks.find(({event})=>event==='progress').data.items.map(item=>item.status),['completed','in_progress','pending'],'native checklist updates during work before final reply');
  const markerChunks = [];
  const markerStream = withWorkProgress({send:(event,data)=>markerChunks.push({event,data})});
  const liveMarker = `<squad_progress>${JSON.stringify({items:[item('in_progress')]})}</squad_progress>`;
  for(const delta of liveMarker)markerStream.send('sdk',{type:'message_delta',delta});
  assert.equal(markerChunks.find(({event})=>event==='progress').data.items[0].status,'in_progress','structured fallback emits on closing tag before message_end or done');
  assert.equal(markerChunks.some(({event,data})=>event==='sdk'&&data.type==='message_delta'&&data.delta.includes('squad_')),false);
  const parsed = codexAdapter.parseLine(JSON.stringify({type:'item.completed',item:{id:'list',type:'todo_list',items:[{text:'Verify bytes',completed:false}]}}), { timestamp:()=> 'now',sequence:0,startedTools:new Set(),warnings:[] });
  assert.equal(parsed[0].type,'plan_update'); assert.equal(parsed[0].plan[0].status,'pending');

  // A normal end is a checkpoint; only explicit whole-goal completion ends pursuit.
  const turns = [];
  const manager = new GoalManager({ squadStateDir:join(root,'completion'), executeTurn: async (payload) => {
    turns.push(payload);
    return turns.length === 1 ? {reply:'The first turn ended.'} : report('completed');
  }});
  const started = await manager.start(launch);
  const completed = await until(()=> manager.get(started.id), (g)=>g.status==='completed');
  assert.equal(completed.turnCount,2); assert.equal(completed.harness,'claude');
  assert.ok(turns.every((turn)=>turn.mode==='prompt'&&turn.workspace===launch.workspace&&turn.agent.harness.executablePath==='/selected/claude'));
  assert.ok(turns[1].prompt.includes('Checkpoint after 1'));
  assert.ok(!JSON.stringify(completed).includes('not-persisted'));
  assert.ok(!(await readFile(join(root,'completion','goals.json'),'utf8')).includes('not-persisted'));
  assert.equal((await stat(join(root,'completion','goals.json'))).mode & 0o777,0o600);

  const unproven = new GoalManager({squadStateDir:join(root,'unproven'),executeTurn:async()=>report('completed',[item('pending')],[])});
  const unprovenStart=await unproven.start({...launch,goalMaxTurns:1});
  assert.equal((await until(()=>unproven.get(unprovenStart.id),g=>g.status!=='running')).status,'paused','completed claim without proof and completed plan cannot finish');
  const idle = new GoalManager({squadStateDir:join(root,'idle'),executeTurn:async()=>({reply:'Still thinking.'})});
  const idleStart=await idle.start(launch);
  const stalled=await until(()=>idle.get(idleStart.id),g=>g.status!=='running');
  assert.equal(stalled.status,'paused'); assert.equal(stalled.turnCount,3); assert.match(stalled.pauseReason,/no new checklist/);
  const blocked=new GoalManager({squadStateDir:join(root,'blocked'),executeTurn:async()=>report('blocked',[item('pending')],[])});
  const blockedStart=await blocked.start(launch);
  assert.equal((await until(()=>blocked.get(blockedStart.id),g=>g.status==='blocked')).turnCount,1);
  const failed=new GoalManager({squadStateDir:join(root,'failed'),executeTurn:async()=>{throw new Error('Harness failed honestly');}});
  const failedStart=await failed.start(launch);
  assert.match((await until(()=>failed.get(failedStart.id),g=>g.status==='failed')).error,/Harness failed honestly/);

  let clock=1000;
  const timed = new GoalManager({squadStateDir:join(root,'time-boundary'),now:()=>clock,executeTurn:async()=>{clock+=60001;return report('continue',[item('in_progress')]);}});
  const timedStart=await timed.start({...launch,goalMaxRuntimeMs:60000});
  const timedStop=await until(()=>timed.get(timedStart.id),g=>g.status!=='running');
  assert.equal(timedStop.status,'paused');assert.equal(timedStop.turnCount,1);assert.match(timedStop.pauseReason,/pursuit limit/);

  // Explicit controls abort in-flight turns; late success cannot revive them.
  for (const action of ['pause','cancel']) {
    let abortObserved=false;let release;
    const controlled = new GoalManager({squadStateDir:join(root,action),executeTurn:async(_,{signal})=>new Promise(resolve=>{
      release=()=>resolve(report('completed')); signal.addEventListener('abort',()=>{abortObserved=true;release();},{once:true});
    })});
    const g=await controlled.start(launch);
    await until(()=>Boolean(release), Boolean);
    const worker=controlled.workers.get(g.id);
    await controlled.control(g.id,action);await worker.done;
    assert.equal(abortObserved,true);assert.equal((await controlled.get(g.id)).status,action==='pause'?'paused':'cancelled');
    if(action==='pause'){
      controlled.executeTurn=async()=>report('completed');
      await controlled.control(g.id,'resume');
      assert.equal((await until(()=>controlled.get(g.id),g=>g.status==='completed')).turnCount,1);
    }
  }
  // Recovery never launches a duplicate worker, preserves chosen context.
  const recoveryDir=join(root,'recovery');
  await writeFile(join(root,'pending.json'),'{}');
  const seed=new GoalManager({squadStateDir:recoveryDir,executeTurn:async()=>report('completed')});await seed.ready;
  const record={...completed,id:'recover',status:'running',launch};seed.records.set(record.id,record);await seed.save();
  let recoveryTurns=0;
  const recovered=new GoalManager({squadStateDir:recoveryDir,executeTurn:async()=>{recoveryTurns++;return report('completed');}});
  assert.equal((await recovered.get('recover')).status,'paused');assert.equal(recoveryTurns,0);
  await recovered.control('recover','resume');await until(()=>recovered.get('recover'),g=>g.status==='completed');assert.equal(recoveryTurns,1);

  const availability=new MemberAvailability(join(root,'availability'));
  await availability.set('eva',true);await assert.rejects(availability.assertCanWork(launch),e=>e.reason==='break'&&e.reply===BREAK_REPLY);
  const restoredAvailability=new MemberAvailability(join(root,'availability'));assert.equal((await restoredAvailability.get('eva')).onBreak,true);
  await restoredAvailability.set('eva',false);
  await writeFile(join(root,'availability','web-status.json'),JSON.stringify({members:[{id:'eva',status:'paused'},{id:'kai',status:'paused'}]}));
  await restoredAvailability.assertCanWork({...launch,agent:{...launch.agent,status:'paused'}});
  const all=await restoredAvailability.list();assert.equal(all.eva.onBreak,false);assert.equal(all.kai.onBreak,true);

  // Break interrupts goal, and resume remains refused until break is ended.
  let executing=false;
  const breaks=new GoalManager({squadStateDir:join(root,'breaks'),assertCanWork:p=>restoredAvailability.assertCanWork(p),executeTurn:async(_,{signal})=>{
    executing=true;return new Promise(resolve=>signal.addEventListener('abort',()=>resolve(report('completed')),{once:true}));
  }});
  const breakGoal=await breaks.start(launch);await until(()=>executing,Boolean);
  const breakWorker=breaks.workers.get(breakGoal.id);
  await restoredAvailability.set('eva',true);await breaks.pauseForMember('eva','Member is on a break.');await breakWorker.done;
  assert.equal((await breaks.get(breakGoal.id)).status,'paused');await assert.rejects(breaks.control(breakGoal.id,'resume'),e=>e.reason==='break');
  console.log('Goal lifecycle checks passed: protocol/native plans, proof-gated continuation, limits/stall/block/failure, pause/resume/cancel, restart recovery, secret-free atomic persistence, authoritative breaks.');
} finally { await rm(root,{recursive:true,force:true}); }
