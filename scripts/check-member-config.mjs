import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startBridge } from './lib/reliability-browser.mjs';

let count=0;const failures=[];
async function check(label,run) {
  const bridge=await startBridge();
  try {await run(bridge);count++;console.log('PASS '+label);}
  catch(error){failures.push({label,error:error.message});console.error('FAIL '+label+': '+error.message);}
  finally{await bridge.close();}
}
const agent={id:'asq_config_proof',name:'Config proof',role:'Engineer',skills:[],projects:[{path:process.cwd()}],profileFiles:[{section:'persona',fileName:'PERSONA.md',content:'# Persona\nORIGINAL_PERSONALITY'}],permissions:{permissionMode:'restricted',builtInToolPolicyEnabled:true,builtInPolicies:{write_file:'allow'}}};
const provision=(bridge,member=agent)=>bridge.api('/api/agents/provision','POST',{agentId:member.id,agent:member,workspace:process.cwd()});
for(const kind of ['invalid-json','null','array','string','unreadable-path']) await check(kind+' config refuses preparation without changing the saved personality or reporting success',async bridge=>{
  assert.equal((await provision(bridge)).success,true);
  const home=join(bridge.directory,'app','agents',agent.id), config=join(home,'config.json'), profile=join(home,'profile.json');
  const saved=await readFile(profile,'utf8'), persona=JSON.parse(saved).profileDocs.files.find(file=>file.section==='persona').path;
  const originalPersona=await readFile(persona,'utf8');
  const damaged={ 'invalid-json':'{"permissions":', null:'null', array:'[]', string:'"invalid"' }[kind];
  if(damaged) await writeFile(config,damaged);
  else {await rename(config,join(home,'retained-config.json'));await mkdir(config);}
  const attempted={...agent,instructions:'New instructions awaiting a confirmed save.',profileFiles:[{section:'persona',fileName:'PERSONA.md',content:'# Persona\nUNCONFIRMED_PERSONALITY'}],permissions:{permissionMode:'restricted',builtInToolPolicyEnabled:true,builtInPolicies:{write_file:'block'}}};
  const response=await provision(bridge,attempted);
  assert.equal(response.success,false,'A config failure must not return successful preparation.');
  assert.match(response.error,/config|configuration|JSON|read/i);
  assert.equal(await readFile(profile,'utf8'),saved,'Failed config preparation must preserve the last confirmed profile.');
  assert.equal(await readFile(persona,'utf8'),originalPersona,'Failed config preparation must preserve authored personality files.');
  if(damaged) assert.equal(await readFile(config,'utf8'),damaged);
});
await check('runtime config write failure preserves the confirmed profile and retries after permissions recover',async bridge=>{
  assert.equal((await provision(bridge)).success,true);
  const home=join(bridge.directory,'app','agents',agent.id), profile=join(home,'profile.json'), config=join(home,'config.json');
  const original=await readFile(profile,'utf8'), originalConfig=await readFile(config,'utf8');
  const persona=JSON.parse(original).profileDocs.files.find(file=>file.section==='persona').path;
  const originalPersona=await readFile(persona,'utf8');
  const attempted={...agent,instructions:'CONFIRMED_ONLY_AFTER_RETRY',profileFiles:[{section:'persona',fileName:'PERSONA.md',content:'# Persona\nCONFIRMED_ONLY_AFTER_RETRY'}]};
  await chmod(home,0o500);
  try {
    const response=await provision(bridge,attempted);
    assert.equal(response.success,false);assert.match(response.error,/save.*config|permissions/i);
    assert.equal(await readFile(profile,'utf8'),original);assert.equal(await readFile(persona,'utf8'),originalPersona);
    assert.equal(await readFile(config,'utf8'),originalConfig);
  } finally {await chmod(home,0o700);}
  assert.equal((await provision(bridge,attempted)).success,true);
  assert.match(await readFile(persona,'utf8'),/CONFIRMED_ONLY_AFTER_RETRY/);
  assert.match(JSON.parse(await readFile(profile,'utf8')).instructions,/CONFIRMED_ONLY_AFTER_RETRY/);
});
await check('valid existing config customizations survive a confirmed permission update',async bridge=>{
  assert.equal((await provision(bridge)).success,true);
  const path=join(bridge.directory,'app','agents',agent.id,'config.json');
  const config=JSON.parse(await readFile(path,'utf8'));config.retainedCustomization={marker:'CUSTOM_CONFIG_PRESERVED'};
  await writeFile(path,JSON.stringify(config));
  assert.equal((await provision(bridge,{...agent,permissions:{permissionMode:'restricted',builtInToolPolicyEnabled:true,builtInPolicies:{write_file:'block'}}})).success,true);
  const saved=JSON.parse(await readFile(path,'utf8'));
  assert.deepEqual(saved.retainedCustomization,config.retainedCustomization);
  assert.ok(saved.permissions.excludedTools.some(tool=>tool.kind==='write_file'));
});
if(failures.length){console.error(JSON.stringify(failures,null,2));process.exitCode=1;}
else console.log(count+' member config checks passed (real bridge and persistence; no provider execution).');
