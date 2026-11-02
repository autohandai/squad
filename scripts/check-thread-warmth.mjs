#!/usr/bin/env node
// A channel thread keeps one warm engine session across its turns
// (ADR-0161 §2.5), as a direct chat does: two turns in the same thread start
// the SDK once, another thread starts its own, the member's direct chat is
// untouched, and the thread's managed team token stays valid across turns.
// Real bridge and managed configuration; fixture SDK only.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startBridge, until } from './lib/reliability-browser.mjs';

const bridge = await startBridge({ prepare: async directory => {
  const entry = join(directory, 'thread-sdk.mjs');
  await writeFile(entry, `import {appendFileSync,readFileSync} from 'node:fs';
const file=${JSON.stringify(join(directory, 'sdk.jsonl'))};
let launches=0;
export class AutohandSDK {
  constructor(options){this.options=options;this.id=++launches;}
  async start(){
    this.config=JSON.parse(readFileSync(this.options.envVars.AUTOHAND_CONFIG,'utf8'));
    this.team=this.config.mcp.servers.find(server=>server.name==='autohand-squad');
    appendFileSync(file,JSON.stringify({kind:'launch',id:this.id,config:this.options.envVars.AUTOHAND_CONFIG,noCliComputerUse:this.options.envVars.AUTOHAND_DISABLE_COMPUTER_USE,teamToken:this.team?.env.AUTOHAND_SQUAD_TEAM_TOKEN||''})+'\\n');
  }
  async *streamPrompt({message:prompt}){
    let team='';
    if(this.team){
      const response=await fetch(this.team.env.AUTOHAND_SQUAD_TEAM_URL,{method:'POST',headers:{'content-type':'application/json','x-squad-team-token':this.team.env.AUTOHAND_SQUAD_TEAM_TOKEN},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'squad_get_profile',arguments:{}}})});
      team=String(response.status);
    }
    appendFileSync(file,JSON.stringify({kind:'prompt',id:this.id,team,prompt})+'\\n');
    yield {type:'message_end',content:'Fixture answer.'};
  }
  async interrupt(){}async close(){}
}
`);
  return { AUTOHAND_AGENT_SDK_ENTRY: entry, AUTOHAND_AGENT_SDK_DIR: directory };
} });
const records = async () => { try { return (await readFile(join(bridge.directory, 'sdk.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse); } catch (error) { if (error.code === 'ENOENT') return []; throw error; } };
try {
  const workspace = process.cwd();
  const agent = { id: 'thread-fixture', name: 'Eva', role: 'QA Engineer', instructions: 'Answer briefly.', skills: [], workspace, projects: [{ path: workspace }], permissions: { permissionMode: 'unrestricted' } };
  const base = { agentId: agent.id, agent, workspace, profile: 'Stable profile', squadMembers: [{ id: agent.id, name: agent.name, role: agent.role }] };
  assert.equal((await bridge.api('/api/agents/provision', 'POST', base)).success, true);
  const state = (await bridge.api('/api/channels')).data;
  state.agentChannelAccess = { ...state.agentChannelAccess, [agent.id]: { agent, workspace, policy: 'yes' } };
  state.channels = [...(state.channels || []), { id: 'room', name: 'room', memberIds: [agent.id], createdAt: new Date().toISOString() }];
  state.messages = [...(state.messages || []), { id: 'root-a', channelId: 'room', threadId: 'thread-a', role: 'user', body: 'Thread A: what is 2+2?', status: 'complete', createdAt: new Date().toISOString() }];
  await writeFile(join(bridge.directory, 'squad', 'channels.json'), JSON.stringify(state));
  const thread = (threadId, prompt, requestId) => bridge.api('/api/chat', 'POST', { ...base, prompt, requestId, channelId: 'room', threadId, parentMessageId: `root-${threadId.slice(-1)}`, channel: { id: 'room', name: 'room', threadId, parentMessageId: `root-${threadId.slice(-1)}`, memberIds: [agent.id] } }, 20000);

  const first = await thread('thread-a', 'Thread A, first turn', 'ta-1');
  assert.equal(first.success, true, JSON.stringify(first));
  const second = await thread('thread-a', 'Thread A, second turn', 'ta-2');
  assert.equal(second.success, true, JSON.stringify(second));
  let rows = await records();
  const launches = () => rows.filter(row => row.kind === 'launch');
  const prompts = () => rows.filter(row => row.kind === 'prompt');
  assert.equal(launches().length, 1, `two turns in one thread share one engine session: ${JSON.stringify(launches())}`);
  assert.equal(launches()[0].noCliComputerUse, '1', "the CLI's own Computer Use is off; members reach it only through Squad's grant-checked proxy");
  assert.deepEqual(prompts().map(row => row.id), [1, 1], 'both prompts went to the same session');
  assert.deepEqual(prompts().map(row => row.team), ['200', '200'], "the thread's team token is valid on the second turn as on the first");
  assert.ok(prompts()[1].prompt.includes('Thread A, second turn'), 'the second prompt is the new message');

  const other = await thread('thread-b', 'Thread B, first turn', 'tb-1');
  assert.equal(other.success, true, JSON.stringify(other));
  rows = await records();
  assert.equal(launches().length, 2, 'another thread gets its own session');
  assert.notEqual(launches()[0].config, launches()[1].config, 'each thread has its own managed config copy');

  const direct = await bridge.api('/api/chat', 'POST', { ...base, prompt: 'A direct message', requestId: 'dm-1' }, 20000);
  assert.equal(direct.success, true, JSON.stringify(direct));
  rows = await records();
  assert.equal(launches().length, 3, 'the direct chat has a session of its own, untouched by the threads');
  const again = await thread('thread-a', 'Thread A, third turn', 'ta-3');
  assert.equal(again.success, true, JSON.stringify(again));
  rows = await records();
  assert.equal(launches().length, 3, 'thread A is still warm after other work');
  assert.equal(prompts().at(-1).id, 1, 'and its third turn went to its original session');
  console.log('PASS a channel thread keeps one warm engine session across turns; other threads and the direct chat have their own. Real bridge, fixture SDK only.');
} finally { await bridge.close(); }
