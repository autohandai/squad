import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startBridge, startBrowser, until } from "./lib/reliability-browser.mjs";
import { attachmentFixtures } from "./lib/attachment-fixtures.mjs";

const artifact = ".codex-artifacts/chat-attachments-20261029";
await mkdir(artifact, { recursive: true });
const bridge = await startBridge({ prepare: async directory => {
  const entry = join(directory, "browser-attachment-sdk.mjs");
  await writeFile(entry, `import {appendFileSync,existsSync} from 'node:fs';
    export class AutohandSDK {
      constructor(){} async start(){} async close(){} async interrupt(){}
      async *streamPrompt(params){
        appendFileSync(${JSON.stringify(join(directory, "calls.jsonl"))}, JSON.stringify(params)+'\\n');
        while(params.message.includes('HOLD_FOR_ATTACHMENT_QUEUE')&&existsSync(${JSON.stringify(join(directory, "hold"))}))await new Promise(resolve=>setTimeout(resolve,30));
        yield {type:'message_end',content:'Attachment fixture reply.'};
      }
    }`);
  return { AUTOHAND_AGENT_SDK_ENTRY: entry, AUTOHAND_AGENT_SDK_DIR: directory };
} });
let browser;
try {
  const member = { id: "attachment-fixture", name: "Iris", role: "Assistant", workspace: process.cwd(), projects: [{ path: process.cwd() }], permissions: { permissionMode: "unrestricted" }, harness: { id: "autohand" } };
  assert.equal((await bridge.api("/api/agents/provision", "POST", { agentId: member.id, agent: member, workspace: process.cwd() })).success, true);
  browser = await startBrowser();
  await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: `
    localStorage.setItem('autohandSquad.v1.agents', ${JSON.stringify(JSON.stringify([member]))});
    localStorage.setItem('autohandSquad.v1.onboarding', '{"version":1,"status":"skipped"}');
    window.attachmentUploads = 0;
    window.attachmentPayloads = [];
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, options) => {
      const path = new URL(typeof input === 'string' ? input : input.url, location.origin).pathname;
      if (path === '/api/chat/warm') return Promise.resolve(new Response('{"success":true,"data":{}}', {headers:{'content-type':'application/json'}}));
      if (path === '/api/attachments' && options?.method === 'POST') window.attachmentUploads++;
      if (path === '/api/chat/stream') window.attachmentPayloads.push(JSON.parse(options.body));
      if (path === '/api/attachments' && window.failAttachmentOnce && decodeURIComponent(options.headers['x-file-name']) === 'retry.pdf') {
        window.failAttachmentOnce = false;
        return Promise.resolve(new Response('{"success":false,"error":"Synthetic upload failure"}',{status:500,headers:{'content-type':'application/json'}}));
      }
      return originalFetch(input, options);
    };
  ` });
  await browser.navigate(`${bridge.origin}/conversations/new?member=${member.id}`);
  try {
    await until(() => browser.evaluate("Boolean(document.querySelector('textarea[placeholder=\"Talk to Iris...\"]'))"), "direct-message composer");
  } catch (error) {
    await browser.screenshot(`${artifact}/composer-failure.png`);
    throw error;
  }
  await browser.evaluate(`(() => {
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV2sAAAAASUVORK5CYII='), c => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([png], 'screenshot.png', {type:'image/png'}));
    const input = document.querySelector('textarea[placeholder="Talk to Iris..."]');
    input.dispatchEvent(new DragEvent('dragenter', {bubbles:true,cancelable:true,dataTransfer:transfer}));
    input.dispatchEvent(new DragEvent('dragover', {bubbles:true,cancelable:true,dataTransfer:transfer}));
    input.dispatchEvent(new DragEvent('drop', {bubbles:true,cancelable:true,dataTransfer:transfer}));
  })()`);
  try {
    await until(() => browser.evaluate("Boolean(document.querySelector('form [data-attachment-status=ready] img'))"), "Dropped image must upload and produce a preview in the direct-message composer", 10000);
  } catch (error) {
    await browser.screenshot(`${artifact}/drop-failure.png`);
    console.log(`Observed upload requests after image drop: ${await browser.evaluate("window.attachmentUploads")}`);
    throw error;
  }
  assert.equal(await browser.evaluate("window.attachmentUploads"), 1);
  await until(() => browser.evaluate("document.querySelector('form [data-attachment-id] img')?.naturalWidth > 0"), "image thumbnail decodes");
  await browser.click("Remove screenshot.png");
  const fixtures = await attachmentFixtures();
  const drop = async (files, selector = 'textarea[placeholder="Talk to Iris..."]') => browser.evaluate(`(() => {
    const transfer = new DataTransfer();
    for (const file of ${JSON.stringify(files.map(file => ({ name: file.name, type: file.mime || "", data: file.bytes.toString("base64") })))}) transfer.items.add(new File([Uint8Array.from(atob(file.data), c=>c.charCodeAt(0))], file.name, {type:file.type}));
    document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));
  })()`);
  await drop(fixtures.map(file => ({ ...file, mime: "" })));
  await until(() => browser.evaluate(`document.querySelectorAll('form [data-attachment-status=ready]').length === ${fixtures.length}`), "all requested file types upload", 20000);
  await until(() => browser.evaluate("[...document.querySelectorAll('form [data-attachment-id] img')].every(image=>image.naturalWidth>0)"), "raster and SVG thumbnails decode");
  await browser.screenshot(`${artifact}/pending-files.png`);
  assert.equal(await browser.evaluate("document.querySelector('button[aria-label=\"Send chat message\"]').disabled"), false, "Files can be sent without accompanying text");
  for (const fixture of fixtures) assert(await browser.evaluate(`document.querySelector('form').textContent.includes(${JSON.stringify(fixture.name)})`), `${fixture.name} has a pending file preview`);
  await browser.click("Send chat message");
  await until(() => browser.evaluate(`document.querySelectorAll('[data-message-id] [data-attachment-id]').length === ${fixtures.length} && document.body.innerText.includes('Attachment fixture reply.')`), "sent file previews and model reply", 20000);
  const payload = await browser.evaluate("window.attachmentPayloads[0]");
  assert.equal(payload.attachments.length, fixtures.length, "The actual request carries all file references");
  assert(!JSON.stringify(payload).includes("data:image"));
  const calls = async () => (await readFile(join(bridge.directory, "calls.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal((await calls())[0].images.length, 3, "Browser-uploaded PNG, JPEG and rasterized SVG reach native model input");
  assert.equal((await calls())[0].context.files.length, 7);
  await browser.screenshot(`${artifact}/sent-files.png`);
  await browser.evaluate("window.preAttachmentReload = true");
  await browser.send("Page.reload");
  await until(() => browser.evaluate(`!window.preAttachmentReload && Boolean(document.querySelector('textarea[placeholder="Talk to Iris..."]')) && document.querySelectorAll('[data-message-id] [data-attachment-id]').length === ${fixtures.length}`), "file previews survive reloading saved history");
  assert.equal(await browser.evaluate("JSON.stringify(JSON.parse(localStorage.getItem('autohandSquad.v1.messages'))).includes('data:image')"), false, "History stores references, not base64 blobs");

  await browser.fill('textarea[placeholder="Talk to Iris..."]', "Keep this draft.");
  await browser.evaluate("window.failAttachmentOnce=true");
  await drop([{ ...fixtures[3], name: "retry.pdf" }]);
  await until(() => browser.evaluate("document.querySelector('form [data-attachment-status=error]')?.textContent.includes('Synthetic upload failure')"), "upload failure remains actionable");
  assert.equal(await browser.evaluate("document.querySelector('button[aria-label=\"Send chat message\"]').disabled"), true, "A failed file cannot silently disappear from a send");
  assert.equal(await browser.evaluate("document.querySelector('textarea').value"), "Keep this draft.");
  await browser.click("Retry retry.pdf");
  await until(() => browser.evaluate("Boolean(document.querySelector('form [data-attachment-status=ready]'))"), "retry uploads original file");
  await browser.click("Remove retry.pdf");
  const textPaste = await browser.evaluate(`(() => { const data=new DataTransfer();data.setData('text/plain','normal text');const event=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data});document.querySelector('textarea').dispatchEvent(event);return event.defaultPrevented; })()`);
  assert.equal(textPaste, false, "Normal text paste retains the browser's default behavior");
  await browser.evaluate(`(() => { const data=new DataTransfer();data.items.add(new File([new Uint8Array(26*1024*1024)],'too-large.pdf',{type:'application/pdf'}));document.querySelector('textarea').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data})); })()`);
  await until(() => browser.evaluate("document.querySelector('form [data-attachment-status=error]')?.textContent.includes('25 MB')"), "oversized file explanation");
  assert.equal(await browser.evaluate("document.querySelector('textarea').value"), "Keep this draft.");
  await browser.click("Remove too-large.pdf");
  await drop([{name:"broken.png",mime:"image/png",bytes:Buffer.from("not an image")}]);
  await until(() => browser.evaluate("document.querySelector('form [data-attachment-status=error]')?.textContent.includes('could not be decoded')"), "corrupt image is explained before sending");
  assert.equal(await browser.evaluate("document.querySelector('button[aria-label=\"Send chat message\"]').disabled"),true);
  await browser.click("Remove broken.png");
  await browser.fill('textarea[placeholder="Talk to Iris..."]', "");

  // Pasting into a portaled reply sheet must not also attach to the main DM.
  await browser.evaluate("document.querySelector('[data-message-id$=\"-u\"] button[aria-label=\"Reply in thread\"]').click()");
  await until(() => browser.evaluate("Boolean(document.querySelector('textarea[aria-label=\"Thread reply\"]'))"), "reply thread composer");
  await browser.evaluate(`(() => { const data=new DataTransfer();data.items.add(new File([Uint8Array.from(atob(${JSON.stringify(fixtures[0].bytes.toString("base64"))}),c=>c.charCodeAt(0))],'pasted.png',{type:'image/png'}));document.querySelector('textarea[aria-label="Thread reply"]').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data})); })()`);
  await until(() => browser.evaluate("Boolean(document.querySelector('textarea[aria-label=\"Thread reply\"]').closest('form').querySelector('[data-attachment-status=ready]'))"), "thread image paste upload");
  assert.equal(await browser.evaluate("document.querySelectorAll('[data-file-drop-target=member] form [data-attachment-id]').length"), 0, "Reply-sheet paste does not leak into the main composer");
  await browser.evaluate("document.querySelector('textarea[aria-label=\"Thread reply\"]').closest('form').requestSubmit()");
  await until(() => browser.evaluate("document.querySelector('[data-testid=member-reply-thread]').textContent.includes('Attachment fixture reply.')"), "independent image reply", 20000);
  assert.equal(await browser.evaluate("document.querySelectorAll('[data-thread-message-id] [data-attachment-id]').length"), 1, "Thread history renders its uploaded image");
  await browser.screenshot(`${artifact}/thread-files.png`);
  await browser.evaluate("document.querySelector('[data-slot=sheet-content] button[aria-label=Close]')?.click() || [...document.querySelectorAll('[data-slot=sheet-content] button')].find(button=>button.textContent.trim()==='Close')?.click()");
  await until(() => browser.evaluate("!document.querySelector('textarea[aria-label=\"Thread reply\"]')"), "thread closed");

  await writeFile(join(bridge.directory, "hold"), "hold");
  await browser.fill('textarea[placeholder="Talk to Iris..."]', "HOLD_FOR_ATTACHMENT_QUEUE");
  await until(() => browser.evaluate("document.querySelector('button[aria-label=\"Send chat message\"]')?.disabled === false"), "first turn can send");
  await browser.click("Send chat message");
  await until(async () => (await calls()).some(call => call.message.includes("HOLD_FOR_ATTACHMENT_QUEUE")), "first turn is working");
  await drop([{ ...fixtures[3], name: "queued.pdf" }]);
  await until(() => browser.evaluate("Boolean(document.querySelector('form [data-attachment-status=ready]'))"), "queued file upload");
  await browser.evaluate("document.querySelector('textarea[placeholder=\"Talk to Iris...\"]').closest('form').requestSubmit()");
  await until(() => browser.evaluate("Boolean(document.querySelector('[data-queued-followups] [data-attachment-id]'))"), "queued follow-up keeps its preview");
  await rm(join(bridge.directory, "hold"));
  await until(async () => (await bridge.api("/api/queues")).data.queues[member.id].items.some(item => item.text.includes("queued.pdf") && item.status === "done"), "queued file turn completes", 25000);
  await until(() => browser.evaluate("[...document.querySelectorAll('[data-message-id] [data-attachment-id]')].some(file=>file.textContent.includes('queued.pdf')) && !document.querySelector('button[aria-label=\"Stop response\"]')"), "queued file becomes an answered message", 25000);
  assert((await calls()).at(-1).context.files.some(path => path.endsWith(".pdf")), "Queued file reaches native harness context");
  await browser.click("New chat");
  await until(async () => (await bridge.api(`/api/members/${member.id}/chats`)).data.chats.length === 1, "conversation archived with file references");
  const archived = (await bridge.api(`/api/members/${member.id}/chats`)).data.chats[0];
  const saved = (await bridge.api(`/api/members/${member.id}/chats/${archived.id}`)).data;
  assert(saved.messages.flatMap(message=>message.attachments || []).length >= fixtures.length + 1);
  await browser.click("Previous chats");
  await until(() => browser.evaluate(`Boolean([...document.querySelectorAll('button')].find(button=>button.textContent.trim().startsWith(${JSON.stringify(archived.title)})))`), "archived file conversation is available");
  await browser.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent.trim().startsWith(${JSON.stringify(archived.title)})).click()`);
  await until(() => browser.evaluate(`document.querySelectorAll('[data-message-id] [data-attachment-id]').length >= ${fixtures.length + 1}`), "reopened chat retains file previews");

  await browser.navigate(`${bridge.origin}/quick-chat?member=${member.id}`);
  await until(() => browser.evaluate("Boolean(document.querySelector('[data-testid=quick-chat-composer] textarea'))"), "Quick Chat composer");
  await drop([{...fixtures[0],name:"quick.png"}]);
  await until(() => browser.evaluate("Boolean(document.querySelector('[data-testid=quick-chat-composer] [data-attachment-status=ready] img'))"), "Quick Chat thumbnail");
  const quickCalls=(await calls()).length;
  await browser.click("Send chat message");
  await until(async()=>(await calls()).length>quickCalls,"Quick Chat file reaches the harness");
  assert.equal((await calls()).at(-1).images.length,1);
  await until(()=>browser.evaluate("[...document.querySelectorAll('[data-message-id] [data-attachment-id]')].some(file=>file.textContent.includes('quick.png'))"),"Quick Chat history preview");

  const channel={id:"attachment-channel",name:"attachment-channel",memberIds:[member.id],projects:[{path:process.cwd()}],responder:{mode:"everyone"}};
  assert.equal((await bridge.api("/api/channels","POST",channel)).success,true);
  await browser.navigate(`${bridge.origin}/channels/${channel.id}`);
  const channelInput='[data-file-drop-target=channel] textarea';
  await until(()=>browser.evaluate(`Boolean(document.querySelector(${JSON.stringify(channelInput)}))`),"channel composer");
  const channelCalls=(await calls()).length;
  await drop([{...fixtures[0],name:"channel.png"}],channelInput);
  await until(()=>browser.evaluate("Boolean(document.querySelector('[data-file-drop-target=channel] [data-attachment-status=ready] img'))"),"channel thumbnail");
  await browser.click("Send");
  await until(async()=>(await calls()).length>channelCalls,"attachment-only channel message reaches harness",20000);
  assert.equal((await calls()).at(-1).images.length,1);
  await until(()=>browser.evaluate("Boolean(document.querySelector('[aria-label^=\"Thread: 1 reply\"]'))"),"channel reply completed");
  await browser.evaluate("document.querySelector('[aria-label=\"Reply in thread\"]').click()");
  await browser.fill(channelInput,"Compare that same image again.");
  await browser.click("Send");
  await until(async()=>(await calls()).length>channelCalls+1,"channel follow-up reaches harness",20000);
  assert.equal((await calls()).at(-1).images.length,1,"A channel follow-up retains the root image without another upload");
  await until(async()=>(await bridge.api('/api/channels')).data.messages.some(message=>message.channelId===channel.id&&message.attachments?.length===1),"Channel history persists the original file reference");
  await browser.screenshot(`${artifact}/channel-files.png`);
  assert.deepEqual(browser.errors, []);
  console.log(`PASS ${fixtures.length} file types: drop, thumbnails, attachment-only request, native input, saved/reopened history, upload failure/retry, size and corrupt-image errors, plain text paste, reply-thread paste, queued sends, Quick Chat and channel follow-up delivery.`);
} finally {
  await browser?.close();
  await bridge.close();
}
