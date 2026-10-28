import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {startBridge,until} from './lib/reliability-browser.mjs';
const bridge=await startBridge({prepare:async directory=>{
 const entry=join(directory,'warmth-sdk.mjs');
 await writeFile(entry,`import {appendFileSync,readFileSync} from 'node:fs';
 const file=${JSON.stringify(join(directory,'sdk.jsonl'))};
 export class AutohandSDK {
  constructor(options){this.options=options;}
  async start(){
   this.config=JSON.parse(readFileSync(this.options.envVars.AUTOHAND_CONFIG,'utf8'));
   this.team=this.config.mcp.servers.find(server=>server.name==='autohand-squad');
   appendFileSync(file,JSON.stringify({kind:'launch',options:this.options,config:this.config})+'\\n');
   await new Promise(resolve=>setTimeout(resolve,30));
  }
  async *streamPrompt({message:prompt}){
   if(this.team){
    const response=await fetch(this.team.env.AUTOHAND_SQUAD_TEAM_URL,{method:'POST',headers:{'content-type':'application/json','x-squad-team-token':this.team.env.AUTOHAND_SQUAD_TEAM_TOKEN},body:JSON.stringify({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'squad_get_profile',arguments:{}}})});
    if(!response.ok)throw Error('Warm managed credential failed during an active turn: '+response.status);
   }
   appendFileSync(file,JSON.stringify({kind:'prompt',prompt})+'\\n');
   yield {type:'message_end',content:'Fixture answer.'};
  }
  async interrupt(){}async close(){}
 }
 `);
 return {AUTOHAND_AGENT_SDK_ENTRY:entry,AUTOHAND_AGENT_SDK_DIR:directory};
}});
const records=async()=>{try{return(await readFile(join(bridge.directory,'sdk.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);}catch(e){if(e.code==='ENOENT')return [];throw e;}};
try{
 const workspace=process.cwd();
 const agent={id:'warmth-fixture',name:'Eva',role:'QA Engineer',instructions:'Use the saved context.',skills:[],workspace,projects:[{path:workspace}],permissions:{permissionMode:'unrestricted'}};
 const payload={agentId:agent.id,agent,workspace,profile:'Stable browser profile'};
 const provision=await bridge.api('/api/agents/provision','POST',payload);assert.equal(provision.success,true,JSON.stringify(provision));
 const channelState=(await bridge.api('/api/channels')).data;
 channelState.agentChannelAccess={...channelState.agentChannelAccess,[agent.id]:{agent,workspace,policy:'yes'}};
 await writeFile(join(bridge.directory,'squad','channels.json'),JSON.stringify(channelState));
 assert.equal((await bridge.api('/api/chat/warm','POST',payload)).success,true);
 await until(async()=>(await records()).some(r=>r.kind==='launch'),'warm SDK launched');
 const warmLaunch=(await records()).find(r=>r.kind==='launch');
 const team=warmLaunch.config.mcp.servers.find(s=>s.name==='autohand-squad');assert(team,'Warm-up must prepare the real managed Squad connection');
 const teamRequest=method=>fetch(team.env.AUTOHAND_SQUAD_TEAM_URL,{method:'POST',headers:{'content-type':'application/json','x-squad-team-token':team.env.AUTOHAND_SQUAD_TEAM_TOKEN},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:method==='tools/call'?{name:'squad_team',arguments:{}}:{}})});
 const discovery=await teamRequest('tools/list');assert.equal(discovery.status,200,'Warming allows tool schema discovery: '+await discovery.text());
 assert.equal((await teamRequest('tools/call')).status,401,'Warming grants no authority to perform team operations');
 const vault=warmLaunch.config.mcp.servers.find(s=>s.name==='autohand-vault');assert(vault,'Warm-up must prepare the allowed vault connection');
 const vaultRequest=(method,params={})=>fetch(vault.env.AUTOHAND_SQUAD_VAULT_URL,{method:'POST',headers:{'content-type':'application/json','x-squad-vault-token':vault.env.AUTOHAND_SQUAD_VAULT_TOKEN},body:JSON.stringify({jsonrpc:'2.0',id:2,method,params})});
 const vaultDiscovery=await vaultRequest('tools/list');assert.equal(vaultDiscovery.status,200);
 const vaultTool=(await vaultDiscovery.json()).data.tools[0].name;
 assert.equal((await vaultRequest('tools/call',{name:vaultTool,arguments:{}})).status,401,'Warming cannot access the vault');
 const first=await bridge.api('/api/chat','POST',{...payload,prompt:'hey',requestId:'warmth-first'},20000);
 assert.equal(first.success,true,JSON.stringify(first));
 let rows=await records();console.log(JSON.stringify({phase:'warm-to-first-turn',sdkLaunches:rows.filter(r=>r.kind==='launch').length}));
 assert.equal(rows.filter(r=>r.kind==='launch').length,1,'Opening chat and sending its first message must use the same managed SDK session');
 assert.equal((await teamRequest('tools/call')).status,401,'Finishing a turn deactivates its managed authority');
 assert.equal((await vaultRequest('tools/call',{name:vaultTool,arguments:{}})).status,401,'Finished turns cannot keep using the vault');
 assert.equal((await bridge.api('/api/team/memory','POST',{text:'NEW_SHARED_LESSON',scope:'team'})).success,true);
 const second=await bridge.api('/api/chat','POST',{...payload,prompt:'Read the current shared lesson.',requestId:'warmth-second'},20000);
 assert.equal(second.success,true,JSON.stringify(second));rows=await records();
 assert.equal(rows.filter(r=>r.kind==='launch').length,1,'Mutable recall, work plan and shared memory must not restart the SDK');
 assert(rows.filter(r=>r.kind==='prompt').at(-1).prompt.includes('NEW_SHARED_LESSON'),'Fresh shared memory still reaches the reused session');
 assert.equal((await bridge.api('/api/agents/provision','POST',{...payload,agent:{...agent,instructions:'UPDATED_RUNTIME_PROFILE'}})).success,true);
 const third=await bridge.api('/api/chat','POST',{agentId:agent.id,workspace,prompt:'Use the updated profile.',requestId:'warmth-third'},20000);
 assert.equal(third.success,true,JSON.stringify(third));rows=await records();
 assert.equal(rows.filter(r=>r.kind==='launch').length,2,'A durable profile change must still invalidate the SDK session');
 console.log('PASS warm-to-send and mutable turn context reuse one SDK; updated shared memory reaches prompts; durable profile changes start a fresh session. Real bridge and managed configuration, fixture SDK only.');
}finally{await bridge.close();}
