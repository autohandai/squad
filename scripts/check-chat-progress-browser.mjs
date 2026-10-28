import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {initialAgents} from '../src/data.js';
import {startBridge,startBrowser,until} from './lib/reliability-browser.mjs';

const artifact='.codex-artifacts/chat-latency-20261028';
await mkdir(artifact,{recursive:true});
const bridge=await startBridge();let browser;
try {
 const member={...initialAgents[0],id:'chat-progress-fixture',name:'Eva',workspace:bridge.directory,projects:[{path:bridge.directory}]};
 const start='2026-10-28T03:41:11.000Z',end='2026-10-28T03:41:53.000Z';
 const events=[
  {type:'status',status:'session_peer_joined',label:'session peer joined',timestamp:start},
  {type:'status',status:'hook_pre_prompt',label:'hook pre prompt',timestamp:start},
  {type:'message_delta',thought:'Synthetic internal diagnostic',timestamp:end},
  {type:'message_delta',delta:'Hey! What can I help you with?',timestamp:end},
  {type:'message_end',content:'Hey! What can I help you with?',timestamp:end},
  {type:'status',status:'agent_end',timestamp:end}
 ];
 const toolEvents=[...events.slice(0,3),{type:'tool_start',tool:{id:'read-one',name:'read_file',args:{path:'package.json'}},timestamp:start},{type:'tool_end',toolId:'read-one',toolName:'read_file',success:true,output:'Configuration read.',timestamp:end},{type:'tool_start',tool:{id:'run-one',name:'bash',args:{command:'bun run check'}},timestamp:start},{type:'tool_end',toolId:'run-one',toolName:'bash',success:true,output:'Checks passed.',timestamp:end},{type:'message_end',content:'Checked the project.',timestamp:end}];
 const messages=[{id:'greeting-user',role:'user',body:'hey',status:'complete'},{id:'greeting-answer',role:'agent',body:'Hey! What can I help you with?',status:'complete',startedAt:start,completedAt:end,durationMs:42000,streamEvents:events,trace:{events,toolCalls:[]}},{id:'tool-answer',role:'agent',body:'Checked the project.',status:'complete',startedAt:start,completedAt:end,durationMs:1200,streamEvents:toolEvents}];
 browser=await startBrowser();
 await browser.send('Page.addScriptToEvaluateOnNewDocument',{source:`
 localStorage.setItem('autohandSquad.v1.agents',${JSON.stringify(JSON.stringify([member]))});
 localStorage.setItem('autohandSquad.v1.removedAgents',${JSON.stringify(JSON.stringify(initialAgents.filter(a=>a.id!==member.id).map(a=>a.id)))});
 localStorage.setItem('autohandSquad.v1.onboarding','{"version":1,"status":"skipped"}');
 localStorage.setItem('autohandSquad.v1.messages',${JSON.stringify(JSON.stringify({[member.id]:messages}))});
 const originalFetch=window.fetch.bind(window);window.fetch=(input,options)=>new URL(typeof input==='string'?input:input.url,location.origin).pathname==='/api/chat/warm'?Promise.resolve(new Response('{"success":true,"data":{}}',{headers:{'content-type':'application/json'}})):originalFetch(input,options);
 `});
 await browser.navigate(bridge.origin+'/conversations/new?member='+member.id);
 await until(()=>browser.evaluate("document.querySelector('[data-message-id=greeting-answer]')?.textContent.includes('Hey! What can I help you with?')"),'greeting rendered');
 await browser.screenshot(artifact+'/greeting-progress.png');
 const text=await browser.evaluate("document.querySelector('[data-message-id=greeting-answer]').textContent");
 assert(!text.includes('Work details'),'A reply without tool work must not display a multi-step work trace');
 assert(!/session peer joined|hook pre prompt|Synthetic internal diagnostic/.test(text),'Transport and reasoning diagnostics stay out of normal replies');
 assert(text.includes('42 sec'),'A reply without work details still keeps its measured duration');
 assert.equal(await browser.evaluate("document.querySelector('[data-message-id=tool-answer] details').open"),false,'Real tool work stays collapsed by default');
 await browser.evaluate("document.querySelector('[data-message-id=tool-answer] details summary').click()");
 const toolText=await browser.evaluate("document.querySelector('[data-message-id=tool-answer]').textContent");
 assert(toolText.includes('2 tools'),'Only actual tool calls contribute to the receipt count');
 assert(!/session peer joined|hook pre prompt|Synthetic internal diagnostic|Raw ·/.test(toolText),'Expanded work shows actions, with diagnostics behind the explicit setting');
 assert.equal((toolText.match(/Checked the project\./g)||[]).length,1,'The answer is not repeated as a work step');
 assert.deepEqual(browser.errors,[]);
 console.log('PASS greeting renders its answer and timing without internal work steps or diagnostic details; actual chat component, fixture engine only.');
} finally {await browser?.close();await bridge.close();}
