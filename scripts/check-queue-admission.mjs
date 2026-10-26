#!/usr/bin/env node
// Real bridge/queue/session lifecycle; only the provider is a gated fixture.
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { startBridge, startBrowser, until, delay } from './lib/reliability-browser.mjs';
import { initialAgents } from '../src/data.js';

await mkdir('.codex-artifacts', { recursive: true });
const workspace = await mkdtemp(join(process.cwd(), '.codex-artifacts/queue-admission-'));
let executable, browser;
const responses = [];
const bridge = await startBridge({ prepare: async directory => {
  const entry = join(directory, 'sdk.mjs');
  await writeFile(entry, `import {existsSync,appendFileSync} from 'node:fs';
    export class AutohandSDK {
      constructor(){this.id=crypto.randomUUID();} async start(){} async interrupt(){} async close(){}
      async *streamPrompt({message}){
        const marker=[...message.matchAll(/REQUEST:([A-Z_]+)/g)].at(-1)?.[1]||'UNKNOWN';
        appendFileSync(${JSON.stringify(join(directory, 'calls.jsonl'))},JSON.stringify({marker,id:this.id})+'\\n');
        yield {type:'message_start'};
        while(!existsSync(${JSON.stringify(join(directory, 'release-'))}+marker)) {await new Promise(r=>setTimeout(r,25));yield {type:'heartbeat'};}
        if(marker==='FAIL_FIRST'){yield {type:'error',error:'Fixture turn failed'};return;}
        yield {type:'message_end',content:'Answer '+marker};
      }
    }`);
  executable = join(directory, 'harness.cjs');
  await writeFile(executable, `#!${process.execPath}
    const fs=require('node:fs');const readline=require('node:readline');const args=process.argv.slice(2);
    const send=x=>console.log(JSON.stringify(x));
    if(args[0]==='--version'){console.log('fixture 1.0.0');process.exit(0);}
    if(args.includes('--help')){console.log('--effort --model --permission-mode --output-format --resume');process.exit(0);}
    if(args[0]==='login'){console.log('Logged in using fixture');process.exit(0);}
    if(args[0]==='auth'){send({loggedIn:true,authMethod:'fixture'});process.exit(0);}
    const run=async text=>{
      const marker=[...text.matchAll(/REQUEST:([A-Z_]+)/g)].at(-1)?.[1]||'UNKNOWN';
      fs.appendFileSync(${JSON.stringify(join(directory, 'calls.jsonl'))},JSON.stringify({marker,args})+'\\n');
      while(!fs.existsSync(${JSON.stringify(join(directory, 'release-'))}+marker))await new Promise(r=>setTimeout(r,25));
      return 'Answer '+marker;
    };
    if(!args.length){
      let sessionId='fixture-session';const notify=update=>send({jsonrpc:'2.0',method:'session/update',params:{sessionId,update}});
      readline.createInterface({input:process.stdin}).on('line',async line=>{
        const m=JSON.parse(line);const reply=result=>send({jsonrpc:'2.0',id:m.id,result});
        if(m.method==='initialize')reply({protocolVersion:1,agentCapabilities:{loadSession:true},authMethods:[]});
        else if(m.method==='session/new')reply({sessionId});
        else if(m.method==='session/load'){sessionId=m.params.sessionId;reply({});}
        else if(m.method==='session/prompt'){const text=await run(m.params.prompt.map(b=>b.text||'').join(''));notify({sessionUpdate:'agent_message_chunk',content:{type:'text',text}});reply({stopReason:'end_turn'});}
        else if(m.id!==undefined)reply({});
      });
    }else{
      const claude=args[0]==='-p';
      if(claude)send({type:'system',subtype:'init',session_id:'fixture'});else send({type:'thread.started',thread_id:'fixture'});
      run(String(claude?args[1]:args.at(-1))).then(text=>{
        if(claude){send({type:'assistant',message:{id:'answer',content:[{type:'text',text}]}});send({type:'result',subtype:'success',result:text});}
        else{send({type:'item.completed',item:{id:'answer',type:'agent_message',text}});send({type:'turn.completed',usage:{input_tokens:10,output_tokens:5}});}
        process.exit(0);
      });
    }
  `);
  await chmod(executable, 0o700);
  await mkdir(join(directory, 'codex'), { recursive: true });
  await writeFile(join(directory, 'codex', 'auth.json'), '{}');
  await mkdir(join(directory, 'squad/acp'), { recursive: true });
  await writeFile(join(directory, 'squad/acp/registry.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), url: 'fixture', registry: { version: '1.0.0', agents: [{ id: 'fake-agent', name: 'Fixture', version: '1.0.0', distribution: { npx: { package: 'fixture' } } }] } }));
  return { AUTOHAND_AGENT_SDK_ENTRY: entry, AUTOHAND_AGENT_SDK_DIR: directory, CODEX_HOME: join(directory, 'codex'), OPENAI_API_KEY: 'fixture-only-no-provider', ANTHROPIC_API_KEY: 'fixture-only-no-provider' };
} });
const calls = async () => (await readFile(join(bridge.directory, 'calls.jsonl'), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(JSON.parse);
const started = async marker => (await calls()).some(call => call.marker === marker);
const release = marker => writeFile(join(bridge.directory, `release-${marker}`), 'go');
const payload = (member, marker, harness = 'autohand') => ({ agentId: member, agent: { id: member, name: member, role: 'Engineer', harness: { id: harness, ...(harness !== 'autohand' ? { executablePath: executable } : {}) }, workspace, projects: [{ path: workspace }], permissions: {} }, workspace, prompt: `REQUEST:${marker}`, requestId: crypto.randomUUID(), effort: 'high', access: 'full' });
const queue = async member => (await bridge.api(`/api/queues/${member}`)).data;
const chat = (member, marker, stream = true, harness = 'autohand', extra = {}) => {
  const pending = fetch(bridge.origin + `/api/chat${stream ? '/stream' : ''}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload(member, marker, harness), ...extra }) }).then(async response => { const result = { status: response.status, body: await response.text() }; responses.push({ member, marker, ...result }); return result; });
  pending.catch(() => {}); // A failing assertion closes the fixture bridge.
  return pending;
};
try {
  // Control: a completed SDK turn must free its session and dispatch the head.
  const first = chat('sdk-control', 'CONTROL_FIRST');
  await until(() => started('CONTROL_FIRST'), 'first SDK prompt');
  const head = (await bridge.api('/api/queues/sdk-control/items', 'POST', { ...payload('sdk-control', 'CONTROL_NEXT'), text: 'REQUEST:CONTROL_NEXT' })).data;
  await release('CONTROL_FIRST'); await first;
  await until(() => started('CONTROL_NEXT'), 'ordinary SDK queue handoff', 10000);
  await release('CONTROL_NEXT');
  await until(async () => (await queue('sdk-control')).items.find(item => item.id === head.id)?.status === 'done', 'ordinary SDK follow-up completes');
  console.log('SDK control passed: completion releases the member and the follow-up runs.');

  for (const [index, harness] of ['autohand', 'codex', 'claude', 'acp:fake-agent'].entries()) {
    const member = `admission-${index}`;
    const prefix = ['SDK', 'CODEX', 'CLAUDE', 'ACP'][index];
    const first = `${prefix}_FIRST`, next = `${prefix}_NEXT`, last = `${prefix}_LATER`;
    const initial = chat(member, first, true, harness);
    await until(() => started(first), `${harness}: initial turn`);
    const head = await bridge.api(`/api/queues/${member}/items`, 'POST', { ...payload(member, next, harness), text: `REQUEST:${next}` });
    assert.equal(head.success, true, JSON.stringify(head));
    const later = chat(member, last, index % 2 === 1, harness);
    await delay(500);
    assert.equal(await started(last), false, 'a later direct message bypassed the saved follow-up and kept its member busy');
    const admitted = await later;
    assert.match(admitted.body, index % 2 ? /event: queued/ : /"queued":true/);
    assert.deepEqual((await queue(member)).items.filter(item => item.status === 'queued').map(item => item.text), [`REQUEST:${next}`, `REQUEST:${last}`]);
    const saved = JSON.parse(await readFile(join(bridge.directory, 'squad/queues.json'), 'utf8'));
    assert.equal(saved.items.find(item => item.id === head.data.id).launch.effort, 'high');
    assert.equal(saved.items.find(item => item.id === head.data.id).launch.access, 'full');
    await release(first); await initial;
    await until(() => started(next), `${harness}: queued head starts after initial reply`);
    assert.equal(await started(last), false);
    await release(next);
    await until(() => started(last), `${harness}: later request follows the head`);
    await release(last);
    await until(async () => (await queue(member)).items.every(item => item.status === 'done'), `${harness}: all follow-ups delivered`);
    assert.equal((await calls()).filter(call => call.marker === next).length, 1, 'head executes once');
    console.log(`${harness}: initial reply → queued follow-up → later message, exactly once.`);
  }

  // Explicit Send now remains an interruption, even with a paused queue.
  await bridge.api('/api/queues/interrupt-member/pause', 'POST', {});
  await bridge.api('/api/queues/interrupt-member/items', 'POST', { ...payload('interrupt-member', 'PAUSED'), text: 'REQUEST:PAUSED' });
  const interrupt = chat('interrupt-member', 'INTERRUPT', true, 'autohand', { interruptQueue: true });
  await until(() => started('INTERRUPT'), 'explicit interruption bypasses the waiting queue');
  await release('INTERRUPT'); await interrupt;
  assert.equal((await queue('interrupt-member')).items[0].status, 'queued');
  await bridge.api('/api/queues/interrupt-member/resume', 'POST', {});
  await release('PAUSED');
  await until(async () => (await queue('interrupt-member')).items[0].status === 'done', 'paused queue resumes normally');

  // Concurrent idle-window sends must also share admission (no existing head).
  const races = [chat('race-member', 'RACE_A'), chat('race-member', 'RACE_B')];
  await until(async () => (await calls()).some(call => call.marker.startsWith('RACE_')), 'one concurrent send starts');
  await until(async () => (await queue('race-member')).items.some(item => item.status === 'queued'), 'other concurrent send is queued');
  assert.equal((await calls()).filter(call => call.marker.startsWith('RACE_')).length, 1);
  await release('RACE_A'); await release('RACE_B'); await Promise.all(races);
  await until(async () => (await queue('race-member')).items.every(item => item.status === 'done'), 'both concurrent sends finish');

  const failure = chat('failure-member', 'FAIL_FIRST');
  await until(() => started('FAIL_FIRST'), 'direct turn that will fail');
  await bridge.api('/api/queues/failure-member/items', 'POST', { ...payload('failure-member', 'AFTER_FAILURE'), text: 'REQUEST:AFTER_FAILURE' });
  await release('FAIL_FIRST');
  assert.match((await failure).body, /event: error/);
  await until(() => started('AFTER_FAILURE'), 'failed direct turn releases admission');
  await release('AFTER_FAILURE');
  await until(async () => (await queue('failure-member')).items[0].status === 'done', 'follow-up after failed direct turn delivers');

  if (process.argv.includes('--browser')) {
    const member = payload('ui-member', 'UI_FIRST').agent;
    const initial = chat(member.id, 'UI_FIRST');
    await until(() => started('UI_FIRST'), 'other-window turn running');
    browser = await startBrowser();
    const storage = { agents: [member], removedAgents: initialAgents.map(agent => agent.id), tasks: [], channels: [], messages: {}, automations: [], onboarding: { version: 1, status: 'skipped', lastStep: 'skipped' } };
    await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `if(!localStorage.getItem('queueAdmission.seeded')){localStorage.clear();for(const [key,value]of Object.entries(${JSON.stringify(storage)}))localStorage.setItem('autohandSquad.v1.'+key,JSON.stringify(value));localStorage.setItem('queueAdmission.seeded','true');}` });
    await browser.navigate(`${bridge.origin}/conversations/new?member=${member.id}`);
    await until(() => browser.evaluate(`!!document.querySelector('textarea')`), 'second app document ready', 30000);
    await browser.fill('textarea', 'REQUEST:UI_FOLLOWUP');
    await until(() => browser.evaluate(`!document.querySelector('textarea').closest('form').querySelector('button[type="submit"]').disabled`), 'composer receives the draft');
    await browser.evaluate(`document.querySelector('textarea').closest('form').requestSubmit()`);
    const item = await until(async () => (await queue(member.id)).items.find(item => item.text === 'REQUEST:UI_FOLLOWUP'), 'server queues stale-window send');
    await until(() => browser.evaluate(`document.body.innerText.includes('Queued follow-ups')&&![...document.querySelectorAll('[data-message-id]')].some(el=>el.innerText.includes('REQUEST:UI_FOLLOWUP'))`), 'queued row replaces optimistic bubbles');
    await until(() => browser.evaluate(`document.querySelector('textarea').value===''`), 'submitted draft clears');
    await browser.screenshot('.codex-artifacts/queue-admission-waiting.png');
    await browser.fill('textarea', 'Keep this draft');
    await release('UI_FIRST'); await initial;
    await until(() => started('UI_FOLLOWUP'), 'follow-up picked up automatically');
    await release('UI_FOLLOWUP');
    await until(() => browser.evaluate(`document.querySelector('[data-message-id="queue-${item.id}-a"]')?.innerText.includes('Answer UI_FOLLOWUP')`), 'answer delivered to the real conversation');
    assert.equal(await browser.evaluate(`document.querySelector('textarea').value`), 'Keep this draft');
    assert.equal(await browser.evaluate(`document.querySelectorAll('[data-message-id="queue-${item.id}-u"]').length`), 1);
    assert.equal(await browser.evaluate(`document.body.innerText.includes('returned no chat text')`), false);
    await browser.screenshot('.codex-artifacts/queue-admission-delivered.png');
    assert.deepEqual(browser.errors, []);
    console.log('Browser: stale-window send queues, auto-starts, delivers one answer and preserves the draft.');
  }
  console.log('Queue admission checks passed: all harnesses, cross-request FIFO, idle-window race and explicit interruption.');
} catch (error) {
  console.error(JSON.stringify(responses.slice(-3).map(result => ({ ...result, body: result.body.slice(-2000) })), null, 2));
  throw error;
} finally { await browser?.close(); await bridge.close(); await rm(workspace, { recursive: true, force: true }); }
