import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startBridge, until } from './lib/reliability-browser.mjs';

const bridge = await startBridge({ prepare: async directory => {
  const entry = join(directory, 'sdk.mjs');
  await writeFile(entry, `import { existsSync, appendFileSync } from 'node:fs';
export class AutohandSDK {
 async start() {} async interrupt() {} async close() {}
 async *streamPrompt({message}) {
  appendFileSync(${JSON.stringify(join(directory, 'calls.jsonl'))}, JSON.stringify({message})+'\\n');
  if (message.includes('HOLD')) {
    const release=message.includes('HOLD_REVOKE') ? ${JSON.stringify(join(directory, 'release-revoke'))} : ${JSON.stringify(join(directory, 'release'))};
    while (!existsSync(release)) await new Promise(resolve=>setTimeout(resolve,20));
    appendFileSync(${JSON.stringify(join(directory, 'calls.jsonl'))}, JSON.stringify({resumed:message})+'\\n');
  }
  if (message.includes('SDK_FAILURE')) { yield {type:'error',message:'Controlled provider failure',recoverable:false}; return; }
  yield {type:'message_end',content:'Background result.\\nSQUAD_ACTION: '+message.match(/REQUEST:(.*)/)[1]};
 }
}`);
  const executable = `#!${process.execPath}
const args=process.argv.slice(2);
if (args[0]==='--version') { console.log('codex 1.0.0'); process.exit(0); }
if (args[0]==='login') { console.log('Logged in using fixture'); process.exit(0); }
const prompt=args.find((arg,index)=>args[index-1]==='--prompt') || args.at(-1) || '';
const text='Background result.\\nSQUAD_ACTION: '+prompt.match(/REQUEST:(.*)/)[1];
if (args[0]==='exec') {
 console.log(JSON.stringify({type:'thread.started',thread_id:'controlled-run'}));
 console.log(JSON.stringify({type:'item.completed',item:{id:'reply',type:'agent_message',text}}));
 console.log(JSON.stringify({type:'turn.completed'}));
} else console.log(text);
`;
  for (const name of ['autohand', 'codex']) await writeFile(join(directory, name), executable, { mode: 0o700 });
  return { AUTOHAND_AGENT_SDK_ENTRY: entry, AUTOHAND_AGENT_SDK_DIR: directory, AUTOHAND_SQUAD_AUTOHAND_BIN: join(directory, 'autohand') };
} });
const workspace = process.cwd(), failures = [];
let checks = 0;
const member = (id, policy = 'ask', harness = 'autohand') => ({ id, name: id, role: 'Engineer', skills: [], projects: [{path:workspace}], workspace, permissions: {builtInPolicies:{squad_create_channel:policy}}, harness: {id:harness, ...(harness === 'codex' ? {executablePath:join(bridge.directory, 'codex')} : {})} });
const action = name => ({type:'create_channel',name,members:[],purpose:''});
const payload = (actor, name, extra = {}) => ({agentId:actor.id, agent:actor, workspace, mode:'prompt', requestId:name, prompt:'REQUEST:'+JSON.stringify(action(name)), ...extra});
const state = async () => (await bridge.api('/api/channels')).data;
async function start(body) {
  const response=await bridge.api('/api/runs','POST',body);
  assert.equal(response.success,true,JSON.stringify(response)); return response.data.id;
}
async function finish(id) { return until(async()=>{const response=await bridge.api('/api/runs/'+id);return ['completed','failed','stopped'].includes(response.data?.status) ? response.data : false;}, 'background run '+id); }
async function check(label, run) { try { await run();checks++;console.log('PASS '+label); } catch(error) { failures.push({label,error:error.message});console.error('FAIL '+label+': '+error.message); } }
try {
  for (const transport of ['sdk','cli','codex']) {
    for (const policy of ['ask','allow','block']) {
      await check(transport+' background completion enforces '+policy+' channel permission', async()=>{
        const actor=member('asq_run_'+transport+'_'+policy,policy,transport==='codex'?'codex':'autohand');
        const name='run-'+transport+'-'+policy;
        const body=payload(actor,name,transport==='cli'?{transport:'cli'}:{});
        const run=await finish(await start(body));
        assert.equal(run.status,'completed',JSON.stringify(run));
        assert.equal(run.channelActions?.[0]?.status, {ask:'proposed',allow:'created',block:'blocked'}[policy]);
        assert.ok(!run.reply.includes('SQUAD_ACTION:'), 'Final reply must describe the actual receipt.');
        assert.equal((await state()).channels.some(c=>c.name===name),policy==='allow');
        if(policy==='allow') {
          const replay=await finish(await start(body));
          assert.equal(replay.channelActions[0].id,run.channelActions[0].id);
          assert.equal((await state()).channels.filter(c=>c.name===name).length,1);
        }
      });
    }
  }
  await check('SDK provider failure cannot report completed or execute an action',async()=>{
    const body=payload(member('asq_run_failure','allow'),'run-failure'); body.prompt='SDK_FAILURE\n'+body.prompt;
    const run=await finish(await start(body));assert.equal(run.status,'failed');assert.ok(run.logs.some(log=>String(log.line).includes('Controlled provider failure')));
    assert.ok(!(await state()).channels.some(c=>c.name==='run-failure'));
  });
  await check('stopped run cannot commit a later action',async()=>{
    const body=payload(member('asq_run_stopped','allow'),'run-stopped');body.prompt='HOLD\n'+body.prompt;
    const id=await start(body);
    await until(async()=> (await readFile(join(bridge.directory,'calls.jsonl'),'utf8')).includes('run-stopped'),'held run');
    assert.equal((await bridge.api('/api/runs/'+id+'/stop','POST',{})).success,true);
    await writeFile(join(bridge.directory,'release'),'release');
    await until(async()=> (await readFile(join(bridge.directory,'calls.jsonl'),'utf8')).split('\n').some(line=>line && JSON.parse(line).resumed?.includes('run-stopped')),'late stopped output');
    assert.equal((await finish(id)).status,'stopped');
    await until(async()=> !(await bridge.api('/api/runs/'+id)).data.channelActions?.length,'no stopped receipt');
    assert.ok(!(await state()).channels.some(c=>c.name==='run-stopped'));
  });
  await check('background action rechecks permissions revoked during execution',async()=>{
    const actor=member('asq_run_revoked','allow');const body=payload(actor,'run-revoked');body.prompt='HOLD_REVOKE\n'+body.prompt;
    const id=await start(body);
    await until(async()=> (await readFile(join(bridge.directory,'calls.jsonl'),'utf8')).includes('run-revoked'),'held revocation run');
    assert.equal((await bridge.api('/api/members/'+actor.id+'/channel-access','PUT',{agent:member(actor.id,'block')})).success,true);
    await writeFile(join(bridge.directory,'release-revoke'),'release');
    assert.equal((await finish(id)).channelActions[0].status,'blocked');
    assert.ok(!(await state()).channels.some(c=>c.name==='run-revoked'));
  });
  await check('background receipts survive bridge restart',async()=>{
    const before=(await state()).agentChannelActions.map(action=>action.id);
    await bridge.restart();
    assert.deepEqual((await state()).agentChannelActions.map(action=>action.id),before);
  });
  if (failures.length) {console.error(JSON.stringify(failures,null,2));process.exitCode=1;}
  else console.log(checks+' background-run channel checks passed (controlled SDK/CLI/Codex, real bridge and persistence).');
} finally {await bridge.close();}
