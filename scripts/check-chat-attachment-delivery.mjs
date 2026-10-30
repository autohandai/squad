import assert from "node:assert/strict";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startBridge, until } from "./lib/reliability-browser.mjs";
import { attachmentFixtures } from "./lib/attachment-fixtures.mjs";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV2sAAAAASUVORK5CYII=", "base64");
const bridge = await startBridge({ prepare: async directory => {
  const entry = join(directory, "attachment-sdk.mjs");
  await writeFile(entry, `import {appendFileSync} from 'node:fs';
    export class AutohandSDK {
      constructor(){} async start(){} async close(){} async interrupt(){}
      async *streamPrompt(params){
        appendFileSync(${JSON.stringify(join(directory, "calls.jsonl"))}, JSON.stringify(params)+'\\n');
        yield {type:'message_end',content:'Fixture received the request.'};
      }
    }`);
  const codexHome = join(directory, "codex"); await mkdir(codexHome); await writeFile(join(codexHome, "auth.json"), '{"fixture":true}');
  const executable = join(directory, "codex-fixture");
  await writeFile(executable, `#!${process.execPath}\nconst fs=require('node:fs');const args=process.argv.slice(2);
    if(args[0]==='--version'){console.log('codex 0.130.0');process.exit(0);}
    if(args[0]==='login'){console.log('Logged in using ChatGPT');process.exit(0);}
    const images=[];for(let i=0;i<args.length;i++)if(args[i]==='--image')images.push({path:args[++i],data:fs.readFileSync(args[i]).toString('base64')});
    fs.appendFileSync(${JSON.stringify(join(directory, "codex-calls.jsonl"))}, JSON.stringify({images,prompt:args.at(-1)})+'\\n');
    console.log(JSON.stringify({type:'thread.started',thread_id:'attachment-codex-thread'}));
    console.log(JSON.stringify({type:'item.completed',item:{id:'answer',type:'agent_message',text:'Codex fixture received attachments.'}}));
    console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}}));`);
  await chmod(executable, 0o700);
  return { AUTOHAND_AGENT_SDK_ENTRY: entry, AUTOHAND_AGENT_SDK_DIR: directory, CODEX_HOME: codexHome };
} });
let remoteBridge;
try {
  const agent = { id: "attachment-delivery-fixture", name: "Iris", role: "Reviewer", workspace: process.cwd(), projects: [{ path: process.cwd() }], permissions: { permissionMode: "unrestricted" }, harness: { id: "autohand" } };
  const payload = { agentId: agent.id, agent, workspace: process.cwd(), profile: "Attachment delivery fixture" };
  assert.equal((await bridge.api("/api/agents/provision", "POST", payload)).success, true);
  const upload = await fetch(`${bridge.origin}/api/attachments`, { method: "POST", headers: { "x-file-name": "screenshot.png", "content-type": "image/png" }, body: png });
  const record = (await upload.json()).data;
  assert(record?.id, "image upload saved");
  const reply = await bridge.api("/api/chat", "POST", { ...payload, prompt: "Describe the attached image.", attachments: [record] }, 20000);
  assert.equal(reply.success, true, JSON.stringify(reply));
  const calls = (await readFile(join(bridge.directory, "calls.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(calls[0].images?.length, 1, "The actual Autohand SDK call must receive the uploaded image, not text alone");
  assert.equal(calls[0].images[0].data, png.toString("base64"), "Original image bytes reach the native payload");
  assert.equal(calls[0].images[0].mimeType, "image/png");
  const fixtures = await attachmentFixtures();
  const records = [];
  for (const fixture of fixtures) {
    const response = await fetch(`${bridge.origin}/api/attachments`, { method: "POST", headers: { "x-file-name": encodeURIComponent(fixture.name), "content-type": "application/octet-stream" }, body: fixture.bytes });
    const saved = (await response.json()).data; assert(saved?.id, fixture.name);
    assert.equal(saved.mime, fixture.mime, `${fixture.name} infers a useful MIME type even when a desktop drop supplies none`);
    const download = await fetch(bridge.origin + saved.url);
    assert.equal(download.headers.get("content-type"), fixture.mime);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), fixture.bytes, `${fixture.name} retains exact original bytes`);
    records.push(saved);
  }
  const svg = records.find(file => file.name === "diagram.svg");
  const preview = await fetch(`${bridge.origin}/api/attachments/${svg.id}/preview`, { method: "POST", headers: { "content-type": "image/png" }, body: png });
  assert.equal(preview.status, 200); Object.assign(svg, (await preview.json()).data);
  const matrix = await bridge.api("/api/chat", "POST", { ...payload, prompt: "Review these files.", attachments: records.map(file => ({ ...file, path: "/forged/path", mime: "forged/type" })) }, 20000);
  assert.equal(matrix.success, true, JSON.stringify(matrix));
  const readCalls = async () => (await readFile(join(bridge.directory, "calls.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
  const all = (await readCalls()).at(-1);
  assert.equal(all.images.length, 3, "PNG, JPEG and SVG's PNG derivative reach native image input");
  assert.equal(all.context.files.length, 7, "PDF, Word, spreadsheets, font and CSV reach native file context");
  for (const file of records) assert(all.message.includes(file.path), `Actual server path reaches the request: ${file.name}`);
  assert(!JSON.stringify(all).includes("/forged/path"), "Caller paths and MIME cannot choose files to read");
  assert.equal((await bridge.api("/api/chat", "POST", { ...payload, prompt: "Reject missing file", attachments: [{ id: "zzzzzzzzzzzz" }] })).status, 400);
  assert.equal((await readCalls()).length, 2, "Missing attachments never start a model turn");

  // A different process receives actual local image files through Codex's
  // native --image arguments, and document paths in the current turn.
  const codex = { ...agent, id: "attachment-codex", harness: { id: "codex", executablePath: join(bridge.directory, "codex-fixture") } };
  assert.equal((await bridge.api("/api/agents/provision", "POST", { ...payload, agentId: codex.id, agent: codex })).success, true);
  const codexReply = await bridge.api("/api/chat", "POST", { ...payload, agentId: codex.id, agent: codex, prompt: "Review with Codex.", attachments: records }, 20000);
  assert.equal(codexReply.success, true, JSON.stringify(codexReply));
  const codexCall = JSON.parse((await readFile(join(bridge.directory, "codex-calls.jsonl"), "utf8")).trim());
  assert.equal(codexCall.images.length, 3);
  assert.equal(codexCall.images[0].data, png.toString("base64"));
  for (const file of records) assert(codexCall.prompt.includes(file.path), `Codex receives ${file.name}`);

  await bridge.api(`/api/queues/${agent.id}/pause`, "POST", {});
  const queued = await bridge.api(`/api/queues/${agent.id}/items`, "POST", { ...payload, text: "Queued file review", attachments: records });
  assert.equal(queued.success, true, JSON.stringify(queued));
  await bridge.restart();
  const restored = (await bridge.api("/api/queues")).data.queues[agent.id].items.find(item => item.id === queued.data.id);
  assert.equal(restored.attachments.length, records.length, "Saved queue retains every file reference over restart");
  await bridge.api(`/api/queues/${agent.id}/resume`, "POST", {});
  await until(async () => (await bridge.api("/api/queues")).data.queues[agent.id].items.find(item => item.id === queued.data.id)?.status === "done", "queued attachments delivered", 20000);
  assert.equal((await readCalls()).at(-1).images.length, 3, "Queue dispatcher forwards native images");

  const root = (await bridge.api(`/api/members/${agent.id}/threads`, "POST", { root: { id: "parent-with-file", role: "user", body: "Review the file", attachments: [records[3]] } })).data;
  assert.equal(root.root.attachments[0].id, records[3].id);
  const thread = await bridge.api(`/api/members/${agent.id}/threads/${root.id}/messages`, "POST", { text: "Compare the screenshot", attachments: [records[0]], workspace: process.cwd(), requestId: "attachment-thread" });
  assert.equal(thread.status, 202, JSON.stringify(thread));
  await until(async () => (await bridge.api(`/api/members/${agent.id}/threads/${root.id}`)).data.messages.some(message => message.role === "agent" && message.status === "complete"), "thread attachment reply", 20000);
  const threadCall = (await readCalls()).at(-1);
  assert.equal(threadCall.images.length, 1); assert(threadCall.context.files.includes(records[3].path), "A reply thread retains its root attachment context");
  const savedThread = (await bridge.api(`/api/members/${agent.id}/threads/${root.id}`)).data;
  assert.equal(savedThread.messages[0].attachments[0].id, records[0].id);
  remoteBridge=await startBridge({development:false,prepare:async()=>({AUTOHAND_AGENT_SDK_ENTRY:join(bridge.directory,'attachment-sdk.mjs'),AUTOHAND_AGENT_SDK_DIR:bridge.directory})});
  const remoteAgent={...agent,id:'remote-attachment-fixture'};
  const remoteLaunch={...payload,agentId:remoteAgent.id,agent:remoteAgent};
  assert.equal((await remoteBridge.api('/api/agents/provision','POST',remoteLaunch)).success,true);
  const token=(await remoteBridge.api('/api/remote/tokens','POST',{label:'attachment test only'})).data.token;
  assert.equal((await bridge.api(`/api/remote/members/${remoteAgent.id}`,'PUT',{url:remoteBridge.origin,token,label:'attachment test only',workspace:process.cwd()})).success,true);
  const forwarded=await bridge.api('/api/chat','POST',{...remoteLaunch,prompt:'Review these files on the remote bridge.',attachments:records},30000);
  assert.equal(forwarded.success,true,forwarded.error);
  const remoteCall=(await readCalls()).at(-1);
  assert.equal(remoteCall.images.length,3);assert.equal(remoteCall.context.files.length,7);
  assert.equal(remoteCall.images[0].data,png.toString('base64'));
  assert(remoteCall.context.files.every(path=>path.startsWith(remoteBridge.directory)), 'Remote members receive destination-owned files, not source-machine paths');
  console.log(`PASS ${fixtures.length} file types retain original bytes and MIME; Autohand native images/files and Codex image arguments; forged/missing refs; queued files after restart; reply-thread files; authenticated two-bridge forwarding.`);
} finally { await remoteBridge?.close(); await bridge.close(); }
