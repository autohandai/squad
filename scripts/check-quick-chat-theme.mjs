#!/usr/bin/env node
// Two real app documents in one disposable browser profile: storage events
// must update an already-open Quick Chat without navigating or losing drafts.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { initialAgents } from '../src/data.js';
import { SKINS } from '../src/lib/skins.js';
import { startBridge, startBrowser, until } from './lib/reliability-browser.mjs';

await mkdir('.codex-artifacts/appearance',{recursive:true});
const workspace=await mkdtemp(join(process.cwd(),'.codex-artifacts/appearance/quick-project-'));
const bridge=await startBridge(); let browser, quick;
async function connect(endpoint) {
  const ws=new WebSocket(endpoint);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  let sequence=0;const pending=new Map();
  ws.addEventListener('message',event=>{const result=JSON.parse(String(event.data)),entry=pending.get(result.id);if(!entry)return;pending.delete(result.id);clearTimeout(entry.timer);result.error?entry.reject(new Error(result.error.message)):entry.resolve(result.result);});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`${method} timed out`));},15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
  return {send,close:()=>ws.close(),evaluate:async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.text);return result.result.value;}};
}
try {
  browser=await startBrowser();
  const agent={...initialAgents[0],id:'theme-eva',name:'Eva',workspace,projects:[{path:workspace}],skills:[]};
  const storage={agents:[agent],removedAgents:initialAgents.map(member=>member.id),tasks:[],messages:{},channels:[],automations:[],onboarding:{version:1,status:'skipped',lastStep:'skipped'},skin:'soft',theme:{mode:'light',lightTheme:'autohand-light',darkTheme:'autohand-dark'}};
  await browser.send('Page.addScriptToEvaluateOnNewDocument',{source:`if(!localStorage.getItem('themeProof.seeded')){localStorage.clear();for(const[key,value]of Object.entries(${JSON.stringify(storage)}))localStorage.setItem('autohandSquad.v1.'+key,key==='skin'?value:JSON.stringify(value));localStorage.setItem('themeProof.seeded','true');}`});
  await browser.navigate(`${bridge.origin}/conversations/new?member=${agent.id}`);
  await until(()=>browser.evaluate(`document.documentElement.dataset.skin==='soft'&&!!document.querySelector('textarea')`),'main app ready',30000);
  const target=await(await fetch(`${browser.debugOrigin}/json/new?${encodeURIComponent('about:blank')}`,{method:'PUT'})).json();
  quick=await connect(target.webSocketDebuggerUrl);await quick.send('Page.enable');await quick.send('Runtime.enable');
  await quick.send('Emulation.setDeviceMetricsOverride',{width:380,height:520,deviceScaleFactor:1,mobile:false});
  await quick.send('Page.navigate',{url:`${bridge.origin}/quick-chat?member=${agent.id}`});
  await until(()=>quick.evaluate(`!!document.querySelector('[data-testid="quick-chat-conversation"] textarea')&&document.documentElement.dataset.skin==='soft'`),'Quick Chat inherits initial skin',30000);
  await quick.evaluate(`window.themeProofIdentity=crypto.randomUUID();const input=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Keep this unsent Quick Chat draft.');input.dispatchEvent(new Event('input',{bubbles:true}));`);
  const identity=await quick.evaluate('window.themeProofIdentity');
  const appearance=page=>page.evaluate(`({skin:document.documentElement.dataset.skin,surface:document.documentElement.dataset.themeSurface,background:getComputedStyle(document.documentElement).getPropertyValue('--background').trim(),radius:getComputedStyle(document.documentElement).getPropertyValue('--radius').trim(),font:getComputedStyle(document.body).fontFamily,paint:getComputedStyle(document.body).backgroundColor})`);
  for(const [skin,mode]of SKINS.flatMap(skin=>['light','dark'].map(mode=>[skin.id,mode]))){
    await browser.evaluate(`localStorage.setItem('autohandSquad.v1.skin',${JSON.stringify(skin)});localStorage.setItem('autohandSquad.v1.theme',JSON.stringify({mode:${JSON.stringify(mode)},lightTheme:'autohand-light',darkTheme:'autohand-dark'}));window.dispatchEvent(new Event('focus'));`);
    await until(async()=>{const current=await appearance(quick);return current.skin===skin&&current.surface===mode;},`already-open Quick Chat follows ${skin}/${mode}`,10000);
    assert.deepEqual(await appearance(quick),await appearance(browser));
    assert.equal(await quick.evaluate('window.themeProofIdentity'),identity,'theme changes never reload the conversation');
    assert.equal(await quick.evaluate(`document.querySelector('textarea').value`),'Keep this unsent Quick Chat draft.');
    if(skin==='grut') assert.ok(await quick.evaluate(`(() => {const avatar=document.querySelector('svg[viewBox="0 0 100 100"]');return avatar?.getBoundingClientRect().width>=32;})()`),'blob avatar fills its button rather than inheriting icon size');
    await quick.evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(resolve,200))))`);
    const shot=await quick.send('Page.captureScreenshot',{format:'png'});
    const {writeFile}=await import('node:fs/promises');await writeFile(`.codex-artifacts/appearance/quick-${skin}-${mode}.png`,Buffer.from(shot.data,'base64'));
  }
  await mkdir('.codex-artifacts/natural-workflows',{recursive:true});
  const shot=await quick.send('Page.captureScreenshot',{format:'png'});
  const {writeFile}=await import('node:fs/promises');await writeFile('.codex-artifacts/natural-workflows/quick-chat-theme.png',Buffer.from(shot.data,'base64'));
  assert.deepEqual(browser.errors,[]);
  console.log('Quick Chat appearance checks passed: all 8 skins in light and dark, cross-window tokens/type/paint, no reload and draft preservation.');
} finally {quick?.close();await browser?.close();await bridge.close();await rm(workspace,{recursive:true,force:true});}
