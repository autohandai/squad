import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { roleTemplates } from '../src/data.js';
import { startBridge, startBrowser, until } from './lib/reliability-browser.mjs';

async function prepare(directory) {
  const skillsDir = join(directory, 'skill-repo');
  const skills = [...new Set(roleTemplates.flatMap(template => template.skills))].map(id => ({ id, name:id, directory:id, files:['SKILL.md'] }));
  for (const skill of skills) {
    await mkdir(join(skillsDir,skill.id),{recursive:true});
    await writeFile(join(skillsDir,skill.id,'SKILL.md'), `---\nname: ${skill.id}\ndescription: Disposable creation regression skill.\n---\nAssess only this test.\n`);
  }
  await writeFile(join(skillsDir,'registry.json'),JSON.stringify({skills}));
  const preload=join(directory,'skills.mjs');
  await writeFile(preload, `const original=globalThis.fetch;globalThis.fetch=(url,options)=>String(url)==='https://skilled.autohand.ai/skills-index.json'?Promise.resolve(new Response(${JSON.stringify(JSON.stringify({skills}))},{headers:{'content-type':'application/json'}})):original(url,options);`);
  const entry=join(directory,'sdk.mjs');
  await writeFile(entry, `export class AutohandSDK {async start(){} async close(){} async interrupt(){} async *streamPrompt(){yield {type:'message_end',content:'Controlled runtime reply.'};}}`);
  return {AUTOHAND_SKILLS_REPO_DIR:skillsDir,NODE_OPTIONS:`${process.env.NODE_OPTIONS||''} --import=${preload}`.trim(),AUTOHAND_AGENT_SDK_ENTRY:entry,AUTOHAND_AGENT_SDK_DIR:directory};
}
const failures=[];let count=0;
const selectedCase=process.argv.find(arg=>arg.startsWith('--case='))?.slice('--case='.length);
async function check(label,run) {
  if(selectedCase && !label.includes(selectedCase)) return;
  const bridge=await startBridge({prepare});let browser;
  try {browser=await startBrowser();await run(bridge,browser);count++;console.log('PASS '+label);}
  catch(error){
    failures.push({label,error:error.message});console.error('FAIL '+label+': '+error.message);
    if(browser) await writeFile('.codex-artifacts/reliability/member-creation-failure-state.json',JSON.stringify(await browser.evaluate(`({path:location.pathname,fields:[...document.querySelectorAll('[role="dialog"] input,[role="dialog"] textarea')].map(input=>({placeholder:input.placeholder})),tabs:[...document.querySelectorAll('[role="tab"]')].map(tab=>({text:tab.innerText,selected:tab.getAttribute('aria-selected')}))})`).catch(()=>null),null,2));
  }
  finally{await browser?.close();await bridge.close();}
}
async function enter(bridge,browser,{onboarding=false}={}) {
  await browser.send('Page.addScriptToEvaluateOnNewDocument',{source:`
    if (!sessionStorage.getItem('creation.seeded')) {
      if (!${onboarding}) localStorage.setItem('autohandSquad.v1.onboarding',JSON.stringify({version:1,status:'skipped'}));
      sessionStorage.setItem('creation.seeded','true');sessionStorage.setItem('creation.fail','true');sessionStorage.setItem('creation.calls','[]');
    }
    const original=window.fetch.bind(window);window.fetch=async(input,options)=>{
      const path=new URL(typeof input==='string'?input:input.url,location.origin).pathname;
      if(path==='/api/agents/provision') {
        const calls=JSON.parse(sessionStorage.getItem('creation.calls'));calls.push(JSON.parse(options.body));sessionStorage.setItem('creation.calls',JSON.stringify(calls));
        await new Promise(resolve=>setTimeout(resolve,200));
        if(sessionStorage.getItem('creation.fail')==='true') {sessionStorage.setItem('creation.failed','true');return new Response(JSON.stringify({success:false,error:'Temporary member preparation failure. Retry.'}),{status:503,headers:{'content-type':'application/json'}});}
      }
      const response=await original(input,options);
      if(path==='/api/agents/provision' && sessionStorage.getItem('creation.hold')==='true') {
        sessionStorage.setItem('creation.prepared','true');
        return new Promise(()=>{});
      }
      return response;
    };`});
  await browser.navigate(bridge.origin+(onboarding?'/': '/squad-members/new?workspace='+encodeURIComponent(process.cwd())));
  if(onboarding) {
    await until(()=>browser.evaluate(`location.pathname==='/welcome' && document.body.textContent.includes('Point at a folder.')`),'fresh first run');
    const folder=(await bridge.api('/api/runtime')).data.defaultWorkspace;
    await browser.click('Use '+folder.split('/').pop());
    await until(()=>browser.evaluate(`!document.body.textContent.includes('Looking at the folder…') && [...document.querySelectorAll('button')].some(button=>button.innerText==='Create someone else…' && !button.disabled)`),'alternate member entry');
    await browser.click('Create someone else…');
  }
  await until(()=>browser.evaluate(`document.body.textContent.includes('New Squad member')`),'creation form');
}
async function select(browser) {
  await browser.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent.includes('Or start from a ready-made role')).click()`);
  await until(()=>browser.evaluate(`!!document.querySelector('[role="radiogroup"] [role="radio"]')`),'role picker');
  await browser.evaluate(`[...document.querySelectorAll('[role="radiogroup"] [role="radio"]')].find(button=>button.textContent.includes('Frontend Developer')).click()`);
  await until(()=>browser.evaluate(`!!document.querySelector('#member-name')`),'member draft');
  await browser.fill('#member-name','Recovered member');
  await browser.click('How it will work');
  await browser.fill('#member-instructions','CUSTOM_INSTRUCTIONS_PRESERVED: report observed facts and ask before editing.');
}
const calls=browser=>browser.evaluate(`JSON.parse(sessionStorage.getItem('creation.calls'))`);
const members=browser=>browser.evaluate(`JSON.parse(localStorage.getItem('autohandSquad.v1.agents'))`);
const submit=browser=>browser.evaluate(`document.querySelector('#member-name').form.requestSubmit()`);

await check('failed member preparation keeps the form and never publishes a phantom member',async(bridge,browser)=>{
  await enter(bridge,browser);await select(browser);
  await browser.fill('#member-name','   ');await submit(browser);
  assert.equal((await calls(browser)).length,0,'An empty member name must not prepare a runtime.');
  await browser.fill('#member-name','Recovered member');await submit(browser);
  await until(()=>browser.evaluate(`sessionStorage.getItem('creation.failed')==='true'`),'injected failed preparation');
  assert.equal(await browser.evaluate(`location.pathname`),'/squad-members/new','Failure must stay on the editable draft.');
  await until(()=>browser.evaluate(`!!document.querySelector('[role="alert"]')?.textContent.includes('Temporary member preparation failure')`),'visible preparation failure');
  const requested=(await calls(browser))[0].agentId;
  assert.ok(!(await members(browser)).some(member=>member.id===requested));
  assert.equal(await browser.evaluate(`document.querySelector('#member-name').value`),'Recovered member');
  await browser.evaluate(`document.querySelector('[role="alert"]').scrollIntoView({block:'center'})`);
  await browser.screenshot('.codex-artifacts/reliability/member-creation-failure.png');
});
await check('rapid submit and refresh retry use one identity and preserve custom instructions',async(bridge,browser)=>{
  await enter(bridge,browser);await select(browser);
  await browser.evaluate(`(() => {const form=document.querySelector('#member-name').form;form.requestSubmit();form.requestSubmit();form.requestSubmit();})()`);
  await until(()=>browser.evaluate(`sessionStorage.getItem('creation.failed')==='true'`),'duplicate failed preparation');
  assert.equal((await calls(browser)).length,1,'One pending creation must produce one request.');
  const id=(await calls(browser))[0].agentId;
  await browser.navigate(bridge.origin+'/squad-members/new?workspace='+encodeURIComponent(process.cwd()));
  await until(()=>browser.evaluate(`!!document.querySelector('#member-name')`),'restored creation draft');
  assert.equal(await browser.evaluate(`document.querySelector('#member-name').value`),'Recovered member');
  await browser.click('How it will work');
  assert.match(await browser.evaluate(`document.querySelector('#member-instructions').value`),/CUSTOM_INSTRUCTIONS_PRESERVED/);
  await browser.evaluate(`sessionStorage.setItem('creation.fail','false')`);await submit(browser);
  await until(()=>browser.evaluate(`location.pathname==='/conversations/new'`),'confirmed creation navigation',20000);
  const requests=await calls(browser);assert.equal(requests.length,2);assert.equal(requests[1].agentId,id);
  assert.equal((await members(browser)).filter(member=>member.id===id).length,1);
  const profile=JSON.parse(await readFile(join(bridge.directory,'app','agents',id,'profile.json'),'utf8'));
  assert.match(profile.instructions,/CUSTOM_INSTRUCTIONS_PRESERVED/);assert.equal(profile.name,'Recovered member');
  await bridge.restart();await browser.navigate(bridge.origin+'/');
  await until(()=>browser.evaluate(`document.body.textContent.includes('Recovered member')`),'confirmed roster after restart');
  assert.deepEqual(browser.errors,[]);
});
await check('alternate first-run creation completes only after preparation and drafts its first conversation',async(bridge,browser)=>{
  await enter(bridge,browser,{onboarding:true});await select(browser);await submit(browser);
  await until(()=>browser.evaluate(`sessionStorage.getItem('creation.failed')==='true'`),'alternate failed preparation');
  assert.equal((await browser.evaluate(`JSON.parse(localStorage.getItem('autohandSquad.v1.onboarding'))`)).status,'active');
  assert.equal(await browser.evaluate(`location.pathname`),'/squad-members/new');
  await browser.evaluate(`sessionStorage.setItem('creation.fail','false')`);await submit(browser);
  await until(()=>browser.evaluate(`location.pathname==='/conversations/new'`),'confirmed alternate first member',20000);
  const saved=await browser.evaluate(`JSON.parse(localStorage.getItem('autohandSquad.v1.onboarding'))`);
  assert.equal(saved.status,'completed');assert.equal(saved.memberId,(await calls(browser))[0].agentId);
  assert.ok(await browser.evaluate(`document.querySelector('main textarea')?.value.length>0`),'Alternate setup must draft the first prompt.');
  await browser.screenshot('.codex-artifacts/reliability/member-creation-confirmed.png');
  await bridge.restart();await browser.navigate(bridge.origin+'/');
  await until(()=>browser.evaluate(`location.pathname!=='/welcome' && document.body.textContent.includes('Recovered member')`),'alternate setup survives restart');
  assert.deepEqual(browser.errors,[]);
});
await check('handwritten role preserves its authored personality and brain card across a failed save and refresh',async(bridge,browser)=>{
  await enter(bridge,browser);
  await browser.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent.includes('Or start from a ready-made role')).click()`);
  await browser.click('Write one yourself');
  await until(()=>browser.evaluate(`!!document.querySelector('[role="dialog"] input[placeholder^="Example:"]')`),'custom template dialog');
  await browser.fill('[role="dialog"] input[placeholder^="Example:"]','Evidence analyst');
  await browser.fill('[role="dialog"] textarea[placeholder^="Shown on the role card"]','Reports reproducible evidence and uncertainty.');
  const tab=await browser.evaluate(`(() => {const rect=[...document.querySelectorAll('[role="dialog"] [role="tab"]')].find(tab=>tab.innerText==='Manual').getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};})()`);
  await browser.send('Input.dispatchMouseEvent',{type:'mousePressed',...tab,button:'left',clickCount:1});
  await browser.send('Input.dispatchMouseEvent',{type:'mouseReleased',...tab,button:'left',clickCount:1});
  await until(()=>browser.evaluate(`!!document.querySelector('[role="dialog"] textarea[placeholder^="Describe personality"]')`),'manual personality field');
  await browser.fill('[role="dialog"] textarea[placeholder^="Describe personality"]','AUTHORED_PERSONALITY: be concise, distinguish observations and assumptions.');
  await browser.evaluate(`document.querySelector('[role="dialog"] form').requestSubmit()`);
  await until(()=>browser.evaluate(`!!document.querySelector('#member-name') && !document.querySelector('[role="dialog"]')`),'handwritten member draft');
  await browser.fill('#member-name','Recovered analyst');
  await browser.fill('#member-role','GTM APAC Leader');
  await browser.click('How it will work');
  await until(()=>browser.evaluate(`!!document.querySelector('#member-brain-purpose')`),'editable custom purpose');
  await browser.fill('#member-brain-purpose','AUTHORED_PURPOSE: investigate failures with reproducible evidence.');
  await submit(browser);
  await until(()=>browser.evaluate(`!!document.querySelector('[role="alert"]')?.textContent.includes('Temporary member preparation failure')`),'handwritten preparation error');
  const id=(await calls(browser))[0].agentId;
  await browser.navigate(bridge.origin+'/squad-members/new?workspace='+encodeURIComponent(process.cwd()));
  await until(()=>browser.evaluate(`!!document.querySelector('#member-name')`),'restored handwritten role');
  assert.equal(await browser.evaluate(`document.querySelector('#member-name').value`),'Recovered analyst');
  assert.equal(await browser.evaluate(`document.querySelector('#member-role').value`),'GTM APAC Leader');
  await browser.click('How it will work');
  assert.match(await browser.evaluate(`document.querySelector('#member-brain-purpose').value`),/AUTHORED_PURPOSE/);
  await browser.evaluate(`sessionStorage.setItem('creation.fail','false')`);await submit(browser);
  await until(()=>browser.evaluate(`location.pathname==='/conversations/new'`),'confirmed handwritten member',20000);
  assert.equal((await calls(browser))[1].agentId,id);
  const profile=JSON.parse(await readFile(join(bridge.directory,'app','agents',id,'profile.json'),'utf8'));
  assert.equal(profile.role,'GTM APAC Leader');assert.match(profile.brainCard.purpose,/AUTHORED_PURPOSE/);
  assert.match(profile.instructions,/^Act as GTM APAC Leader\./);
  assert.match(profile.profileFiles.find(file=>file.section==='persona').content,/AUTHORED_PERSONALITY/);
  assert.equal((await members(browser)).filter(member=>member.id===id).length,1);
  await browser.navigate(bridge.origin+'/squad-members/new?workspace='+encodeURIComponent(process.cwd()));
  await until(()=>browser.evaluate(`document.body.textContent.includes('New Squad member')`),'new creation after confirmed save');
  assert.equal(await browser.evaluate(`document.querySelector('#member-name')`),null,'A confirmed draft must clear before another member is created.');
  assert.deepEqual(browser.errors,[]);
});
await check('interrupted acknowledgement recovers the prepared member with the same identity after refresh',async(bridge,browser)=>{
  await enter(bridge,browser);await select(browser);
  await browser.evaluate(`sessionStorage.setItem('creation.fail','false');sessionStorage.setItem('creation.hold','true')`);
  await submit(browser);
  await until(()=>browser.evaluate(`sessionStorage.getItem('creation.prepared')==='true'`),'prepared response held before acknowledgement',20000);
  const id=(await calls(browser))[0].agentId;
  assert.equal(JSON.parse(await readFile(join(bridge.directory,'app','agents',id,'profile.json'),'utf8')).name,'Recovered member');
  assert.ok(!(await members(browser)).some(member=>member.id===id));
  await browser.navigate(bridge.origin+'/squad-members/new?workspace='+encodeURIComponent(process.cwd()));
  await until(()=>browser.evaluate(`document.querySelector('[role="alert"]')?.textContent.includes('Preparation was interrupted')`),'interrupted preparation recovery');
  assert.equal(await browser.evaluate(`document.querySelector('#member-name').value`),'Recovered member');
  await browser.evaluate(`sessionStorage.setItem('creation.hold','false')`);await submit(browser);
  await until(()=>browser.evaluate(`location.pathname==='/conversations/new'`),'recovered confirmed member',20000);
  assert.equal((await calls(browser))[1].agentId,id);assert.equal((await members(browser)).filter(member=>member.id===id).length,1);
  assert.deepEqual(browser.errors,[]);
});
if(failures.length){console.error(JSON.stringify(failures,null,2));process.exitCode=1;}
else console.log(count+' member-creation checks passed (real bridge/browser and provisioning; fixture skills/runtime, injected failures).');
