#!/usr/bin/env node
// Real team-design route and engine transport with a controlled designer.
import assert from 'node:assert/strict';
import { mkdir,mkdtemp,readFile,rm,writeFile } from 'node:fs/promises';
import {join} from 'node:path';
import {startBridge,startBrowser,until} from './lib/reliability-browser.mjs';
import {initialAgents} from '../src/data.js';
import {teamDocumentFromProposal,buildMemberDraft} from '../src/lib/team-builder.js';
import {planImport} from '../src/lib/teams.js';
await mkdir('.codex-artifacts',{recursive:true});
const workspace=await mkdtemp(join(process.cwd(),'.codex-artifacts/channel-goals-'));
const bridge=await startBridge({prepare:async directory=>{
  const entry=join(directory,'designer.mjs');
  await writeFile(entry,`import {existsSync,appendFileSync} from 'node:fs';
    export class AutohandSDK {async start(){}async close(){}async interrupt(){}async *streamPrompt({message}){
    if(!message.includes('Design a specialized Squad team')){appendFileSync(${JSON.stringify(join(directory,'work-calls.jsonl'))},JSON.stringify({message})+'\\n');yield {type:'message_start'};while(existsSync(${JSON.stringify(join(directory,'hold-work'))})){await new Promise(resolve=>setTimeout(resolve,50));yield {type:'heartbeat'};}yield {type:'message_end',content:'Started concrete work for this channel goal and checked the result.'};return;}
    const mobile=/mobile app/i.test(message);
    const roles=mobile?['Release Manager','Mobile Developer','UX Designer','QA Engineer']:['Sales Lead','Copywriter'];
    yield {type:'message_start'};yield {type:'message_end',content:JSON.stringify({name:mobile?'Mobile Release':'Bakery Sales',leadKey:'role-0',members:roles.map((role,index)=>({key:'role-'+index,name:['Mira','Tane','Lou','Kit'][index],role,purpose:'Own '+role+' for this channel goal.',instructions:'Work on the channel objective as '+role+'. Verify results before reporting.',skills:[]}))})};
  }}`);
  return {AUTOHAND_AGENT_SDK_ENTRY:entry,AUTOHAND_AGENT_SDK_DIR:directory};
}});
let browser;
try {
  await bridge.api('/api/channels','POST',{id:'legacy-count',name:'legacy-count',memberIds:[]});
  const legacy=(await bridge.api('/api/channels')).data;
  legacy.threads.push({id:'legacy-thread',channelId:'legacy-count',parentMessageId:'',title:'Original question'});
  legacy.messages.push({id:'legacy-root',channelId:'legacy-count',threadId:'legacy-thread',role:'user',body:'Original question',status:'complete'});
  await bridge.api('/api/channels','PUT',legacy);
  let legacyState=(await bridge.api('/api/channels')).data;
  assert.equal(legacyState.threads.find(thread=>thread.id==='legacy-thread').replyCount,0,'a legacy root without an explicit thread parent is not its own reply');
  legacyState.messages.push({id:'legacy-answer',channelId:'legacy-count',threadId:'legacy-thread',role:'agent',body:'Actual answer',status:'complete'});
  await bridge.api('/api/channels','PUT',legacyState);
  assert.equal((await bridge.api('/api/channels')).data.threads.find(thread=>thread.id==='legacy-thread').replyCount,1,'a completed legacy thread-only answer counts once');
  const design=objective=>bridge.api('/api/teams/design','POST',{objective,workspace,channelName:'goal-proof',existingNames:['Mira']});
  const mobile=await design('Build a mobile app and prepare its first release with UX and QA.');
  assert.equal(mobile.success,true,JSON.stringify(mobile));
  assert.equal(mobile.data.source,'model');
  assert.deepEqual(mobile.data.proposal.members.map(member=>member.role),['Release Manager','Mobile Developer','UX Designer','QA Engineer']);
  assert.equal(mobile.data.proposal.members[0].name,'Mira 2','existing names remain unique');
  const sales=await design('Sell seasonal bread to local cafes with a small sales and copy team.');
  assert.equal(sales.success,true,JSON.stringify(sales));
  assert.deepEqual(sales.data.proposal.members.map(member=>member.role),['Sales Lead','Copywriter']);
  assert.equal(sales.data.proposal.routines.length,0,'a team objective does not invent recurring schedules');
  assert.equal(sales.data.proposal.objective.includes('seasonal bread'),true);
  assert.equal((await design('')).status,400);
  await bridge.api('/api/channels','POST',{id:'goal-recovery',name:'goal-recovery',memberIds:[],projects:[{path:workspace}],goalSetup:{status:'awaiting'}});
  const claim=await bridge.api('/api/channels/goal-recovery/goal','POST',{owner:'first-window',objective:mobile.data.proposal.objective});
  assert.equal(claim.data.claimed,true);
  assert.equal((await bridge.api('/api/channels/goal-recovery/goal','POST',{owner:'another-window',objective:mobile.data.proposal.objective})).data.claimed,false,'two windows cannot both begin a new build');
  const document=teamDocumentFromProposal(mobile.data.proposal),plan=planImport(document,{existingMemberNames:[]});
  const build={id:'build-goal-proof',document,trusted:true,source:'channel-goal',goalObjective:mobile.data.proposal.objective,targetChannelId:'goal-recovery',goalOwner:'first-window',members:plan.members.map((member,index)=>({key:member.key,id:`goal-member-${index}`,name:member.name,status:index===0?'ready':'preparing',draft:{...buildMemberDraft(document.members.find(item=>item.key===member.key),member.name,{trusted:true}),workspace}}))};
  assert.equal((await bridge.api('/api/channels/goal-recovery/goal/build','PUT',{owner:'first-window',build})).success,true);
  await bridge.api('/api/channels/goal-recovery/goal/progress','POST',{owner:'first-window',status:'failed',error:'Interrupted fixture preparation.'});
  await bridge.restart();
  const resumed=await bridge.api('/api/channels/goal-recovery/goal','POST',{owner:'resumed-window',objective:mobile.data.proposal.objective,resume:true});
  assert.equal(resumed.data.build.members[0].status,'ready','restarting retains the prepared member id and status');
  assert.equal(resumed.data.build.members[0].id,'goal-member-0');
  assert.equal((await bridge.api('/api/channels/goal-recovery/goal/progress','POST',{owner:'first-window',status:'ready'})).status,409,'an old window cannot finish a newly resumed setup');
  assert.equal((await bridge.api('/api/channels')).data.messages.filter(message=>message.channelId==='goal-recovery'&&message.role==='user').length,1,'resume does not duplicate the goal message');
  // Ready is a durable bridge handoff. No browser exists in this part of
  // the check; each prepared member must still start and deliver its answer.
  for(const member of build.members){
    await bridge.api(`/api/members/${member.id}/channel-access`,'PUT',{agent:{...member.draft,id:member.id,workspace,harness:{id:'autohand'},permissions:{}},profile:''});
    member.status='ready';
  }
  await bridge.api('/api/channels/goal-recovery/members','POST',{add:build.members.map(member=>member.id)});
  assert.equal((await bridge.api('/api/channels/goal-recovery/goal/build','PUT',{owner:'resumed-window',build})).success,true);
  await writeFile(join(bridge.directory,'hold-work'),'hold');
  const start={owner:'resumed-window',status:'ready',memberIds:build.members.map(member=>member.id)};
  const begun=await bridge.api('/api/channels/goal-recovery/goal/progress','POST',start);
  assert.equal(begun.success,true,JSON.stringify(begun));
  assert.equal(begun.data.channel.goalSetup.deliveries?.length,4,'Ready queues actual member work on the bridge');
  await until(async()=>{const lines=await readFile(join(bridge.directory,'work-calls.jsonl'),'utf8');return lines.trim().split('\n').length===4;},'every specialist starts without an open browser',15000);
  let working=(await bridge.api('/api/channels')).data;
  assert.equal(working.threads.find(thread=>thread.id===resumed.data.channel.goalSetup.threadId).replyCount,0,'starting work is never a completed reply');
  assert.equal((await bridge.api('/api/channels/goal-recovery/goal/progress','POST',start)).success,true,'retrying Ready is idempotent');
  await rm(join(bridge.directory,'hold-work'));
  await until(async()=>{const state=(await bridge.api('/api/channels')).data;return state.messages.filter(message=>message.channelId==='goal-recovery'&&message.role==='agent'&&message.status==='complete').length===4;},'bridge saves every actual goal answer',15000);
  assert.equal((await readFile(join(bridge.directory,'work-calls.jsonl'),'utf8')).trim().split('\n').length,4,'retry does not start duplicate turns');
  await bridge.restart();
  assert.equal((await bridge.api('/api/channels')).data.messages.filter(message=>message.channelId==='goal-recovery'&&message.role==='agent'&&message.status==='complete').length,4,'goal answers survive a bridge restart');
  if(process.argv.includes('--browser')){
    const agent={...initialAgents[0],id:'goal-guide',name:'Eva',workspace,projects:[{path:workspace}],skills:[],permissions:{},harness:{id:'autohand'}};
    await bridge.api(`/api/members/${agent.id}/channel-access`,'PUT',{agent,profile:''});
    const storage={agents:[agent],removedAgents:initialAgents.map(member=>member.id),tasks:[],messages:{},channels:[],automations:[],onboarding:{version:1,status:'skipped',lastStep:'skipped'},sidebarCollapsed:false};
    browser=await startBrowser();
    await browser.send('Page.addScriptToEvaluateOnNewDocument',{source:`if(!localStorage.getItem('goalProof.seeded')){localStorage.clear();for(const[key,value]of Object.entries(${JSON.stringify(storage)}))localStorage.setItem('autohandSquad.v1.'+key,JSON.stringify(value));localStorage.setItem('goalProof.seeded','true');}`});
    await browser.navigate(bridge.origin+'/channels');
    await until(()=>browser.evaluate(`!!document.querySelector('button[aria-label="Create channel"]')`),'Create channel control',30000);
    await browser.click('Create channel');
    await until(()=>browser.evaluate(`!!document.querySelector('#channel-name')`),'new channel dialog');
    await browser.fill('#channel-name','mobile-release-proof');
    await browser.evaluate(`document.querySelector('[role="dialog"] button[type="submit"]').click()`);
    const room=await until(async()=>(await bridge.api('/api/channels')).data.channels.find(channel=>channel.name==='mobile-release-proof'),'channel created');
    await until(()=>browser.evaluate(`document.querySelector('[data-testid="channel-goal-setup"]')?.innerText.includes('What’s the goal')`),'new channel asks its goal');
    await browser.fill('textarea[placeholder*="goal"]','Build a mobile app and prepare its first release with UX and QA.');
    await browser.evaluate(`document.querySelector('textarea[placeholder*="goal"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true}));`);
    const ready=await until(async()=>{const current=(await bridge.api('/api/channels')).data.channels.find(channel=>channel.id===room.id);return current?.goalSetup?.status==='ready'&&current;},'specialized team prepared and connected automatically',60000);
    const snapshot=(await bridge.api('/api/channels')).data;
    assert.deepEqual(ready.memberIds.map(id=>snapshot.agentChannelAccess[id]?.agent.role),['Release Manager','Mobile Developer','UX Designer','QA Engineer']);
    await until(async()=>{const state=(await bridge.api('/api/channels')).data;return state.messages.filter(message=>message.channelId===room.id&&message.role==='agent'&&message.status==='complete').length===4;},'every specialist starts an actual turn for the goal',30000);
    await until(()=>browser.evaluate(`!!document.querySelector('button[aria-label^="Thread: 4 replies"]')`),'actual completed team replies rendered',30000);
    await browser.evaluate(`document.querySelector('button[aria-label^="Thread: 4 replies"]').click()`);
    await until(()=>browser.evaluate(`document.querySelector('[aria-label="Thread replies"]')?.innerText.includes('Started concrete work for this channel goal')`),'goal work in its persisted reply thread');
    await browser.screenshot(join(process.cwd(),'.codex-artifacts/natural-workflows/channel-goal-team.png'));
    assert.deepEqual(browser.errors,[]);
  }
  console.log('Channel goal design checks passed: goal-specific roles and instructions through the real designer, unique names, no fixed roster or invented schedules.');
}catch(error){if(browser)console.error(JSON.stringify({errors:browser.errors,page:await browser.evaluate('document.body.innerText').catch(()=>null)}));console.error(bridge.logs.slice(-4000));throw error;}finally{await browser?.close();await bridge.close();await rm(workspace,{recursive:true,force:true});}
