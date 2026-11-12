import assert from 'node:assert/strict';
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startBridge, startBrowser, until } from './lib/reliability-browser.mjs';
const ownerFixture=new URL('./lib/owned-bridge-fixture.mjs',import.meta.url);
const owned=await access(ownerFixture).then(()=>import(ownerFixture.href),error=>{if(error.code==='ENOENT')return null;throw error;});
const bridge=await startBridge({development:process.env.AUTOHAND_CHECK_PRODUCTION!=='1',prepare:async directory=>{
 const sdk=join(directory,'sdk.mjs');
 await writeFile(sdk,"export class AutohandSDK{async start(){}async close(){}async interrupt(){}async*streamPrompt(){throw Error('Export checks must not send a prompt.')}}");
 return {AUTOHAND_AGENT_SDK_ENTRY:sdk,AUTOHAND_AGENT_SDK_DIR:directory};
}});
let browser;
const agent={id:'export-fixture',name:'Export Bird',role:'Assistant',status:'online',workspace:bridge.directory,projects:[{path:bridge.directory}],harness:{id:'autohand'}};
const at=new Date().toISOString();
const messages=[{id:'export-q',role:'user',body:'Keep the exact café 🐦 text.',status:'complete',createdAt:at},{id:'export-a',role:'agent',body:'The report is ready.\n\n## Evidence\n\nExact café 🐦 bytes.',status:'complete',createdAt:at}];
try{
 browser=await startBrowser();
 const downloads=join(bridge.directory,'downloads');await mkdir(downloads);
 await browser.send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
 if(owned) await owned.seedOwnedBrowserFixture(bridge,browser,{members:[agent],messages:{[agent.id]:messages}});
 else await browser.send('Page.addScriptToEvaluateOnNewDocument',{source:`if(location.origin===${JSON.stringify(bridge.origin)}){localStorage.setItem('autohandSquad.v1.onboarding',JSON.stringify({version:1,status:'skipped'}));localStorage.setItem('autohandSquad.v1.agents',${JSON.stringify(JSON.stringify([agent]))});localStorage.setItem('autohandSquad.v1.messages',${JSON.stringify(JSON.stringify({[agent.id]:messages}))});}`});
 const channel=(await bridge.api('/api/channels','POST',{id:'export-channel',name:'export-channel',memberIds:[agent.id],projects:[{path:bridge.directory}]})).data;
 const state=(await bridge.api('/api/channels')).data;
 await bridge.api('/api/channels','PUT',{...state,threads:[{id:'export-thread',channelId:channel.id,parentMessageId:'export-root',title:'Export exact text',createdAt:at}],messages:[{...messages[0],id:'export-root',channelId:channel.id,threadId:'export-thread'},{...messages[1],channelId:channel.id,threadId:'export-thread',parentMessageId:'export-root',agentId:agent.id}]});
 await browser.navigate(bridge.origin+'/conversations/new?member='+agent.id);
 await until(()=>browser.evaluate("Boolean(document.querySelector('main button[aria-label=\"Actions for Export Bird\"]'))"),'conversation menu');
 await browser.evaluate("document.querySelector('main button[aria-label=\"Actions for Export Bird\"]').click()");
 await browser.click('Export conversation');
 const files=await until(async()=>{const files=await readdir(downloads);return files.some(name=>name.endsWith('.md'))&&files.some(name=>name.endsWith('.json'))&&!files.some(name=>name.endsWith('.crdownload'))?files:null;},'actual browser conversation files');
 const json=JSON.parse(await readFile(join(downloads,files.find(name=>name.endsWith('.json'))),'utf8'));
 assert.equal(json.member.id,agent.id);assert.ok(json.messages.some(message=>message.body.includes('café 🐦')));
 assert.match(await readFile(join(downloads,files.find(name=>name.endsWith('.md'))),'utf8'),/café 🐦/);
 await until(()=>browser.evaluate("document.querySelector('[data-testid=text-export-status]')?.textContent.includes('Download requested:')"),'browser request receipt without claiming disk success');
 await browser.navigate(bridge.origin+'/channels/'+channel.id);
 await until(()=>browser.evaluate("Boolean(document.querySelector('main header button[aria-label=Settings]'))"),'channel settings');
 await browser.evaluate("document.querySelector('main header button[aria-label=Settings]').click()");await browser.click('Export markdown');
 await until(()=>readFile(join(downloads,'export-channel-chat-log.md'),'utf8').then(text=>text.includes('café 🐦')),'actual channel file bytes');
 // Exercise the real rendered native branch, while marking IPC simulation
 // separately from the native filesystem tests and packaged-app proof.
 await browser.send('Emulation.setUserAgentOverride',{userAgent:'AutohandSquadDesktop/0.1.22 (macos; aarch64)'});
 await browser.send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__exportCalls=[];window.__TAURI_INTERNALS__={invoke:async(command,args)=>{if(command==='squad_save_text_export'){window.__exportCalls.push(args);if(window.__failJson&&args.filename.endsWith('.json'))throw 'Fixture disk full';return {saved:true,filename:args.filename.replace(/(\\.[^.]+)$/,' (1)$1'),bytes:new TextEncoder().encode(args.content).length};}return {supported:false};}};`});
 await browser.navigate(bridge.origin+'/conversations/new?member='+agent.id);
 await until(()=>browser.evaluate("Boolean(document.querySelector('main button[aria-label=\"Actions for Export Bird\"]'))"),'desktop conversation menu');
 await browser.evaluate("document.querySelector('main button[aria-label=\"Actions for Export Bird\"]').click()");await browser.click('Export conversation');
 await until(()=>browser.evaluate("document.querySelector('[data-testid=text-export-status]')?.textContent.includes('Saved in Downloads:')"),'native acknowledged status');
 const calls=await browser.evaluate('window.__exportCalls');assert.equal(calls.length,2);assert.ok(calls.every(call=>call.content.includes('café 🐦')));
 await browser.evaluate('window.__failJson=true');
 await browser.evaluate("document.querySelector('main button[aria-label=\"Actions for Export Bird\"]').click()");await browser.click('Export conversation');
 await until(()=>browser.evaluate("document.querySelector('[data-testid=text-export-status][role=alert]')?.textContent.includes('Fixture disk full')"),'visible partial failure');
 assert.match(await browser.evaluate("document.querySelector('[data-testid=text-export-status]').textContent"),/Saved in Downloads:/);
 await browser.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
 await browser.screenshot('.codex-artifacts/desktop-downloads/export-phone.png');
 assert.deepEqual(browser.errors,[]);
 console.log('PASS actual DM Markdown/JSON and channel Markdown browser files with UTF-8 content, rendered desktop save/partial-failure receipts, and 390px layout. Native IPC is simulated in this browser check; no provider prompt or installed app is used.');
}catch(error){console.error(await browser?.evaluate('document.body.innerText').catch(()=>''));console.error(bridge.logs.slice(-3000));throw error;}
finally{await browser?.close();await bridge.close();}
