#!/usr/bin/env node
// Real bridge/executors/state, with a gated SDK transport, no live provider.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startBridge, startBrowser, until } from './lib/reliability-browser.mjs';
import { initialAgents } from '../src/data.js';

await mkdir('.codex-artifacts',{recursive:true});
const workspace = await mkdtemp(join(process.cwd(),'.codex-artifacts/member-threads-'));
const bridge = await startBridge({prepare:async directory=>{
  const entry=join(directory,'sdk.mjs');
  await writeFile(entry,`import {existsSync,writeFileSync,appendFileSync} from 'node:fs';
    export class AutohandSDK {
      constructor(options){this.id=crypto.randomUUID();this.options=options;}
      async start(){} async interrupt(){} async close(){}
      async *streamPrompt({message}){
        appendFileSync(${JSON.stringify(join(directory,'calls.jsonl'))},JSON.stringify({id:this.id,message,options:this.options})+'\\n');
        yield {type:'message_start'};
        const marker=[...message.matchAll(/REQUEST:((?:THREAD|CHANNEL)_(?:ONE|TWO))/g)].at(-1)?.[1];
        if(marker){writeFileSync(${JSON.stringify(join(directory,'started-'))}+marker,'started');while(!existsSync(${JSON.stringify(join(directory,'release-'))}+marker)){await new Promise(resolve=>setTimeout(resolve,50));yield {type:'heartbeat'};}}
        yield {type:'message_end',content:marker?'Answer for '+marker:'Main conversation answer.'};
      }
    }`);
  return {AUTOHAND_AGENT_SDK_ENTRY:entry,AUTOHAND_AGENT_SDK_DIR:directory};
}});
let browser;
try {
  const agent={id:'thread-eva',name:'Eva',role:'Engineer',workspace,projects:[{path:workspace}],harness:{id:'autohand'},permissions:{}};
  await bridge.api(`/api/members/${agent.id}/channel-access`,'PUT',{agent,profile:''});
  const create=root=>bridge.api(`/api/members/${agent.id}/threads`,'POST',{root});
  const first=await create({id:'root-one',role:'agent',body:'Investigate the first issue.'});
  assert.equal(first.success,true,JSON.stringify(first));
  const second=await create({id:'root-two',role:'user',body:'Investigate the second issue.'});
  assert.equal(second.success,true,JSON.stringify(second));
  assert.equal((await create({id:'root-one',role:'agent',body:'Investigate the first issue.'})).data.id,first.data.id);
  const path=id=>`/api/members/${agent.id}/threads/${id}`;
  const send=(id,marker)=>bridge.api(path(id)+'/messages','POST',{text:`REQUEST:THREAD_${marker}`,requestId:`message-${marker}`,workspace});
  const [one,two]=await Promise.all([send(first.data.id,'ONE'),send(second.data.id,'TWO')]);
  assert.equal(one.success,true,JSON.stringify(one)); assert.equal(two.success,true,JSON.stringify(two));
  await until(async()=>{await readFile(join(bridge.directory,'started-THREAD_ONE'));await readFile(join(bridge.directory,'started-THREAD_TWO'));return true;},'two independent member threads executing at the same time',10000);
  await writeFile(join(bridge.directory,'release-THREAD_TWO'),'go');
  await until(async()=>{const thread=(await bridge.api(path(second.data.id))).data;return thread.messages.some(message=>message.body==='Answer for THREAD_TWO'&&message.status==='complete');},'second thread answer');
  const stillWorking=(await bridge.api(path(first.data.id))).data;
  assert.ok(stillWorking.messages.some(message=>message.status==='loading'),'the first thread remains independent');
  await bridge.api(path(first.data.id)+'/stop','POST',{});
  await writeFile(join(bridge.directory,'release-THREAD_ONE'),'go');
  await until(async()=>!(await bridge.api(path(first.data.id))).data.messages.some(message=>message.status==='loading'),'only the selected thread stops');
  assert.equal((await bridge.api(path(second.data.id))).data.messages.at(-1).body,'Answer for THREAD_TWO');
  const calls=(await readFile(join(bridge.directory,'calls.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.notEqual(calls.find(call=>call.message.includes('REQUEST:THREAD_ONE')).id,calls.find(call=>call.message.includes('REQUEST:THREAD_TWO')).id,'each thread uses its own engine session');
  assert.equal(calls.find(call=>call.message.includes('REQUEST:THREAD_ONE')).message.includes('REQUEST:THREAD_TWO'),false);
  await bridge.restart();
  assert.equal((await bridge.api(path(second.data.id))).data.messages.at(-1).body,'Answer for THREAD_TWO','thread answers survive bridge restart');

  // Channel entry points use the same isolation contract, even when the
  // caller omits ephemeralSession (as ordinary channel chat does).
  await bridge.api('/api/channels','POST',{id:'parallel-room',name:'parallel-room',memberIds:[agent.id],projects:[{path:workspace}]});
  const snapshot=(await bridge.api('/api/channels')).data;
  const now=new Date().toISOString();
  snapshot.threads.push(...['ONE','TWO'].map(marker=>({id:`channel-${marker}`,channelId:'parallel-room',parentMessageId:`root-${marker}`,memberIds:[agent.id],createdAt:now})));
  snapshot.messages.push(...['ONE','TWO'].map(marker=>({id:`root-${marker}`,channelId:'parallel-room',threadId:`channel-${marker}`,role:'user',body:`Saved history for CHANNEL_${marker}`,status:'complete',createdAt:now})));
  assert.equal((await bridge.api('/api/channels','PUT',snapshot)).success,true);
  const channelSend=marker=>bridge.api('/api/runs','POST',{agentId:agent.id,agent,workspace,prompt:`REQUEST:CHANNEL_${marker}`,channelId:'parallel-room',threadId:`channel-${marker}`,parentMessageId:`root-${marker}`,memberIds:[agent.id]});
  const [channelOne,channelTwo]=await Promise.all([channelSend('ONE'),channelSend('TWO')]);
  assert.equal(channelOne.success,true,JSON.stringify(channelOne));assert.equal(channelTwo.success,true,JSON.stringify(channelTwo));
  await until(async()=>{await readFile(join(bridge.directory,'started-CHANNEL_ONE'));await readFile(join(bridge.directory,'started-CHANNEL_TWO'));return true;},'parallel channel turns start independently',15000);
  const channelCalls=(await readFile(join(bridge.directory,'calls.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  const callOne=channelCalls.find(call=>call.message.includes('REQUEST:CHANNEL_ONE'));
  const callTwo=channelCalls.find(call=>call.message.includes('REQUEST:CHANNEL_TWO'));
  assert.notEqual(callOne.id,callTwo.id,'channel threads must use separate engine sessions');
  assert.ok(callOne.options.appendSystemPrompt.includes('Saved history for CHANNEL_ONE'),'channel history is supplied in the engine system context');
  assert.equal(callOne.options.appendSystemPrompt.includes('Saved history for CHANNEL_TWO'),false,'other channel thread context is excluded');
  await bridge.api(`/api/runs/${channelOne.data.id}/stop`,'POST',{});
  await writeFile(join(bridge.directory,'release-CHANNEL_TWO'),'go');
  await until(async()=>(await bridge.api(`/api/runs/${channelTwo.data.id}`)).data?.reply==='Answer for CHANNEL_TWO','stopping one channel thread preserves the other');
  await writeFile(join(bridge.directory,'release-CHANNEL_ONE'),'go');
  if(process.argv.includes('--browser')){
    browser=await startBrowser();
    const storage={agents:[{...agent,status:'online',memory:[],skills:[],stats:{},modelAssignment:{mode:'inherit'}}],removedAgents:initialAgents.map(member=>member.id),tasks:[],channels:[],automations:[],onboarding:{version:1,status:'skipped',lastStep:'skipped'},messages:{[agent.id]:[{id:'root-one',role:'agent',body:'Investigate the first issue.',status:'complete',time:'Now'},{id:'root-two',role:'user',body:'Investigate the second issue.',status:'complete',time:'Now'}]}};
    await browser.send('Page.addScriptToEvaluateOnNewDocument',{source:`if(!localStorage.getItem('threadProof.seeded')){localStorage.clear();for(const[key,value]of Object.entries(${JSON.stringify(storage)}))localStorage.setItem('autohandSquad.v1.'+key,JSON.stringify(value));localStorage.setItem('threadProof.seeded','true');}`});
    await browser.navigate(`${bridge.origin}/conversations/new?member=${agent.id}`);
    await until(()=>browser.evaluate(`!!document.querySelector('[data-message-id="root-two"] button[aria-label="Reply in thread"]')`),'Reply action on a user message',30000);
    assert.equal(await browser.evaluate(`!!document.querySelector('[data-message-id="root-one"] button[aria-label="Reply in thread"]')`),true,'member answers also offer Reply');
    await browser.evaluate(`document.querySelector('[data-message-id="root-two"] button[aria-label="Reply in thread"]').click()`);
    await until(()=>browser.evaluate(`document.querySelector('[data-testid="member-reply-thread"]')?.innerText.includes('Answer for THREAD_TWO')`),'saved answer in the actual thread sheet');
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="member-reply-thread"]')?.innerText.includes('REQUEST:THREAD_ONE')`),false);
    await until(()=>browser.evaluate(`(() => {const r=document.querySelector('[data-testid="member-reply-thread"]').getBoundingClientRect();return r.left<innerWidth-300&&r.right<=innerWidth+1;})()`),'thread sheet is fully visible');
    await browser.screenshot(join(process.cwd(),'.codex-artifacts/natural-workflows/member-thread.png'));
    assert.deepEqual(browser.errors,[]);
  }
  console.log('Member thread checks passed: persisted roots, idempotent creation, concurrent execution on one member, separate sessions/context, targeted Stop and restart.');
} finally {await browser?.close();await bridge.close();await rm(workspace,{recursive:true,force:true});}
