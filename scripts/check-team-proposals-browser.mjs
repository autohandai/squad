// Controlled engine, real managed MCP, durable run recovery and rendered app.
// All identities, workspaces and writes belong to this temporary fixture.
import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startBridge, startBrowser, until } from './lib/reliability-browser.mjs';

// This independent fix can land before or after the account-ownership change.
// When its harness is present, use its canonical owner-scoped browser seeding.
const ownedFixture=new URL('./lib/owned-bridge-fixture.mjs',import.meta.url);
const hasOwnedFixture=await access(ownedFixture).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
const owned=hasOwnedFixture?await import(ownedFixture.href):null;
const bridge=await startBridge({prepare:async directory=>{
  const entry=join(directory,'team-sdk.mjs');
  await mkdir(join(directory,'home','workspace'),{recursive:true});
  await writeFile(entry,[
    "import{readFileSync,appendFileSync}from'node:fs';",
    "const calls="+JSON.stringify(join(directory,'tools.jsonl'))+";",
    "export class AutohandSDK{",
    "constructor(options){this.options=options;}",
    "async start(){const config=JSON.parse(readFileSync(this.options.envVars.AUTOHAND_CONFIG,'utf8'));this.team=config.mcp.servers.find(server=>server.name==='autohand-squad');}",
    "async *streamPrompt(){const response=await fetch(this.team.env.AUTOHAND_SQUAD_TEAM_URL,{method:'POST',headers:{'content-type':'application/json','x-squad-team-token':this.team.env.AUTOHAND_SQUAD_TEAM_TOKEN},body:JSON.stringify({jsonrpc:'2.0',id:7,method:'tools/call',params:{name:'squad_propose_team',arguments:{name:'CST compliance',objective:'Review customer trust evidence',members:[{name:'Ada',role:'CST analyst',purpose:'Check security evidence'}]}}})});const result=await response.json();if(!response.ok||result.result?.isError)throw Error('Managed team proposal failed: '+JSON.stringify(result));appendFileSync(calls,JSON.stringify(result)+'\\n');yield{type:'message_end',content:'Review this proposed team before creating it.'};}",
    "async interrupt(){}async close(){}}",
  ].join('\n'));
  return {HOME:join(directory,'home'),USERPROFILE:join(directory,'home'),AUTOHAND_AGENT_SDK_ENTRY:entry,AUTOHAND_AGENT_SDK_DIR:directory,CODEX_HOME:join(directory,'home','codex')};
}});
const workspace=join(bridge.directory,'home','workspace');
const chief={id:'proposal-chief',name:'Chief of Staff',role:'Coordinator',workspace,projects:[{path:workspace}],status:'online',instructions:'Propose the requested team.',harness:{id:'autohand'},permissions:{permissionMode:'unrestricted'}};
let browser;
const seed=()=>owned?owned.seedOwnedBrowserFixture(bridge,browser):browser.send('Page.addScriptToEvaluateOnNewDocument',{source:"localStorage.setItem('autohandSquad.v1.onboarding',JSON.stringify({version:1,status:'skipped'}));localStorage.setItem('autohandSquad.v1.agents',"+JSON.stringify(JSON.stringify([chief]))+");"});
try{
  const channel=(await bridge.api('/api/channels','POST',{id:'proposal-general',name:'proposal-general',memberIds:[chief.id],projects:[{path:workspace}],replyMode:'channel'})).data;
  const turn=await bridge.api('/api/chat','POST',{agentId:chief.id,agent:chief,workspace,profile:'Fixture coordinator.',requestId:'saved-proposal-reply',prompt:'Propose a compliance team.',channel:{...channel,threadId:'proposal-thread',parentMessageId:'proposal-root'}});
  assert.equal(turn.success,true,JSON.stringify(turn));
  assert.equal(turn.data.channelActions[0].status,'proposed');
  assert.match(await readFile(join(bridge.directory,'tools.jsonl'),'utf8'),/proposed/,'the actual managed MCP registered the proposal');
  const state=(await bridge.api('/api/channels')).data;
  state.threads=[{id:'proposal-thread',channelId:channel.id,parentMessageId:'proposal-root',title:'A compliance team',createdAt:new Date().toISOString()}];
  // Reproduce old clients: the reply body was saved but its proposal was lost.
  state.messages=[
    {id:'proposal-root',channelId:channel.id,threadId:'proposal-thread',role:'user',body:'Propose a compliance team.',createdAt:new Date(Date.now()-2000).toISOString()},
    {id:'saved-proposal-reply',channelId:channel.id,threadId:'proposal-thread',parentMessageId:'proposal-root',role:'agent',agentId:chief.id,body:turn.data.reply,status:'complete',createdAt:new Date().toISOString()},
  ];
  await bridge.api('/api/channels','PUT',state);
  browser=await startBrowser();await seed();await browser.navigate(bridge.origin+'/channels/'+channel.id);
  await until(()=>browser.evaluate("document.querySelector('[data-testid=team-proposal]')?.textContent.includes('Create team')"),'saved completed channel reply recovers its actual MCP proposal',30000);
  await browser.screenshot('.codex-artifacts/team-proposals/channel-desktop.png');
  await browser.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
  await browser.screenshot('.codex-artifacts/team-proposals/channel-phone.png');
  assert.deepEqual(Object.keys((await bridge.api('/api/channels')).data.agentChannelAccess),[chief.id],'displaying a proposal creates nobody');
  await until(async()=>(await bridge.api('/api/channels')).data.messages.find(message=>message.id==='saved-proposal-reply')?.teamProposal?.proposal?.name==='CST compliance','proposal metadata saved with the channel reply');
  await bridge.api('/api/channels/'+channel.id,'PATCH',{replyMode:'thread'});
  await browser.navigate(bridge.origin+'/channels/'+channel.id);
  await until(()=>browser.evaluate("Boolean(document.querySelector('button[aria-label^=Thread]'))"),'thread disclosure');
  await browser.evaluate("document.querySelector('button[aria-label^=Thread]').click()");
  await until(()=>browser.evaluate("document.querySelector('[data-testid=team-proposal]')?.textContent.includes('Create team')"),'proposal available inside its reply thread');
  await browser.click('Not now');
  await until(async()=>(await bridge.api('/api/channels')).data.messages.find(message=>message.id==='saved-proposal-reply')?.teamProposalDecided==='dismissed','explicit proposal decision persisted');
  await browser.close();browser=null;await bridge.restart();
  browser=await startBrowser();await seed();await browser.navigate(bridge.origin+'/channels/'+channel.id);
  await until(()=>browser.evaluate("Boolean(document.querySelector('button[aria-label^=Thread]'))"),'saved thread after service and browser restart');
  await browser.evaluate("document.querySelector('button[aria-label^=Thread]').click()");
  await until(()=>browser.evaluate("document.querySelector('[data-testid=team-proposal]')?.textContent.includes('Not created.')"),'dismissal survives restart without recreating a pending decision');
  await browser.evaluate("(()=>{const input=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Propose another compliance team.');input.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await browser.click('Send');
  await until(async()=>(await readFile(join(bridge.directory,'tools.jsonl'),'utf8')).trim().split('\n').length>=2,'live channel turn calls the managed proposal tool');
  await until(()=>browser.evaluate("document.querySelectorAll('button[aria-label^=Thread]').length>=2"),'live reply thread');
  await browser.evaluate("[...document.querySelectorAll('button[aria-label^=Thread]')].at(-1).click()");
  await until(()=>browser.evaluate("[...document.querySelectorAll('[data-testid=team-proposal]')].some(row=>row.textContent.includes('Create team'))"),'live channel stream retains its proposed roster');
  await browser.evaluate("[...document.querySelectorAll('[data-testid=team-proposal] button')].find(button=>button.textContent.includes('Create team')).click()");
  const created=await until(async()=>{const state=(await bridge.api('/api/channels')).data;return Object.values(state.agentChannelAccess).some(access=>access.agent.name==='Ada')&&state.channels.some(channel=>channel.name==='cst-compliance')?state:null;},'Create team provisions the proposed member and channel through the existing importer',30000);
  assert.equal(Object.values(created.agentChannelAccess).filter(access=>access.agent.name==='Ada').length,1,'one click creates one member');
  assert.equal(created.channels.filter(channel=>channel.name==='cst-compliance').length,1,'one click creates one team channel');
  await until(async()=>(await bridge.api('/api/channels')).data.messages.some(message=>message.teamProposalDecided==='created'),'creation decision saved with its reply');
  await browser.navigate(bridge.origin+'/conversations/new?member='+chief.id);
  await until(()=>browser.evaluate("Boolean(document.querySelector('textarea'))"),'direct-message composer');
  await browser.evaluate("(()=>{const input=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Propose a team in this direct message.');input.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await browser.evaluate("document.querySelector('textarea').closest('form').requestSubmit()");
  await until(()=>browser.evaluate("document.querySelector('[data-testid=team-proposal]')?.textContent.includes('Create team')"),'direct-message proposal still renders from the actual managed MCP',30000);
  assert.equal(Object.keys((await bridge.api('/api/channels')).data.agentChannelAccess).length,2,'a new direct-message proposal does not create another member implicitly');
  assert.deepEqual(browser.errors,[]);
  console.log('PASS actual managed MCP proposal in direct messages and channel streams, completed-reply recovery, channel/thread rendering at desktop/390px, no implicit team creation, persisted dismissal across browser/service restart, and one explicit Create team through the real importer. Controlled SDK; no live provider or installed app work.');
}catch(error){console.error(await browser?.evaluate('document.body.innerText').catch(()=>''));console.error(bridge.logs.slice(-4000));throw error;}
finally{await browser?.close();await bridge.close();}
