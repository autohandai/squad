#!/usr/bin/env node
// A hand-driven live session: an isolated bridge with the real account plus a
// headless Chrome, kept alive and steered over a tiny local HTTP control port.
// Used to walk the first-run path step by step and look at what happened
// between steps (ADR-0161). Nothing here is a check; it is a workbench.
//
//   node scripts/lib/live-driver.mjs [--port=18990]
//   curl -s localhost:18990 -d '{"op":"navigate","url":"/"}'
//   ops: navigate{url} evaluate{expression} click{text} fill{selector,value}
//        screenshot{path,width?,height?,mobile?} api{path,method,body} logs{} info{} stop{}
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { startBridge, startBrowser } from './reliability-browser.mjs';

const controlPort = Number(process.argv.find(a => a.startsWith('--port='))?.slice(7) || 18990);
const source = process.env.SQUAD_LIVE_CONFIG || join(process.env.AUTOHAND_HOME || join(homedir(), '.autohand'), 'config.json');
const original = JSON.parse(await readFile(source, 'utf8'));
const bridge = await startBridge({ prepare: async directory => {
  const config = Object.fromEntries(['provider', 'auth', 'autohandai', 'openrouter', 'openai', 'ollama', 'llmgateway', 'bedrock', 'deepseek', 'zai', 'nvidia', 'cerebras'].filter(key => original[key] !== undefined).map(key => [key, original[key]]));
  config.mcp = { servers: [] }; config.hooks = {};
  config.permissions = { allowList: ['write_file:/tmp/*'], denyList: [] };
  await writeFile(join(directory, 'config.json'), JSON.stringify(config), { mode: 0o600 });
  return { AUTOHAND_AGENT_SDK_ENTRY: '', AUTOHAND_AGENT_SDK_DIR: '' };
} });
const browser = await startBrowser();
await browser.send('Network.enable');
await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `
  window.liveTurns = [];
  const original = window.fetch.bind(window);
  window.fetch = async (input, options) => {
    const response = await original(input, options);
    const path = new URL(typeof input === 'string' ? input : input.url, location.origin).pathname;
    if (path === '/api/chat/stream') {
      const record = {request: JSON.parse(options.body), events: 0, sdk: [], frames: []}; window.liveTurns.push(record);
      (async () => {
        const decoder = new TextDecoder(); let pending = '';
        for await (const chunk of response.clone().body) {
          pending += decoder.decode(chunk, {stream: true}).replaceAll('\\r\\n', '\\n'); let end;
          while ((end = pending.indexOf('\\n\\n')) >= 0) {
            const frame = pending.slice(0, end); pending = pending.slice(end + 2);
            const kind = frame.match(/^event: (.+)$/m)?.[1];
            const data = frame.split('\\n').filter(line => line.startsWith('data: ')).map(line => line.slice(6)).join('\\n');
            if (!data) continue; record.events++; record.frames.push(kind);
            if (kind === 'sdk') { const e = JSON.parse(data); record.sdk.push({type: e.type, status: e.status, label: e.label, method: e.method, detail: e.detail, requestId: e.requestId, tool: e.tool?.name || e.toolName || e.tool, args: e.tool?.args, output: e.output ? String(e.output).slice(0, 600) : undefined, success: e.success, decision: e.decision, source: e.source, at: e.timestamp}); }
            if (kind === 'done') record.result = JSON.parse(data);
            if (kind === 'queued') record.queued = JSON.parse(data);
            if (kind === 'error') record.error = JSON.parse(data);
          }
        }
        record.closed = true;
      })().catch(error => { record.captureError = error.message; });
    }
    return response;
  };` });

const desktop = { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false };
async function handle(body) {
  switch (body.op) {
    case 'info': return { origin: bridge.origin, directory: bridge.directory, errors: browser.errors };
    case 'navigate': await browser.navigate(body.url.startsWith('http') ? body.url : bridge.origin + body.url); return { ok: true };
    case 'evaluate': return { value: await browser.evaluate(body.expression) };
    case 'click': await browser.click(body.text); return { ok: true };
    case 'fill': await browser.fill(body.selector, body.value); return { ok: true };
    case 'screenshot': {
      const metrics = body.mobile ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true } : { ...desktop, ...(body.width ? { width: body.width } : {}), ...(body.height ? { height: body.height } : {}) };
      await browser.send('Emulation.setDeviceMetricsOverride', metrics);
      await new Promise(r => setTimeout(r, 300));
      await browser.screenshot(body.path);
      await browser.send('Emulation.setDeviceMetricsOverride', desktop);
      return { ok: true, path: body.path };
    }
    case 'api': return await bridge.api(body.path, body.method || 'GET', body.body);
    case 'logs': return { logs: bridge.logs.slice(-(body.tail || 8000)) };
    case 'stop': setTimeout(async () => { await browser.close(); await bridge.close(); process.exit(0); }, 100); return { ok: true };
    default: throw new Error(`unknown op ${body.op}`);
  }
}
createServer((req, res) => {
  let text = '';
  req.on('data', chunk => { text += chunk; });
  req.on('end', async () => {
    try { const result = await handle(text ? JSON.parse(text) : { op: 'info' }); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(result)); }
    catch (error) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: error.message })); }
  });
}).listen(controlPort, '127.0.0.1', () => console.log(`live-driver ready on http://127.0.0.1:${controlPort} bridge=${bridge.origin} dir=${bridge.directory}`));
