import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createOnboarding } from '../server/onboarding.mjs';

const directory = await mkdtemp(join(tmpdir(), 'squad-onboarding-state-'));
try {
  const first = join(directory,'web'), other=join(directory,'mobile');
  await mkdir(first); await mkdir(other);
  let state={channels:[],agentChannelAccess:{},deletedChannelIds:[]}, failProvision=true, failChannel=false, calls=0;
  const context={
    squadStateDir: directory,
    cleanWorkspace: async path=>path,
    getRuntime: ()=>({available:true,account:{signedIn:true},limits:{maxProjectsPerMember:3}}),
    readChannelsState: async()=>structuredClone(state),
    readOptionalJsonFile: async()=>null,
    provisionAgent: async ({agent})=>{calls++;if(failProvision){failProvision=false;throw new Error('fixture provision failed');}return {profileDocs:{files:[]},skillInstall:{installed:[],failed:[]}};},
    agentChannelActions:{setAccess:async(id,{agent})=>{state.agentChannelAccess[id]={agent:structuredClone(agent),removed:false};}},
    mutateChannelsState:async operation=>{if(failChannel){failChannel=false;throw new Error('fixture disk full');}return operation(state);},
  };
  const options={profile:async path=>({path,name:path===first?'web':'mobile',needs:path===first?['frontend']:['mobile'],git:{available:true,tracked:true,root:path}})};
  let setup=createOnboarding(context,options);
  await assert.rejects(setup.complete([]),/Choose between/);
  await assert.rejects(setup.complete([first]),/fixture provision failed/);
  const pending=await setup.read();
  assert.equal(pending.status,'preparing');
  assert.equal(Object.keys(state.agentChannelAccess).length,0);
  // Simulate the next process after an interrupted preparation.
  setup=createOnboarding(context,options); failChannel=true;
  await assert.rejects(setup.complete([first]),/fixture disk full/);
  assert.equal(Object.keys(state.agentChannelAccess).length,1);
  const id=pending.memberId;
  state.agentChannelAccess[id].agent.name='My coordinator';
  state.agentChannelAccess[id].agent.memory=['An authored preference'];
  const receipts=await Promise.all([setup.complete([first,other]),setup.complete([first,other])]);
  assert.equal(receipts[0].memberId,id); assert.equal(receipts[1].memberId,id);
  assert.equal(state.channels.length,1);
  assert.equal(Object.keys(state.agentChannelAccess).length,1);
  assert.equal(state.agentChannelAccess[id].agent.name,'My coordinator');
  assert.deepEqual(state.agentChannelAccess[id].agent.memory,['An authored preference']);
  assert.equal(state.agentChannelAccess[id].agent.projects.length,2,'changed selection during retry is applied');
  assert.equal(calls,3,'one failed provision, one prepared member, one explicit project change');
  state.agentChannelAccess[id].removed=true;state.channels=[];state.deletedChannelIds=['channel_general'];
  assert.equal((await setup.complete([])).member,null);
  assert.equal(state.channels.length,0,'completed replay does not recreate deleted channel');
  assert.equal(calls,3,'completed replay does not re-provision removed member');
  await writeFile(join(directory,'onboarding.json'),'{damaged');
  await assert.rejects(setup.complete([first]),error=>error.status===409 && /has been kept/.test(error.message));
  assert.equal(await readFile(join(directory,'onboarding.json'),'utf8'),'{damaged');
  for(const invalid of ['null','false','0','[]','{}']) {
    await writeFile(join(directory,'onboarding.json'),invalid);
    await assert.rejects(setup.read(),error=>error.status===409);
    assert.equal(await readFile(join(directory,'onboarding.json'),'utf8'),invalid);
  }
  await rm(join(directory,'onboarding.json'));
  state={channels:[{id:'existing',name:'my-channel'}],agentChannelAccess:{user_member:{agent:{name:'My team'},removed:false}},deletedChannelIds:[]};
  const before=JSON.stringify(state);
  assert.equal((await setup.read()).status,'existing');
  await assert.rejects(setup.complete([first]),error=>error.status===409);
  assert.equal(JSON.stringify(state),before,'existing squads are never replaced');
  console.log('PASS onboarding state: failed/interrupted provisioning, partial disk failure, stable identity, concurrent retry, changed repositories, authored settings, deletion, corruption, existing squad preservation');
} finally {await rm(directory,{recursive:true,force:true});}
