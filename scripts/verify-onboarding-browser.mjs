import assert from 'node:assert/strict';
import { startBridge, startBrowser, until } from './lib/reliability-browser.mjs';

async function check(signedIn, run) {
  const bridge=await startBridge({signedIn}); let browser;
  try {browser=await startBrowser();await run(bridge,browser);assert.deepEqual(browser.errors,[]);}
  finally {await browser?.close();await bridge.close();}
}
await check(false,async(bridge,browser)=>{
  await browser.navigate(bridge.origin+'/squad');
  await until(()=>browser.evaluate(`!!document.querySelector('[data-testid="sign-in-gate"]')`),'account gate',30000);
  assert.equal(await browser.evaluate(`!!document.querySelector('main textarea')`),false);
  const runtime=(await bridge.api('/api/runtime')).data;
  assert.equal(runtime.account.signedIn,false);assert.ok(!('token' in runtime.account));
  console.log('PASS signed-out account gate and no exposed token');
});
await check(true,async(bridge,browser)=>{
  await browser.send('Page.addScriptToEvaluateOnNewDocument',{source:`
    const original=window.fetch.bind(window);window.fetch=async(input,options)=>{
      const response=await original(input,options);
      const path=new URL(typeof input==='string'?input:input.url,location.origin).pathname;
      if(path!=='/api/provider-settings')return response;
      const payload=await response.json();for(const provider of Object.values(payload.data.providers))provider.enabled=false;
      return new Response(JSON.stringify(payload),{headers:{'content-type':'application/json'}});
    };`});
  await browser.navigate(bridge.origin+'/');
  await until(()=>browser.evaluate(`document.body.textContent.includes('No model provider is configured')`),'provider blocker',30000);
  assert.equal(await browser.evaluate(`[...document.querySelectorAll('button')].find(item=>item.textContent==='Start with Chief of Staff')?.disabled`),true);
  assert.equal(await browser.evaluate(`document.body.textContent.includes('Skip for now')`),false);
  await browser.click('Open providers');
  await until(()=>browser.evaluate(`location.pathname==='/settings' && !!document.querySelector('#settings-providers')`),'provider settings deep link',30000);
  await until(()=>browser.evaluate(`document.body.textContent.includes('Workspace default')`),'provider controls');
  await browser.evaluate(`document.querySelector('[data-testid="settings-sections"] a[data-section="setup"]').click()`);
  await until(()=>browser.evaluate(`!!document.querySelector('#settings-setup button')`),'Settings setup');
  await browser.evaluate(`document.querySelector('#settings-setup button').click()`);
  await until(()=>browser.evaluate(`location.pathname==='/welcome' && !!document.querySelector('#first-run-repository')`),'resume setup');
  assert.equal((await bridge.api('/api/channels')).data.channels.length,0);
  console.log('PASS provider readiness, Settings recovery and no skipped or implicitly created team');
});
await check(true,async(bridge,browser)=>{
  await browser.send('Page.addScriptToEvaluateOnNewDocument',{source:`
    if(!sessionStorage.getItem('existing.seeded')){
      localStorage.setItem('autohandSquad.v1.onboarding',JSON.stringify({version:1,status:'completed'}));
      localStorage.setItem('autohandSquad.v1.agents',JSON.stringify([{id:'asq_existing',name:'My existing teammate',role:'Reviewer',workspace:${JSON.stringify(process.cwd())},description:'My description',instructions:'My authored instructions',memory:['Keep my preference'],skills:[],harness:{id:'autohand'}}]));
      localStorage.setItem('autohandSquad.v1.channels',JSON.stringify([{id:'channel_existing',name:'my-existing-channel',visibility:'public',memberIds:['asq_existing'],createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z'}]));
      localStorage.setItem('autohandSquad.v1.skin','paper');localStorage.setItem('autohandSquad.v1.theme',JSON.stringify({mode:'light'}));
      sessionStorage.setItem('existing.seeded','true');
    }`});
  await browser.navigate(bridge.origin+'/');
  await until(()=>browser.evaluate(`location.pathname==='/squad' && document.body.textContent.includes('My existing teammate')`),'existing squad',30000);
  assert.equal(await browser.evaluate(`JSON.parse(localStorage.getItem('autohandSquad.v1.agents')).length`),1);
  assert.equal(await browser.evaluate(`localStorage.getItem('autohandSquad.v1.skin')`),'paper');
  assert.equal(await browser.evaluate(`JSON.parse(localStorage.getItem('autohandSquad.v1.theme')).mode`),'light');
  assert.equal(await browser.evaluate(`JSON.parse(localStorage.getItem('autohandSquad.v1.agents'))[0].memory[0].text`),'Keep my preference');
  await browser.navigate(bridge.origin+'/welcome');
  await until(()=>browser.evaluate(`document.body.textContent.includes('Open your squad')`),'existing setup guide',30000);
  assert.equal(await browser.evaluate(`document.body.textContent.includes('Start with Chief of Staff')`),false);
  console.log('PASS existing roster, channels, authored memory and appearance are preserved');
});
// Full clean-install flow, actual provisioning, retries and explicit creation.
await import('./check-fresh-install.mjs');
