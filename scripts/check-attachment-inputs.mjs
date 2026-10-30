import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { attachmentFixtures, fixturePng } from "./lib/attachment-fixtures.mjs";
import { acpPromptInput, attachmentPrompt, claudePromptInput, resolveAttachments } from "../server/attachments.mjs";
import { runClaudeSdk } from "../server/harness/claude-sdk.mjs";
import { runExternalHarness } from "../server/harness/registry.mjs";
import * as claude from "../server/harness/claude.mjs";
import * as acp from "../server/harness/acp.mjs";
import { MAX_CHAT_BYTES, boundMessages } from "../server/chats/store.mjs";
import { proxyBinary } from "../server/remote/proxy.mjs";

const root = await mkdtemp(join(tmpdir(), "squad-attachment-inputs-"));
let remote;
try {
  const workspace = join(root, "workspace"), state = join(root, "state"), directory = join(state, "attachments");
  await mkdir(workspace); await mkdir(directory, { recursive: true });
  const fixtures = await attachmentFixtures();
  const refs = [];
  for (const [index, fixture] of fixtures.entries()) {
    const id = `attachment${String(index).padStart(4, "0")}`, ext = extname(fixture.name).slice(1);
    await writeFile(join(directory, `${id}.${ext}`), fixture.bytes);
    await writeFile(join(directory, `${id}.json`), JSON.stringify({ id, name: fixture.name, ext, mime: fixture.mime, size: fixture.bytes.length, kind: fixture.mime.startsWith("image/") ? "image" : "file", ...(ext === "svg" ? { preview: { mime: "image/png", size: fixturePng.length } } : {}) }));
    if (ext === "svg") await writeFile(join(directory, `${id}.preview.png`), fixturePng);
    refs.push({ id, name: fixture.name });
  }
  const files = await resolveAttachments(state, refs);
  const text = attachmentPrompt("Inspect the attachments.", files);
  const options = claude.buildArgs({ prompt: text, workspace, access: "plan" });
  let captured;
  const output = await runClaudeSdk({ adapter: claude, executable: "/fixture/claude", args: options.args, cwd: workspace, attachments: files, queryFactory: ({ prompt }) => ({
    supportedModels: async () => [], close() {},
    async *[Symbol.asyncIterator]() {
      for await (const message of prompt) { captured = message; yield message; }
      yield { type: "system", subtype: "init", session_id: "fixture-session", model: "fixture-model" };
      yield { type: "assistant", message: { id: "a", content: [{ type: "text", text: "Received file inputs." }] } };
      yield { type: "result", subtype: "success", result: "Received file inputs.", session_id: "fixture-session" };
    },
  }) });
  assert.equal(output.error, "");
  assert.equal(captured.message.content.filter(block => block.type === "image").length, 3);
  const document = captured.message.content.find(block => block.type === "document");
  assert.equal(document.source.data, fixtures.find(file => file.name === "spec.pdf").bytes.toString("base64"));
  for (const file of files) assert(captured.message.content[0].text.includes(file.path));
  assert(!output.rawStdout.includes(fixturePng.toString("base64")), "Echoed SDK inputs do not put attachment bytes in chat traces");

  const legacy = join(root, "claude-legacy-fixture");
  const legacyFile = join(root, "legacy-input.json");
  await writeFile(legacy, `#!${process.execPath}\nconst fs=require('node:fs');let data='';process.stdin.on('data',bytes=>data+=bytes);process.stdin.on('end',()=>{const input=JSON.parse(data.trim());fs.writeFileSync(${JSON.stringify(legacyFile)},JSON.stringify({args:process.argv.slice(2),input}));console.log(JSON.stringify(input));console.log(JSON.stringify({type:'system',subtype:'init',session_id:'legacy-session'}));console.log(JSON.stringify({type:'assistant',message:{id:'a',content:[{type:'text',text:'Legacy received files.'}]}}));console.log(JSON.stringify({type:'result',subtype:'success',result:'Legacy received files.'}));});`);
  await chmod(legacy, 0o700);
  const compatible = await runExternalHarness({ adapter: claude, executable: legacy, args: options.args, cwd: workspace, attachments: files, harnessVersion: "2.1.295", timeoutMs: 10000 });
  assert.equal(compatible.error, "");
  const legacyInput = JSON.parse(await readFile(legacyFile, "utf8"));
  assert(legacyInput.args.includes("--input-format")); assert(legacyInput.args.includes("stream-json"));
  assert.equal(legacyInput.input.message.content.filter(block => block.type === "image").length, 3);
  assert(!legacyInput.args.join(" ").includes(fixturePng.toString("base64")), "Binary inputs travel on stdin, not in command arguments");
  assert(!compatible.rawStdout.includes(fixturePng.toString("base64")), "Legacy echoed inputs are redacted from trace output");

  const embedded = await acpPromptInput(text, files, { image: true, embeddedContext: true });
  assert.equal(embedded.filter(block => block.type === "image").length, 3);
  assert.equal(embedded.filter(block => block.type === "resource").length, 7);
  assert.equal(embedded.find(block => block.resource?.mimeType === "application/pdf").resource.blob, document.source.data);
  const links = await acpPromptInput(text, files, {});
  assert.equal(links.filter(block => block.type === "resource_link").length, files.length, "ACP's required resource links retain every file without optional embedding");

  // Exercise the real ACP stdio handshake and request body, plus narrow
  // read-only access to explicitly attached files outside the workspace.
  const acpFile = join(root, "acp-input.json"), acpExecutable = join(root, "acp-fixture");
  const unattached = join(directory, "not-attached.txt"); await writeFile(unattached, "not shared");
  const csv = files.find(file => file.name === "table.csv");
  await writeFile(acpExecutable, `#!${process.execPath}\nconst fs=require('node:fs'),rl=require('node:readline').createInterface({input:process.stdin});let next=100;const pending=new Map();const send=x=>console.log(JSON.stringify(x));const ask=(method,params)=>new Promise(resolve=>{const id=next++;pending.set(id,resolve);send({jsonrpc:'2.0',id,method,params});});rl.on('line',async line=>{const m=JSON.parse(line);if(!m.method){pending.get(m.id)?.(m);return;}const reply=result=>send({jsonrpc:'2.0',id:m.id,result});if(m.method==='initialize')return reply({protocolVersion:1,agentCapabilities:{promptCapabilities:{image:true,embeddedContext:true}},authMethods:[]});if(m.method==='session/new')return reply({sessionId:'files-session'});if(m.method==='session/prompt'){const read=await ask('fs/read_text_file',{sessionId:'files-session',path:${JSON.stringify(csv.path)}});const other=await ask('fs/read_text_file',{sessionId:'files-session',path:${JSON.stringify(unattached)}});const write=await ask('fs/write_text_file',{sessionId:'files-session',path:${JSON.stringify(csv.path)},content:'changed'});fs.writeFileSync(${JSON.stringify(acpFile)},JSON.stringify({prompt:m.params.prompt,read,other,write}));send({jsonrpc:'2.0',method:'session/update',params:{sessionId:'files-session',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'ACP received attachments.'}}}});return reply({stopReason:'end_turn'});}reply({});});`);
  await chmod(acpExecutable, 0o700);
  const built = acp.buildArgs({ prompt: text, workspace, access: "plan", attachments: files });
  const acpResult = await acp.runAcpHarness({ adapter: acp.forHarnessId("pi"), executable: acpExecutable, args: [], cwd: workspace, turn: built.turn, timeoutMs: 10000 });
  assert.equal(acpResult.error, "", JSON.stringify(acpResult));
  const received = JSON.parse(await readFile(acpFile, "utf8"));
  assert.equal(received.prompt.filter(block => block.type === "image").length, 3);
  assert.match(received.read.result.content, /SQUAD_CSV_42/);
  assert(received.other.error, "An upload grants no read access to unrelated files alongside it");
  assert(received.write.error, "An upload does not grant write access in plan mode");
  assert.deepEqual(await readFile(csv.path), fixtures.find(file => file.name === "table.csv").bytes);

  const bounded = boundMessages([{ id: "u", role: "user", body: "Files", attachments: refs }, { id: "a", role: "agent", body: "x".repeat(MAX_CHAT_BYTES + 10) }]);
  assert(bounded.limited); assert.equal(bounded.messages[0].attachments.length, files.length, "Archive compaction retains references");
  assert.equal(await claudePromptInput("plain text", []), "plain text", "Ordinary text-only mode remains unchanged");

  // Authenticated binary forwarding keeps exact bytes and the file's MIME.
  const transferred = [];
  remote = createServer(async (req, res) => {
    const chunks = []; for await (const bytes of req) chunks.push(bytes);
    transferred.push({ headers: req.headers, bytes: Buffer.concat(chunks) });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ success: true, data: { id: "destination1234" } }));
  });
  await new Promise(resolve => remote.listen(0, "127.0.0.1", resolve));
  const target = { url: `http://127.0.0.1:${remote.address().port}`, label: "Fixture remote", token: "fixture-only" };
  for (const fixture of fixtures) await proxyBinary(target, "/api/attachments", fixture.bytes, { "content-type": fixture.mime, "x-file-name": encodeURIComponent(fixture.name) });
  assert.equal(transferred.length, fixtures.length);
  for (const [index, entry] of transferred.entries()) { assert.deepEqual(entry.bytes, fixtures[index].bytes); assert.equal(entry.headers.authorization, "Bearer fixture-only"); assert.equal(entry.headers["content-type"], fixtures[index].mime); }
  console.log(`PASS ${fixtures.length} file types: Claude SDK structured inputs, legacy CLI stdin, ACP negotiated images/resources over stdio, scoped file reads, archive compaction, and authenticated raw-byte forwarding.`);
} finally { await new Promise(resolve => remote ? remote.close(resolve) : resolve()); await rm(root, { recursive: true, force: true }); }
