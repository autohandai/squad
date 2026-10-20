#!/usr/bin/env node
// Real React + bridge + managed MCP, with a disposable Codex protocol fixture.
// Provider execution is deliberately separate from this rendered proof.
import assert from "node:assert/strict";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { initialAgents, initialChannels } from "../src/data.js";
import { delay, startBridge, startBrowser, until } from "./lib/reliability-browser.mjs";

const root = process.cwd();
const artifacts = resolve(".codex-artifacts/team-channels");
await mkdir(artifacts, { recursive: true });
let fixtureDirectory;
const bridge = await startBridge({ prepare: async directory => {
  fixtureDirectory = directory;
  const executable = join(directory, "fixture-codex");
  await mkdir(join(directory, "codex"), { recursive: true });
  await writeFile(join(directory, "codex", "auth.json"), "{}");
  await writeFile(executable, `#!${process.execPath}
const fs=require('node:fs'), child=require('node:child_process'), readline=require('node:readline');
const toml=require(${JSON.stringify(join(root, "node_modules/toml"))});
const args=process.argv.slice(2), member=process.env.AUTOHAND_SQUAD_MEMBER;
if(args[0]==='--version'){console.log('codex 1.0.0');process.exit(0);}
if(args[0]==='login'){console.log('Logged in using fixture');process.exit(0);}
const prompt=args.at(-1).split('</operating_instructions>').pop().split('</turn_context>').pop();
const emit=x=>console.log(JSON.stringify(x));
const say=text=>{emit({type:'thread.started',thread_id:'fixture-'+member});emit({type:'item.completed',item:{type:'agent_message',text}});emit({type:'turn.completed'});};
(async()=>{
  if(/change your name to Viggas/i.test(prompt)){
    const merged=args.flatMap((value,index)=>value==='-c'?[toml.parse(args[index+1])]:[]);
    const field=suffix=>merged.find(value=>value.mcp_servers?.['autohand-squad']?.[suffix]!==undefined)?.mcp_servers['autohand-squad'][suffix];
    const proxy=child.spawn(field('command'),field('args'),{env:{...process.env,...field('env')},stdio:['pipe','pipe','pipe']});
    const pending=new Map();let id=0;
    readline.createInterface({input:proxy.stdout}).on('line',line=>{const result=JSON.parse(line);pending.get(result.id)?.(result);});
    const rpc=(method,params)=>new Promise(resolve=>{const next=++id;pending.set(next,resolve);proxy.stdin.write(JSON.stringify({jsonrpc:'2.0',id:next,method,params})+'\\n');});
    await rpc('initialize',{protocolVersion:'2025-06-18'});
    const response=await rpc('tools/call',{name:'squad_set_profile',arguments:{name:'Viggas',description:'Owns release QA.',personality:'Calm and precise.'}});
    proxy.kill();
    if(response.result?.isError)throw Error(response.result.content[0].text);
    say('I changed my saved Squad profile to Viggas.');return;
  }
  if(/channel-proof/.test(prompt)){
    fs.writeFileSync(${JSON.stringify(join(directory, "started-"))}+member,'started');
    const end=Date.now()+45000;
    while(!fs.existsSync(${JSON.stringify(join(directory, "release-"))}+member)){if(Date.now()>end)throw Error('Fixture gate timed out');await new Promise(resolve=>setTimeout(resolve,50));}
    if(member==='proof-noah')throw Error('Fixture review failed before producing an answer.');
    say('Viggas finished the channel review.');return;
  }
  say('Fixture follow-up received.');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
`);
  await chmod(executable, 0o700);
  return { CODEX_HOME: join(directory, "codex"), OPENAI_API_KEY: "fixture-only-no-provider" };
} });
let browser;
const member = (id, name) => ({ id, name, role: "QA Engineer", status: "online", description: "Browser verification member.", workspace: root, projects: [{ id: "proof-project", name: "Squad", path: root }], avatar: "/avatars/birds/kiwi.webp", staffId: id, memory: [], skills: [], stats: {}, permissions: {}, modelAssignment: { mode: "inherit" }, harness: { id: "codex", executablePath: join(fixtureDirectory, "fixture-codex") } });
const agents = [member("proof-eva", "Eva"), member("proof-noah", "Noah")];
const storage = {
  agents, removedAgents: initialAgents.map(agent => agent.id), tasks: [], memoryInbox: [], channels: [],
  channelMessages: {}, channelThreads: {}, channelReads: Object.fromEntries(initialChannels.map(channel => [channel.id, new Date().toISOString()])),
  agentReads: {}, messages: {}, automations: [], onboarding: { version: 1, status: "skipped", lastStep: "skipped" },
  theme: { mode: "light", lightTheme: "autohand-light", darkTheme: "autohand-dark" }, sidebarCollapsed: false,
};
try {
  for (const agent of agents) assert.equal((await bridge.api(`/api/members/${agent.id}/channel-access`, "PUT", { agent, profile: "" })).success, true);
  const created = await bridge.api("/api/channels", "POST", { id: "proof-room", name: "release-qa", memberIds: agents.map(agent => agent.id), projects: [{ name: "Squad", path: root }] });
  assert.equal(created.success, true);
  storage.channels = [created.data];
  browser = await startBrowser();
  await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: `if (!localStorage.getItem('teamProof.seeded')) { localStorage.clear(); for (const [key,value] of Object.entries(${JSON.stringify(storage)})) localStorage.setItem('autohandSquad.v1.'+key,JSON.stringify(value)); localStorage.setItem('teamProof.seeded','true'); }` });
  await browser.navigate(bridge.origin + "/squad");
  await until(() => browser.evaluate(`!!document.querySelector('aside button[aria-label*="Eva"]')`), "Eva in sidebar", 30000);
  await browser.evaluate(`document.querySelector('aside button[aria-label*="Eva"]').click()`);
  await until(() => browser.evaluate(`!!document.querySelector('textarea[placeholder*="Eva"]')`), "Eva chat composer");
  await browser.fill('textarea[placeholder*="Eva"]', "change your name to Viggas");
  await browser.evaluate(`document.querySelector('textarea[placeholder*="Eva"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true}));`);
  await until(() => browser.evaluate(`!!document.querySelector('textarea[placeholder*="Viggas"]') && !!document.querySelector('aside button[aria-label*="Viggas"]') && document.querySelector('main')?.innerText.includes('I changed my saved Squad profile to Viggas.')`), "MCP rename in header, sidebar, composer and delivered reply", 30000);
  assert.equal(await browser.evaluate(`document.querySelector('main header')?.innerText.includes('Viggas')`), true);
  const profile = JSON.parse(await readFile(join(fixtureDirectory, "app/agents/proof-eva/profile.json"), "utf8"));
  assert.equal(profile.name, "Viggas");
  assert.equal(profile.description, "Owns release QA.");
  assert.ok(profile.profileRevision > 0);
  await browser.screenshot(join(artifacts, "mcp-profile-updated.png"));
  await browser.navigate(bridge.origin + "/channels/proof-room");
  await until(() => browser.evaluate(`!!document.querySelector('textarea[aria-label="Message #release-qa"]')`), "channel composer");
  await browser.fill('textarea[aria-label="Message #release-qa"]', "channel-proof: please review this release");
  await browser.click("Send");
  await until(async () => (await readFile(join(fixtureDirectory, "started-proof-eva"), "utf8").catch(() => "")) && (await readFile(join(fixtureDirectory, "started-proof-noah"), "utf8").catch(() => "")), "both actual fixture turns started", 30000);
  await until(() => browser.evaluate(`!!document.querySelector('button[aria-label="Thread: 0 replies · 2 working"]')`), "truthful pending thread summary");
  assert.equal(await browser.evaluate(`document.querySelector('main').innerText.includes('Viggas and Noah replied')`), false);
  await browser.screenshot(join(artifacts, "channel-pending-no-replies.png"));
  await writeFile(join(fixtureDirectory, "release-proof-eva"), "go");
  await until(() => browser.evaluate(`!!document.querySelector('button[aria-label="Thread: 1 reply · 1 working"]')`), "one completed answer and one still working");
  await writeFile(join(fixtureDirectory, "release-proof-noah"), "go");
  await until(() => browser.evaluate(`!!document.querySelector('button[aria-label="Thread: 1 reply · 1 failed"]')`), "failed work is not a reply");
  assert.equal(await browser.evaluate(`document.querySelector('main').innerText.includes('Noah replied')`), false);
  assert.equal(await browser.evaluate(`document.querySelector('main').innerText.includes('Viggas finished the channel review.')`), false, "the answer is grouped in its collapsed thread");
  await browser.click("Thread: 1 reply · 1 failed");
  await until(() => browser.evaluate(`document.querySelector('[aria-label="Thread replies"]')?.innerText.includes('Viggas finished the channel review.')`), "actual answer rendered inside the thread");
  await browser.screenshot(join(artifacts, "channel-thread-expanded.png"));
  await browser.click("Reply in thread");
  await until(() => browser.evaluate(`document.querySelector('main').innerText.includes('Replying to')`), "thread reply targets the original thread");
  await browser.click("Cancel");
  await browser.evaluate(`document.querySelector('main header button[aria-label="Settings"]').click()`);
  await until(() => browser.evaluate(`!!document.querySelector('#channel-details-replies')`), "reply display setting");
  await browser.evaluate(`document.querySelector('#channel-details-replies').click()`);
  await until(() => browser.evaluate(`!![...document.querySelectorAll('[role="option"]')].find(option=>option.textContent==='In the channel')`), "reply display choices");
  await browser.evaluate(`[...document.querySelectorAll('[role="option"]')].find(option=>option.textContent==='In the channel').click()`);
  await browser.click("Save channel");
  await until(async () => (await bridge.api("/api/channels")).data.channels.find(channel => channel.id === "proof-room")?.replyMode === "channel", "reply display setting saved");
  await browser.screenshot(join(artifacts, "channel-reply-settings.png"));
  await browser.navigate(bridge.origin + "/channels/proof-room");
  await until(() => browser.evaluate(`document.querySelector('main').innerText.includes('Viggas finished the channel review.')`), "direct answers after reload");
  assert.equal(await browser.evaluate(`!!document.querySelector('button[aria-label^="Thread:"]')`), false);
  await browser.screenshot(join(artifacts, "channel-direct-replies.png"));
  await bridge.restart();
  await browser.navigate(bridge.origin + "/channels/proof-room");
  await until(() => browser.evaluate(`document.querySelector('main').innerText.includes('Viggas finished the channel review.')`), "saved transcript after bridge restart", 30000);
  assert.equal((await bridge.api("/api/channels")).data.channels.find(channel => channel.id === "proof-room").replyMode, "channel");
  assert.deepEqual(browser.errors, []);
  console.log(`Team/channel browser checks passed: MCP rename updates the delivered answer, sidebar and composer; pending/completed/failed fan-out, thread expansion and reply targeting, direct mode and restart persistence. Screenshots: ${artifacts}`);
} catch (error) {
  if (browser) await browser.screenshot(join(artifacts, "failure.png")).catch(() => {});
  console.error(bridge.logs.slice(-3000));
  throw error;
} finally {
  if (browser) await browser.close();
  await bridge.close();
}
