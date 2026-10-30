import {chmod,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export async function prepareModelRoutingFixture(directory){
  const bin=join(directory,'bin'),codexHome=join(directory,'codex'),claudeHome=join(directory,'claude');
  for(const path of [bin,codexHome,claudeHome,join(directory,'autohand','model-catalog')])await mkdir(path,{recursive:true});
  await writeFile(join(codexHome,'auth.json'),'{"fixture":true}');
  await writeFile(join(codexHome,'config.toml'),'model = "codex-default"\nmodel_reasoning_effort = "high"\n');
  await writeFile(join(claudeHome,'.credentials.json'),'{"fixture":true}');
  await writeFile(join(directory,'autohand','model-catalog','models.json'),JSON.stringify({autohandai:{moa:{id:'fixture-moa',name:'Fixture Moa'},fantail:{id:'fixture-fantail',name:'Fixture Fantail'}}}));
  const calls=join(directory,'model-calls.jsonl');
  const executable=async(name,body)=>{const path=join(bin,name);await writeFile(path,`#!${process.execPath}\n${body}`);await chmod(path,0o700);return path;};
  const autohand=await executable('autohand',`const fs=require('node:fs');const args=process.argv.slice(2);
    if(args.includes('--version')){console.log('0.9.7');process.exit();}
    if(args.includes('--help')){console.log('--no-idle-logout --path --config --model --thinking --auto-mode --goal --prompt --dry-run');process.exit();}
    fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({engine:'autohand',kind:'cli-turn',args})+'\\n');
    if(fs.existsSync(${JSON.stringify(join(directory,'fail-autohand'))})){if(args.includes('--auto-mode')||args.includes('--goal')){console.error('Rate limit exceeded');process.exit(1);}console.log('Setup cancelled.');process.exit();}
    console.log('Autohand CLI fixture continued the same task.');`);
  await executable('codex',`const fs=require('node:fs');const args=process.argv.slice(2);const log=row=>fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({engine:'codex',...row})+'\\n');
    if(args[0]==='--version'){console.log('codex 0.162.1');process.exit();}
    if(args[0]==='login'){console.log('Logged in using ChatGPT');process.exit();}
    if(args[0]==='app-server'){
      require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const p=JSON.parse(line);log({method:p.method,params:p.params});if(p.id===undefined)return;const result=p.method==='model/list'?{data:p.params.cursor?[{id:'codex-second',model:'codex-second',displayName:'Codex Second',hidden:false}]:[{id:'codex-recovery',model:'codex-recovery',displayName:'Codex Recovery',hidden:false,isDefault:true}],nextCursor:p.params.cursor?null:'page-2'}:{};console.log(JSON.stringify({id:p.id,result}));});
    }else{
      const model=args.includes('-m')?args[args.indexOf('-m')+1]:'';const images=[];for(let i=0;i<args.length;i++)if(args[i]==='--image')images.push(fs.readFileSync(args[++i]).toString('base64'));log({kind:'turn',args,model,images});
      if(fs.existsSync(${JSON.stringify(join(directory,'fail-codex'))})){console.log(JSON.stringify({type:'error',message:'Rate limit exceeded'}));process.exit(1);}
      console.log(JSON.stringify({type:'thread.started',thread_id:'routing-thread'}));
      if(fs.existsSync(${JSON.stringify(join(directory,'crash-codex'))})){console.log(JSON.stringify({type:'item.completed',item:{id:'partial',type:'agent_message',text:'A partial answer before the process failed.'}}));process.exit(1);}
      const reply=args.at(-1).includes('Pursue this explicit goal')?'Verified. <squad_goal>'+JSON.stringify({status:'completed',summary:'Fixture verified',checklist:[{id:'verify',title:'Verify the selected workspace',status:'completed'}],evidence:['Recording engine inspected selected workspace']})+'</squad_goal>':'Codex fixture continued the same task.';
      console.log(JSON.stringify({type:'item.completed',item:{id:'answer',type:'agent_message',text:reply}}));
      console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}}));
    }`);
  await executable('claude',`const fs=require('node:fs');const args=process.argv.slice(2);const log=row=>fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({engine:'claude',...row})+'\\n');
    if(args[0]==='--version'){console.log('2.1.296 (Claude Code)');process.exit();}
    if(args[0]==='--help'){console.log('--model <model> use alias (opus, sonnet, haiku)\\n--effort <level> choices: low, medium, high');process.exit();}
    if(args[0]==='auth'){console.log(JSON.stringify({loggedIn:true,authMethod:'claude.ai',email:'fixture@example.test'}));process.exit();}
    require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const p=JSON.parse(line);log({kind:p.type,subtype:p.request?.subtype});if(p.type==='control_request')console.log(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:p.request_id,response:{models:[{value:'claude-fixture',displayName:'Claude Fixture',description:'Fixture model'}],commands:[],agents:[],account:{}}}}));});`);
  await executable('acp-fixture',`const fs=require('node:fs');const log=row=>fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({engine:'acp',...row})+'\\n');let model='acp-default';require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const p=JSON.parse(line);log({method:p.method,params:p.params});if(p.id===undefined)return;let result={};if(p.method==='initialize')result={protocolVersion:1,agentCapabilities:{loadSession:true}};if(p.method==='session/new'||p.method==='session/load')result={sessionId:'acp-fixture-session',models:{currentModelId:model,availableModels:[{modelId:'acp-default',name:'ACP Default'},{modelId:'acp-second',name:'ACP Second'}]}};if(p.method==='session/set_model')model=p.params.modelId;if(p.method==='session/prompt'){console.log(JSON.stringify({jsonrpc:'2.0',method:'session/update',params:{sessionId:p.params.sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'ACP fixture used '+model}}}}));result={stopReason:'end_turn'};}console.log(JSON.stringify({jsonrpc:'2.0',id:p.id,result}));});`);
  const entry=join(directory,'routing-sdk.mjs');
  await writeFile(entry,`import{readFileSync,appendFileSync,existsSync}from'node:fs';export class AutohandSDK{
    constructor(options){this.options=options;}
    async start(){this.config=JSON.parse(readFileSync(this.options.envVars.AUTOHAND_CONFIG,'utf8'));}
    async*streamPrompt(p){appendFileSync(${JSON.stringify(calls)},JSON.stringify({engine:'autohand',kind:'turn',model:this.options.model,configModel:this.config[this.config.provider]?.model,provider:this.config.provider,args:this.options.extraArgs,message:p.message,images:p.images?.length||0,files:p.context?.files||[]})+'\\n');
      if(existsSync(${JSON.stringify(join(directory,'fail-autohand'))}))throw Object.assign(new Error('Rate limit exceeded'),{status:429});
      if(existsSync(${JSON.stringify(join(directory,'partial-autohand'))})){yield{type:'message_update',delta:'Partial answer that must be replaced.'};throw Object.assign(new Error('Rate limit exceeded'),{status:429});}
      if(p.message.includes('MCP_ROUTING_')){
        const team=this.config.mcp.servers.find(s=>s.name==='autohand-squad');
        const fallbacks=p.message.includes('MCP_ROUTING_CHAIN')?[{engine:'codex',model:'codex-second'},{engine:'claude',model:'claude-fixture'},{engine:'autohand',model:'fixture-fantail',provider:'autohandai'},{engine:'codex',model:'codex-recovery'}]:[{engine:'codex',model:p.message.includes('MCP_ROUTING_BAD_MODEL')?'not-reported-model':'codex-second'}];
        const args={fallbacks,...(p.message.includes('MCP_ROUTING_FORGE_GRANT')?{allowAgentChanges:true}:{})};
        const response=await fetch(team.env.AUTOHAND_SQUAD_TEAM_URL,{method:'POST',headers:{'content-type':'application/json','x-squad-team-token':team.env.AUTOHAND_SQUAD_TEAM_TOKEN},body:JSON.stringify({jsonrpc:'2.0',id:7,method:'tools/call',params:{name:'squad_set_fallbacks',arguments:args}})});
        appendFileSync(${JSON.stringify(calls)},JSON.stringify({engine:'autohand',kind:'routing-tool',response:await response.json()})+'\\n');
      }
      yield{type:'message_end',content:'Autohand fixture continued the same task.'};}
    async interrupt(){}async close(){}
  }`);
  return {PATH:bin+':'+process.env.PATH,CODEX_HOME:codexHome,CLAUDE_CONFIG_DIR:claudeHome,AUTOHAND_SQUAD_AUTOHAND_BIN:autohand,AUTOHAND_AGENT_SDK_ENTRY:entry,AUTOHAND_AGENT_SDK_DIR:directory,AUTOHAND_ACP_REGISTRY_URL:'http://127.0.0.1:1/'};
}
