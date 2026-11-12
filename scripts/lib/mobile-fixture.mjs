import { mkdir, chmod, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startBridge } from './reliability-browser.mjs';
import { createServer } from 'node:http';

/** Real owner-bound bridge/queue, isolated home and an offline fixture engine. */
export async function startMobileFixture({ announcements = [], relayApiUrl } = {}) {
  let member, counter;
  const announcementCalls = [];
  const upstream = createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk;
    announcementCalls.push({ url: request.url, body });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(request.method === 'GET' ? { success: true, announcements } : { success: true }));
  });
  await new Promise((resolve, reject) => { upstream.once('error', reject); upstream.listen(0, '127.0.0.1', resolve); });
  let bridge;
  try {
  bridge = await startBridge({ cwd: fileURLToPath(new URL('../../', import.meta.url)), development: false, prepare: async directory => {
    await mkdir(join(directory, 'home'), { recursive: true });
    // macOS exposes its temporary directory through /var -> /private/var.
    // The fake home and repository analysis must share one physical spelling.
    const home = await realpath(join(directory, 'home')), workspace = join(home, 'project');
    await mkdir(workspace, { recursive: true });
    const preload = join(directory, 'home.mjs');
    await writeFile(preload, `import os from 'node:os';import{syncBuiltinESMExports}from'node:module';os.homedir=()=>${JSON.stringify(home)};syncBuiltinESMExports();`);
    const engine = join(directory, 'fixture-codex'); counter = join(directory, 'turns.txt');
    await writeFile(engine, `#!${process.execPath}
const args=process.argv.slice(2);if(args[0]==='--version'){console.log('codex 1.0.0');process.exit(0)}if(args[0]==='login'){console.log('Logged in using fixture');process.exit(0)}
require('node:fs').appendFileSync(${JSON.stringify(counter)},'turn\\n');
console.log(JSON.stringify({type:'thread.started',thread_id:'mobile-fixture-thread'}));
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Message received on this computer.'}}));
console.log(JSON.stringify({type:'turn.completed'}));
`);
    await chmod(engine, 0o755);
    member = { id: 'fixture-eva', name: 'Eva', role: 'QA Engineer', status: 'online', workspace, projects: [{ path: workspace }],
      harness: { id: 'codex', executablePath: engine }, permissions: { permissionMode: 'restricted' }, memory: [] };
    return { NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`, OPENAI_API_KEY: 'fixture-no-provider', AUTOHAND_API_URL: `http://127.0.0.1:${upstream.address().port}`, ...(relayApiUrl ? { AUTOHAND_SQUAD_API_URL: relayApiUrl } : {}) };
  } });
    const closeBridge = bridge.close;
    bridge.close = async () => { try { await closeBridge(); } finally { await new Promise(resolve => upstream.close(resolve)); } };
    const saved = await bridge.api(`/api/members/${member.id}/channel-access`, 'PUT', { agent: member, profile: '', profilePatch: {} });
    if (!saved.success) throw Error(saved.error);
    const setup = await bridge.api('/api/mobile/config', 'PUT', { enabled: false, mode: 'local', endpoint: '', port: 0 });
    if (!setup.success) throw Error(setup.error);
    return { bridge, member, counter, announcementCalls };
  } catch (error) { if (bridge) await bridge.close(); else await new Promise(resolve => upstream.close(resolve)); throw error; }
}
