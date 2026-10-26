import assert from 'node:assert/strict';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { initialAgents } from '../src/data.js';
import { memberFixture } from './lib/member-fixture.mjs';
import { startBridge, startBrowser, until } from './lib/reliability-browser.mjs';

// A real bridge and local protocol fixture, never a vendor request.
const bridge = await startBridge({ prepare: async directory => {
  const executable = join(directory, 'claude-fixture');
  await writeFile(executable, `#!${process.execPath}
const fs=require('node:fs');
const readline=require('node:readline');
const args=process.argv.slice(2);
const has=flag=>args.some(arg=>arg===flag||arg.startsWith(flag+'='));
const value=flag=>{const index=args.indexOf(flag);return index>=0?args[index+1]:args.find(arg=>arg.startsWith(flag+'='))?.slice(flag.length+1)};
if(args.includes('--version')){console.log('2.1.296');process.exit(0)}
if(args.includes('--help')){console.log("  --model <model>  Alias 'fable', 'opus', 'sonnet'\\n  --effort <level>  (low, medium, high)\\n  --permission-mode <mode> (choices: \\\"plan\\\", \\\"acceptEdits\\\", \\\"bypassPermissions\\\")");process.exit(0)}
if(args[0]==='auth'){console.log(JSON.stringify({loggedIn:true,email:'sdk@example.test'}));process.exit(0)}
const model=has('--model')?value('--model'):'fable';
const emit=event=>console.log(JSON.stringify(event));
const run=prompt=>{
 const promptText=typeof prompt==='string'?prompt:JSON.stringify(prompt);
 fs.appendFileSync(${JSON.stringify(join(directory, 'calls.jsonl'))},JSON.stringify({model,args,prompt:promptText.slice(0,200)})+'\\n');
 const session=has('--resume')?value('--resume'):'11111111-1111-4111-8111-111111111111';
 emit({type:'system',subtype:'init',session_id:session,model});
 if(model==='fable'){
  emit({type:'rate_limit_event',rate_limit_info:{status:'rejected',rateLimitType:'seven_day_fable',resetsAt:Math.floor(Date.now()/1000)+3600},session_id:session});
  emit({type:'assistant',error:'rate_limit',message:{id:'limited',content:[{type:'text',text:"You've reached your Fable limit. Switch to another model, or manage usage credits to continue."}]},session_id:session});
  emit({type:'result',subtype:'error_during_execution',is_error:true,result:"You've reached your Fable limit. Switch to another model, or manage usage credits to continue.",errors:["You've reached your Fable limit. Switch to another model."],session_id:session});
 }else{
  const text=promptText.includes('you will be called Robert')?"I'll go by Robert.\\nSQUAD_ACTION: "+JSON.stringify({type:'profile',op:'set',name:'Robert'}):'Answered on '+model+'.';
  emit({type:'assistant',message:{id:'answer',content:[{type:'text',text}]},session_id:session});
  emit({type:'result',subtype:'success',is_error:false,result:text,session_id:session,usage:{input_tokens:10,output_tokens:4}});
 }
 setTimeout(()=>process.exit(0),30);
};
if(has('--input-format')){
 readline.createInterface({input:process.stdin}).on('line',line=>{const message=JSON.parse(line);
  if(message.type==='control_request')emit({type:'control_response',response:{subtype:'success',request_id:message.request_id,response:{models:[{value:'fable',displayName:'Fable'},{value:'opus',displayName:'Opus'},{value:'sonnet',displayName:'Sonnet'}]}}});
  else if(message.type==='user')run(message.message?.content);
 });
}else run(args[args.indexOf('-p')+1]);
`);
  await chmod(executable, 0o700);
  return { CLAUDE_CONFIG_DIR: join(directory, 'claude'), ANTHROPIC_API_KEY: 'fixture-only-no-provider' };
} });
try {
  const agent = { id: 'model-recovery', name: 'Alex', role: 'GTM APAC Leader', harness: { id: 'claude', executablePath: join(bridge.directory, 'claude-fixture'), model: 'fable' }, projects: [{ path: process.cwd() }] };
  const chat = async () => {
    const response = await fetch(bridge.origin + '/api/chat/stream', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agentId: agent.id, agent, workspace: process.cwd(), prompt: 'Answer once. Do not run tools.' }) });
    const raw = await response.text();
    return raw.split('\n\n').flatMap(part => { const event = part.match(/^event: (.+)$/m)?.[1]; const data = part.match(/^data: (.+)$/m)?.[1]; return event && data ? [{ event, data: JSON.parse(data) }] : []; });
  };
  const first = await chat();
  const done = first.find(item => item.event === 'done')?.data;
  assert.ok(done && !done.error, `A Fable-only limit must recover to another model: ${JSON.stringify(first.at(-1))}`);
  assert.equal(done.reply, 'Answered on opus.');
  assert.equal(done.effectiveModel.model, 'opus', 'The reply names the model that actually answered');
  assert.ok(first.some(item => item.event === 'sdk' && item.data.status === 'model_fallback'), 'The switch is visible as ordinary progress');
  const calls = async () => (await readFile(join(bridge.directory, 'calls.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual((await calls()).map(item => item.model), ['fable', 'opus']);
  assert.ok((await calls()).every(item => item.args.some(arg => arg === '--input-format' || arg.startsWith('--input-format='))), 'Claude execution uses the official SDK protocol');
  assert.ok((await calls())[1].args.some(arg => arg === '--resume' || arg.startsWith('--resume=')), 'Recovery resumes the same conversation');
  await bridge.restart();
  const second = await chat();
  assert.equal(second.find(item => item.event === 'done')?.data?.reply, 'Answered on opus.');
  assert.deepEqual((await calls()).map(item => item.model), ['fable', 'opus', 'opus'], 'Restart does not retry a model whose limit has not reset');
  console.log('Claude model recovery: SDK protocol, model-specific limit fallback, actual-model attribution, same-session continuation and persisted cooldown passed. No vendor request.');
  if (process.argv.includes('--browser')) {
    const browser = await startBrowser();
    try {
      const member = memberFixture({ ...agent, id: 'browser-recovery', roleId: 'custom', customRoleTitle: agent.role, skills: [], workspace: process.cwd(), projects: [{ path: process.cwd() }] });
      await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `
        if(!sessionStorage.getItem('claude.seeded')) {
          localStorage.setItem('autohandSquad.v1.agents',${JSON.stringify(JSON.stringify([member]))});
          localStorage.setItem('autohandSquad.v1.removedAgents',${JSON.stringify(JSON.stringify(initialAgents.map(item => item.id)))});
          localStorage.setItem('autohandSquad.v1.onboarding','{"version":1,"status":"skipped"}');
          localStorage.setItem('autohandSquad.v1.messages','{}');
          localStorage.setItem('autohandSquad.v1.skin','soft');
          sessionStorage.setItem('claude.seeded','true');
        }
        const original=window.fetch.bind(window);
        window.fetch=async(input,options)=>{
          const path=new URL(typeof input==='string'?input:input.url,location.origin).pathname;
          if(path==='/api/chat/warm')return new Response('{"success":true,"data":{}}',{headers:{'content-type':'application/json'}});
          return original(input,options);
        };
      ` });
      await browser.navigate(bridge.origin + '/conversations/new?member=' + member.id);
      await until(() => browser.evaluate(`!!document.querySelector('textarea') && !document.getElementById('boot')`), 'rendered member chat');
      await browser.fill('textarea', 'Answer once. Do not run tools.');
      await browser.evaluate(`document.querySelector('textarea').closest('form').requestSubmit()`);
      await until(() => browser.evaluate(`document.body.innerText.includes('Answered on opus.')`), 'recovered answer delivered to the chat', 30000);
      await until(() => browser.evaluate(`JSON.parse(localStorage.getItem('autohandSquad.v1.messages')||'{}')['browser-recovery']?.some(message=>message.effectiveModel?.model==='opus'&&!message.loading)`), 'actual model saved on the completed reply');
      assert.equal(await browser.evaluate(`document.body.innerText.includes('Could not answer')`), false);
      assert.ok(await browser.evaluate(`JSON.parse(localStorage.getItem('autohandSquad.v1.messages'))['browser-recovery'].some(message=>JSON.stringify(message.trace||{}).includes('Continuing with Opus'))`), 'The recovery progress remains in work details');
      await browser.screenshot('.codex-artifacts/claude-sdk-review/recovered-browser.png');
      await browser.send('Page.reload');
      await until(() => browser.evaluate(`document.body.innerText.includes('Answered on opus.') && !document.getElementById('boot')`), 'recovered answer survives reload');
      // No stream handler in this window receives the queued turn. The same
      // profile receipt that originally left Max's labels stale must reach
      // the sidebar and header through the ordinary run/queue polling path.
      const renamed = await bridge.api('/api/queues/' + member.id + '/items', 'POST', { agentId: member.id, agent: member, workspace: process.cwd(), text: 'you will be called Robert', prompt: 'you will be called Robert' });
      assert.equal(renamed.success, true);
      await until(() => browser.evaluate(`document.querySelector('aside')?.innerText.includes('Robert') && [...document.querySelectorAll('header')].some(header=>header.innerText.includes('Robert'))`), 'queued SDK rename reaches the sidebar and chat header', 30000);
      assert.equal(await browser.evaluate(`document.querySelector('aside').innerText.includes('Alex')`), false);
      const saved = await browser.evaluate(`JSON.parse(localStorage.getItem('autohandSquad.v1.agents')).find(member=>member.id==='browser-recovery')`);
      assert.equal(saved.name, 'Robert'); assert.equal(saved.role, member.role); assert.equal(saved.harness.id, 'claude');
      await browser.screenshot('.codex-artifacts/claude-sdk-review/queued-rename-browser.png');
      assert.deepEqual(browser.errors, []);
      console.log('Rendered Claude recovery passed: actual SDK/bridge fallback, delivered answer, actual-model metadata, work-details switch receipt, reload persistence and queued SDK rename updating the sidebar/header without changing role or engine.');
    } catch (error) {
      const queues = await bridge.api('/api/queues/browser-recovery');
      const runs = await bridge.api('/api/runs');
      const state = await browser.evaluate(`({agents:JSON.parse(localStorage.getItem('autohandSquad.v1.agents')).map(member=>({id:member.id,name:member.name})),sidebar:document.querySelector('aside')?.innerText,headers:[...document.querySelectorAll('header')].map(header=>header.innerText)})`);
      await writeFile('.codex-artifacts/claude-sdk-review/browser-debug.json',JSON.stringify({state,queues,runs:runs.data?.map(run=>({id:run.id,agentId:run.agentId,status:run.status,actions:run.channelActions})),calls:await calls()},null,2));
      throw error;
    } finally { await browser.close(); }
  }
} finally { await bridge.close(); }
