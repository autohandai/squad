#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectObserver, readProjectObservation, parseObserverOpportunity, localMarkerOpportunity } from '../server/project-observer.mjs';
import { blueprintObservationEnvelope, createProjectObserverReview, unsupportedObserver, DESTINATION_UNSUPPORTED_MESSAGE } from '../server/project-observer-review.mjs';
import { handle } from '../server/routes/project-observer.route.mjs';

const root=await mkdtemp(join(tmpdir(),'squad-observer-check-'));
const minute=60_000;
let clock=Date.parse('2026-10-02T10:00:00Z');
const wait=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
const agent={id:'eva',name:'Eva',role:'QA engineer',status:'online',harness:{id:'autohand'},projects:[{path:join(root,'project')}],profile:'Report validation gaps with evidence.',apiKey:'do-not-persist-this'};
const proposal=(observation)=>({opportunity:{title:'Cover the unchecked parser branch',body:'The parser still marks input validation as unfinished.',nextStep:'Add a focused invalid-input check before changing behavior.',evidenceIds:[observation.evidence[0].id]}});
try{
  await mkdir(join(root,'project','src'),{recursive:true});
  await mkdir(join(root,'project','node_modules','ignored'),{recursive:true});
  await writeFile(join(root,'project','src','parser.js'),'// TODO: validate malformed input\nexport const parse = value => value;\n');
  await writeFile(join(root,'project','.env'),'API_KEY=never-send-this-secret');
  await writeFile(join(root,'project','auth.json'),'secret-token');
  await writeFile(join(root,'project','node_modules','ignored','noise.js'),'do not observe dependencies');
  await writeFile(join(root,'outside.js'),'out-of-project-secret');
  await symlink(join(root,'outside.js'),join(root,'project','src','external.js'));
  await writeFile(join(root,'project','src','sensitive.js'),'private member-excluded code');
  const scopedAgent={...agent,permissions:{sensitivePaths:['src/sensitive.js']}};
  const first=await readProjectObservation(agent.projects[0].path,scopedAgent);
  assert.equal(first.evidence.length,1);assert.equal(first.evidence[0].path,'src/parser.js');
  assert.ok(!JSON.stringify(first).includes('never-send-this-secret'));assert.ok(!JSON.stringify(first).includes('out-of-project-secret'));
  assert.equal(first.coverage.scannedFiles,1);
  await writeFile(join(root,'project','src','parser.js'),'// TODO: validate malformed input including empty arrays\nexport const parse = value => value;\n');
  const changed=await readProjectObservation(agent.projects[0].path,scopedAgent);assert.notEqual(first.fingerprint,changed.fingerprint);
  await assert.rejects(readProjectObservation('/'),/home\/root/);
  assert.throws(()=>parseObserverOpportunity({opportunity:{title:'Fake bug',body:'Claim',nextStep:'Fix',evidenceIds:['invented']}},first),/supplied evidence/);
  const envelope=blueprintObservationEnvelope(agent,first);assert.ok(Buffer.byteLength(JSON.stringify(envelope))<8192);assert.equal(envelope.artifacts[1].id,first.evidence[0].id);
  const localLead=localMarkerOpportunity(first);assert.equal(localLead.reviewMode,'local-marker');assert.equal(localLead.evidence[0].line,1);assert.match(localLead.body,/not a verified defect or a model review/);
  const localInput=(text,path='src/parser.js')=>({...first,evidence:[{...first.evidence[0],path,line:10,text}]});
  assert.equal(localMarkerOpportunity(localInput('const TODO = "validate malformed input";')),null);
  assert.equal(localMarkerOpportunity(localInput('// TODO:')),null);
  assert.equal(localMarkerOpportunity(localInput('// TODO: api_key=sk-this-should-never-be-reported')),null);
  assert.equal(localMarkerOpportunity(localInput('[sensitive line omitted]')),null);
  assert.equal(localMarkerOpportunity(localInput('TODO: investigate malformed input')),null,'bare identifier is not a source comment');
  assert.equal(localMarkerOpportunity(localInput('TODO: investigate malformed input','README.md')).evidence[0].line,10);
  assert.equal(localMarkerOpportunity(localInput('export const x = 1;\n// FIXME: handle invalid input\n')).evidence[0].line,11);
  const secretProject=join(root,'secret-marker-project');await mkdir(secretProject);
  await writeFile(join(secretProject,'parser.js'),'// TODO: api_key=sk-never-report-this-source-secret\n// FIXME: handle invalid input before parsing\n');
  const redacted=await readProjectObservation(secretProject,agent);assert.ok(!JSON.stringify(redacted).includes('sk-never-report-this-source-secret'));assert.equal(localMarkerOpportunity(redacted).evidence[0].line,2,'real source secret is omitted before selecting a safe note');
  const emptyForest=join(root,'many-empty-folders');await mkdir(emptyForest);await Promise.all(Array.from({length:135},(_,i)=>mkdir(join(emptyForest,`folder-${i}`))));await writeFile(join(emptyForest,'README.md'),'An assigned project with many generated empty folders.');
  const forestObservation=await readProjectObservation(emptyForest,agent);assert.equal(forestObservation.coverage.discovery,'bounded-folders');assert.equal(forestObservation.coverage.limited,true,'empty directories are bounded even when fewer than 500 files exist');assert.equal(forestObservation.coverage.maxDirectories,100);

  let state={signedIn:true};let calls=0;const emitted=[];
  const observer=new ProjectObserver({squadStateDir:join(root,'state'),watch:false,now:()=>clock,getRuntimeState:async()=>state,inspect:async()=>first,review:async({observation})=>{calls++;return proposal(observation);},emit:(name,data)=>emitted.push({name,data})});
  await observer.update({members:[scopedAgent]});await observer.tick();assert.equal(calls,1);assert.equal((await observer.snapshot()).notices.length,1);
  assert.equal(emitted.filter(e=>e.name==='project.opportunity').length,1);assert.equal(emitted.filter(e=>e.name==='chat.finished').length,1);
  assert.ok(!(await readFile(join(root,'state','project-observer.json'),'utf8')).includes('do-not-persist-this'));
  assert.equal((await stat(join(root,'state','project-observer.json'))).mode&0o777,0o600);
  clock+=60*minute;await observer.tick();assert.equal(calls,1,'unchanged projects use no provider quota');
  observer.inspect=async()=>changed;await observer.tick();assert.equal(calls,1,'scan cadence is not bypassed');
  clock+=30*minute;await observer.tick();assert.equal(calls,2);assert.equal((await observer.snapshot()).notices.length,1,'same concrete opportunity never duplicates across fingerprints');
  const restored=new ProjectObserver({squadStateDir:join(root,'state'),watch:false,now:()=>clock,getRuntimeState:async()=>state,inspect:async()=>changed,review:async()=>{calls++;return proposal(changed);}});
  clock+=60*minute;await restored.tick();assert.equal(calls,2,'restart preserves reviewed fingerprint and notices');
  assert.equal((await restored.snapshot()).notices.length,1);

  for(const unavailable of [{signedIn:false},{signedIn:true,onBreak:true},{signedIn:true,offline:true},{signedIn:true,busy:true},{signedIn:true,activeTask:true},{signedIn:true,remote:true}]){
    const blocked=new ProjectObserver({squadStateDir:join(root,`eligibility-${JSON.stringify(unavailable).length}-${Object.keys(unavailable).at(-1)}`),watch:false,now:()=>clock,getRuntimeState:async()=>unavailable,inspect:async()=>{throw new Error('must not inspect');},review:async()=>{throw new Error('must not spend quota');}});
    await blocked.update({members:[agent]});await blocked.tick();assert.equal((await blocked.snapshot()).notices.length,0);assert.equal((await blocked.snapshot()).limits.total,0);
  }
  await observer.update({settings:{observeAssignedProjects:false}});clock+=60*minute;observer.inspect=async()=>{throw new Error('disabled cannot inspect');};await observer.tick();assert.equal(calls,2);
  const noProject=new ProjectObserver({squadStateDir:join(root,'no-project'),watch:false,getRuntimeState:async()=>state,review:async()=>{throw new Error('no assigned project');}});await noProject.update({members:[{...agent,projects:[]}]});await noProject.tick();assert.equal((await noProject.snapshot()).observations.length,0);

  // Failure backoff persists across restart; unsupported stays explicit.
  let failures=0;
  const failing=new ProjectObserver({squadStateDir:join(root,'failure'),watch:false,now:()=>clock,getRuntimeState:async()=>state,inspect:async()=>first,review:async()=>{failures++;throw new Error('fixture provider unavailable');}});
  await failing.update({members:[agent]});await failing.tick();assert.equal(failures,1);assert.equal((await failing.snapshot()).observations[0].status,'backoff');
  clock+=30*minute;await failing.tick();assert.equal(failures,1);clock+=31*minute;await failing.tick();assert.equal(failures,2);assert.equal((await failing.snapshot()).observations[0].failureCount,2);
  const budget=new ProjectObserver({squadStateDir:join(root,'budget'),watch:false,now:()=>clock,getRuntimeState:async()=>state,inspect:async()=>({...first,fingerprint:String(clock)}),review:async()=>({opportunity:null})});
  await budget.update({members:[agent],settings:{maxReviewsPerMemberPerDay:1}});await budget.tick();clock+=60*minute;await budget.tick();assert.equal((await budget.snapshot()).limits.total,1);assert.equal((await budget.snapshot()).observations[0].status,'budget');
  let unsupportedCalls=0;
  const localState=join(root,'local-only');let localObservation=first;
  const localOptions={squadStateDir:localState,watch:false,now:()=>clock,getRuntimeState:async()=>state,inspect:async()=>localObservation,review:async()=>{unsupportedCalls++;throw unsupportedObserver(DESTINATION_UNSUPPORTED_MESSAGE,{kind:'inference_destination_blocked',retryable:false});}};
  const localObserver=new ProjectObserver(localOptions);await localObserver.update({members:[agent]});await localObserver.tick();
  const localSnapshot=await localObserver.snapshot();assert.equal(localSnapshot.observations[0].status,'unsupported');assert.equal(localSnapshot.observations[0].failureCount,0);assert.equal(localSnapshot.observations[0].retryable,false);assert.equal(localSnapshot.observations[0].errorKind,'inference_destination_blocked');assert.equal(localSnapshot.notices[0].reviewMode,'local-marker');assert.equal(localSnapshot.limits.total,1);
  clock+=30*minute;await localObserver.tick();assert.equal(unsupportedCalls,1);assert.equal((await localObserver.snapshot()).observations[0].status,'unsupported','unchanged unsupported cannot turn into caught-up or backoff');
  localObservation={...first,fingerprint:'moved-note',evidence:[{...first.evidence[0],line:9}]};clock+=60*minute;
  const localRestored=new ProjectObserver(localOptions);await localRestored.tick();assert.equal(unsupportedCalls,1,'known unsupported config uses local checking without recurring RPC attempts');assert.equal((await localRestored.snapshot()).notices.length,1,'moving marker and restarting do not repeat a DM');
  localObservation=localInput('// TODO: api_key=sk-this-should-never-be-reported');localObservation.fingerprint='secret-note';clock+=60*minute;await localRestored.tick();assert.equal((await localRestored.snapshot()).notices.length,1,'no safe marker remains quiet');assert.ok(!(await readFile(join(localState,'project-observer.json'),'utf8')).includes('sk-this-should-never-be-reported'));
  state={signedIn:true,onBreak:true};clock+=60*minute;await localRestored.tick();assert.equal((await localRestored.snapshot()).limits.total,3,'break cannot spend a local review attempt');state={signedIn:true};
  await localRestored.update({members:[{...agent,harness:{id:'codex'}}]});await localRestored.tick();assert.equal(unsupportedCalls,2,'changing selected harness invalidates unsupported capability cache');assert.equal((await localRestored.snapshot()).observations[0].reviewMode,'unavailable');assert.equal((await localRestored.snapshot()).notices.length,1,'external harness unsupported does not receive Autohand-only fallback');

  // Upgrade a persisted pre-classifier hosted denial without retrying inference
  // or resetting the old cooldown, quotas and delivered local finding.
  const legacyDir=join(root,'legacy-hosted-denial');await mkdir(legacyDir);
  const legacy=JSON.parse(await readFile(join(root,'failure','project-observer.json'),'utf8'));
  const legacyEntry=Object.values(legacy.observations)[0];
  const existingLocal=JSON.parse(await readFile(join(localState,'project-observer.json'),'utf8'));
  Object.assign(legacyEntry,{error:'Inference destination hosted is not authorized for classified Ask evidence.',status:'cooldown',unsupported:null,lastAttemptAt:clock,nextScanAt:clock+30*minute,nextReviewAt:clock+60*minute});
  legacy.notices=existingLocal.notices;legacy.dedupe=existingLocal.dedupe;
  legacy.daily={date:new Date(clock).toISOString().slice(0,10),total:3,byMember:{eva:2}};
  await writeFile(join(legacyDir,'project-observer.json'),JSON.stringify(legacy));
  let legacyScans=0,legacyReviews=0;
  const legacyOptions={squadStateDir:legacyDir,watch:false,now:()=>clock,getRuntimeState:async()=>state,inspect:async()=>{legacyScans++;return first;},review:async()=>{legacyReviews++;throw new Error('legacy denial must not retry inference');}};
  const migrated=new ProjectObserver(legacyOptions);const migratedSnapshot=await migrated.snapshot();
  assert.equal(migratedSnapshot.observations[0].status,'unsupported');assert.equal(migratedSnapshot.observations[0].unsupported.message,DESTINATION_UNSUPPORTED_MESSAGE);assert.equal(migratedSnapshot.observations[0].reviewMode,'local-marker');assert.equal(migratedSnapshot.observations[0].failureCount,0);assert.equal(migratedSnapshot.observations[0].errorKind,'inference_destination_blocked');assert.equal(migratedSnapshot.observations[0].retryable,false);
  for(const key of ['lastAttemptAt','nextScanAt','nextReviewAt'])assert.equal(migratedSnapshot.observations[0][key],legacyEntry[key],`migration preserves ${key}`);
  assert.deepEqual(migratedSnapshot.limits,legacy.daily);assert.deepEqual(migratedSnapshot.notices,legacy.notices);
  const migratedFile=JSON.parse(await readFile(join(legacyDir,'project-observer.json'),'utf8'));assert.deepEqual(migratedFile.dedupe,legacy.dedupe);assert.equal(Object.values(migratedFile.observations)[0].unsupported.kind,'inference_destination_blocked','classification persists immediately');
  await migrated.tick();assert.equal(legacyScans,0,'migration keeps the existing next scan deadline');assert.equal(legacyReviews,0);
  clock+=61*minute;await migrated.tick();assert.equal(legacyScans,1);assert.equal(legacyReviews,0,'first eligible local scan sends no provider request');assert.equal((await migrated.snapshot()).notices.length,legacy.notices.length,'old delivered marker is not repeated');assert.equal((await migrated.snapshot()).limits.total,4,'local check retains prior attempt budget');
  const migratedAgain=new ProjectObserver(legacyOptions);await migratedAgain.tick();assert.equal(legacyReviews,0);assert.equal((await migratedAgain.snapshot()).limits.total,4,'restart does not reset quotas');
  for(const [label,harness,error] of [['other-harness','codex',legacyEntry.error],['other-error','autohand','fixture provider unavailable']]){
    const dir=join(root,`legacy-${label}`);await mkdir(dir);const untouched=structuredClone(legacy);untouched.members[0].harness={id:harness};Object.values(untouched.observations)[0].error=error;await writeFile(join(dir,'project-observer.json'),JSON.stringify(untouched));
    const unchanged=new ProjectObserver({...legacyOptions,squadStateDir:dir});const snap=await unchanged.snapshot();assert.equal(snap.observations[0].unsupported,null);assert.equal(snap.observations[0].failureCount,legacyEntry.failureCount);assert.equal(snap.observations[0].error,error,'unrelated failures remain untouched');
  }

  // Foreground work wins, including a review whose provider never resolves.
  let began=false;
  const interruptible=new ProjectObserver({squadStateDir:join(root,'interrupt'),watch:false,now:()=>clock,getRuntimeState:async()=>state,inspect:async()=>first,review:async()=>{began=true;return new Promise(()=>{});}});
  await interruptible.update({members:[agent]});const pending=interruptible.tick();while(!began)await wait(1);interruptible.deferMember('eva');await pending;assert.equal((await interruptible.snapshot()).notices.length,0);assert.equal((await interruptible.snapshot()).observations[0].status,'waiting');
  let inspections=0;
  const oneCycle=new ProjectObserver({squadStateDir:join(root,'one-cycle'),watch:false,now:()=>clock,getRuntimeState:async()=>state,inspect:async()=>first,review:async()=>{inspections++;return {opportunity:null};}});
  await oneCycle.update({members:[agent,{...agent,id:'kai'}]});await Promise.all([oneCycle.tick(),oneCycle.tick()]);assert.equal(inspections,1,'global cycle and concurrent polls cannot create a burst of reviews');
  let failedAttempts=0;
  const failedCycle=new ProjectObserver({squadStateDir:join(root,'failed-cycle'),watch:false,now:()=>clock,getRuntimeState:async()=>state,inspect:async()=>first,review:async()=>{failedAttempts++;throw new Error('fixture review failed');}});
  await failedCycle.update({members:[agent,{...agent,id:'kai'}]});await failedCycle.tick();assert.equal(failedAttempts,1,'one failed attempt must not cascade through every idle member in the same cycle');
  let cheapScans=0;
  const cooldown=new ProjectObserver({squadStateDir:join(root,'cooldown-scan'),watch:false,now:()=>clock,getRuntimeState:async()=>state,inspect:async()=>{cheapScans++;return {...first,fingerprint:String(clock)};},review:async()=>({opportunity:null})});
  await cooldown.update({members:[agent]});await cooldown.tick();clock+=30*minute;await cooldown.tick();assert.equal(cheapScans,2,'normal provider cooldown still permits the promised cheap scan cadence');assert.equal((await cooldown.snapshot()).limits.total,1);assert.equal((await cooldown.snapshot()).observations[0].status,'cooldown');
  let lateState={signedIn:true};
  const lateBusy=new ProjectObserver({squadStateDir:join(root,'late-busy'),watch:false,now:()=>clock,getRuntimeState:async()=>lateState,inspect:async()=>first,review:async()=>{lateState={signedIn:true,busy:true};return proposal(first);}});
  await lateBusy.update({members:[agent]});await lateBusy.tick();assert.equal((await lateBusy.snapshot()).notices.length,0,'a completed review cannot publish after real work begins');

  // API read and registration shapes; requesting a scan cannot waive limits.
  const responses=[];const ctx={projectObserver:observer,json:(_res,status,payload)=>responses.push({status,payload}),readBody:async()=>({settings:{observeAssignedProjects:false}})};
  assert.equal(await handle({method:'GET'},{},new URL('http://x/api/project-observer'),ctx),true);assert.equal(responses.at(-1).payload.data.settings.observeAssignedProjects,false);
  await handle({method:'POST'},{},new URL('http://x/api/project-observer'),ctx);await handle({method:'GET'},{},new URL('http://x/api/project-observer/notices'),ctx);assert.equal(responses.at(-1).payload.data.length,1);

  // Actual subprocess transports, isolated from vendor accounts/providers.
  const fake=join(root,'fixture-harness');const commands=join(root,'commands.jsonl');
  await writeFile(fake,`#!${process.execPath}
const fs=require('node:fs'),readline=require('node:readline');const args=process.argv.slice(2),file=${JSON.stringify(commands)};
const log=x=>fs.appendFileSync(file,JSON.stringify(x)+'\\n');
if(args.includes('--help')){console.log('--answer-only --client-context --restricted --tools --safe-mode --strict-mcp-config --no-session-persistence --disable-slash-commands --sandbox read-only --ephemeral --ignore-user-config');process.exit(0);}
log({kind:'start',args,cwd:process.cwd()});
const result={opportunity:{title:'Cover parser branch',body:'The parser has an unfinished validation note.',nextStep:'Add a focused validation test.',evidenceIds:[${JSON.stringify(first.evidence[0].id)}]}};
if(args.includes('--answer-only')){readline.createInterface({input:process.stdin}).on('line',line=>{const req=JSON.parse(line);log({kind:'rpc',method:req.method});if(req.method==='autohand.answer'&&process.env.FIXTURE_RPC_ERROR){console.log(JSON.stringify({jsonrpc:'2.0',id:req.id,error:{code:-32025,message:'Inference destination hosted is not authorized for classified Ask evidence.',data:{kind:process.env.FIXTURE_RPC_ERROR,retryable:false}}}));return;}const answer=req.method==='autohand.runtimeInspect'?{answerOnly:true,permissionMode:'restricted',clientContext:'blueprint',authentication:'configured',inferenceDestination:{kind:process.env.FIXTURE_DESTINATION||'in_process'},toolsEnabled:process.env.FIXTURE_BAD_PROFILE==='1',hooksEnabled:false,mcpEnabled:false,memoryEnabled:false,sessionPersistenceEnabled:false}:{contractVersion:1,result};console.log(JSON.stringify({jsonrpc:'2.0',id:req.id,result:answer}));});}
else if(args[0]==='exec'){console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(result)}}));console.log(JSON.stringify({type:'turn.completed'}));}
else{console.log(JSON.stringify({type:'assistant',message:{content:[{type:'text',text:JSON.stringify(result)}]}}));console.log(JSON.stringify({type:'result',subtype:'success'}));}
`);await chmod(fake,0o700);
  const review=createProjectObserverReview({readiness:async()=>({executablePath:fake}),prepareAutohandRuntime:async()=>({cliPath:fake,configPath:join(root,'dummy-config.json')})});
  for(const id of ['autohand','codex','claude']){const member={...agent,harness:{id,model:'chosen-model'}};const response=await review({member,workspace:agent.projects[0].path,observation:first,prompt:'Observe only the supplied evidence',signal:new AbortController().signal});assert.equal(parseObserverOpportunity(response,first).title,'Cover parser branch');}
  const seen=(await readFile(commands,'utf8')).trim().split('\n').map(JSON.parse);const starts=seen.filter(row=>row.kind==='start');assert.equal(starts.length,3);assert.ok(starts.every(row=>row.cwd!==agent.projects[0].path));
  const codex=starts.find(row=>row.args[0]==='exec');assert.equal(codex.args[codex.args.indexOf('--sandbox')+1],'read-only');assert.ok(codex.args.includes('--ignore-user-config'));assert.ok(!codex.args.includes('resume'));
  const claude=starts.find(row=>row.args[0]==='-p');assert.equal(claude.args[claude.args.indexOf('--tools')+1],'');assert.ok(claude.args.includes('--safe-mode'));assert.ok(!claude.args.includes('--resume'));
  assert.deepEqual(seen.filter(row=>row.kind==='rpc').map(row=>row.method),['autohand.runtimeInspect','autohand.answer']);
  const unsafe=createProjectObserverReview({prepareAutohandRuntime:async()=>({cliPath:fake,configPath:join(root,'dummy-config.json'),envVars:{FIXTURE_BAD_PROFILE:'1'}})});
  await assert.rejects(unsafe({member:agent,workspace:agent.projects[0].path,observation:first,prompt:'Observe',signal:new AbortController().signal}),error=>error.code==='OBSERVER_UNSUPPORTED');
  const afterUnsafe=(await readFile(commands,'utf8')).trim().split('\n').map(JSON.parse);assert.equal(afterUnsafe.filter(row=>row.method==='autohand.answer').length,1,'unsafe runtime acknowledgement prevents any inference request');
  for(const destination of ['hosted','local_service','opaque','unknown']){
    const blockedReview=createProjectObserverReview({prepareAutohandRuntime:async()=>({cliPath:fake,configPath:join(root,'dummy-config.json'),envVars:{FIXTURE_DESTINATION:destination}})});
    await assert.rejects(blockedReview({member:agent,workspace:agent.projects[0].path,observation:first,prompt:'Observe',signal:new AbortController().signal}),error=>error.code==='OBSERVER_UNSUPPORTED'&&error.kind==='inference_destination_blocked'&&error.retryable===false&&error.destination===destination);
  }
  const afterDestinations=(await readFile(commands,'utf8')).trim().split('\n').map(JSON.parse);assert.equal(afterDestinations.filter(row=>row.method==='autohand.answer').length,1,'unsupported destinations never receive source artifacts');
  const rejectedAnswer=createProjectObserverReview({prepareAutohandRuntime:async()=>({cliPath:fake,configPath:join(root,'dummy-config.json'),envVars:{FIXTURE_RPC_ERROR:'inference_destination_blocked'}})});
  await assert.rejects(rejectedAnswer({member:agent,workspace:agent.projects[0].path,observation:first,prompt:'Observe',signal:new AbortController().signal}),error=>error.code==='OBSERVER_UNSUPPORTED'&&error.kind==='inference_destination_blocked'&&error.retryable===false&&error.rpcCode===-32025&&error.message===DESTINATION_UNSUPPORTED_MESSAGE,'RPC policy errors preserve classification and do not leak internal denial copy');
  for(const row of starts)await assert.rejects(stat(row.cwd),error=>error.code==='ENOENT');
  console.log('Project observer checks passed: bounded real-file evidence, secret/path exclusions, eligibility, cooldown/dedupe/restart/budgets/backoff, foreground interruption, one review/cycle, routes, isolated harness fixtures, pre-evidence destination gates and honest local-marker fallback.');
}finally{await rm(root,{recursive:true,force:true});}
