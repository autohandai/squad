import { constants } from 'node:fs';
import { open, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ownedDirectory } from './datasets.mjs';
import { windowsJobDrained } from './native-helper.mjs';

async function record(path) {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > 4096) throw Error('Invalid native service record.');
    return JSON.parse(await file.readFile('utf8'));
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  finally { await file?.close(); }
}

export function createNativeDrain({ serviceRoot, brokerId, token, fetchImpl = fetch }) {
  async function assertNoNativeWriters() {
    let directory;
    try { directory=await ownedDirectory(serviceRoot,['native-work-intents'],{create:false}); }
    catch (error) { if(error.code==='ENOENT') return; throw error; }
    const unfinished=()=>Error('Native work from a previous Squad process has not finished. Existing data was preserved. Close that work or restart this computer before retrying.');
    for (const name of await readdir(directory)) {
      if(/\.(?:pending|drained|drain-pending)$/.test(name))continue;
      const intent=await record(join(directory,name));
      if (!intent || intent.version!==1 || !Number.isInteger(intent.daemonPid) || intent.daemonPid<1 || typeof intent.daemonInstance!=='string' || intent.daemonInstance.length>200 || (intent.group!==null && (!Number.isInteger(intent.group)||intent.group<2))) throw unfinished();
      try { process.kill(intent.daemonPid,0); throw unfinished(); } catch(error) {if(error.code!=='ESRCH') throw error;}
      // With no group recorded the daemon never sent the launch handshake.
      if(process.platform==='win32' && intent.jobName) {
        if(!await windowsJobDrained(intent.jobName,{receiptPath:join(directory,name.replace(/\.json$/,'.drained')),bootUptimeMs:intent.bootUptimeMs}))throw unfinished();
      } else if(intent.group!==null) {
        if(process.platform==='win32')throw unfinished();
        try {process.kill(process.platform==='win32'?intent.group:-intent.group,0);throw unfinished();} catch(error) {if(error.code!=='ESRCH') throw error;}
      }
    }
  }
  async function capture() {
    const daemon = await record(join(serviceRoot, 'daemon.json'));
    if (!daemon) { await assertNoNativeWriters(); return null; }
    if (!['127.0.0.1', 'localhost', '::1'].includes(daemon.host) || !Number.isInteger(daemon.port) || daemon.port < 1 || daemon.port > 65535 || !Number.isInteger(daemon.pid)) throw Error('The native service address is invalid.');
    try { process.kill(daemon.pid, 0); } catch (error) { if (error.code === 'ESRCH') {await assertNoNativeWriters();return null;} throw error; }
    const origin = `http://${daemon.host.includes(':') ? `[${daemon.host}]` : daemon.host}:${daemon.port}`;
    const expected = `${daemon.pid}:${daemon.startedAt}`;
    const response = await fetchImpl(`${origin}/ownership/status`, { headers: { 'x-squad-ownership-control': token }, signal: AbortSignal.timeout(3000) });
    const value = await response.json();
    if (!response.ok || value.brokerId !== brokerId || value.instanceId !== expected) throw Error('The native service cannot establish an ownership drain. Restart Squad; existing data was preserved.');
    return { origin, instanceId: expected };
  }
  async function request(captured, operationId, action) {
    if (!captured) { if(action==='drain') await assertNoNativeWriters(); return; }
    const response = await fetchImpl(`${captured.origin}/ownership/${action}`, { method: 'POST', headers: { 'x-squad-ownership-control': token, 'content-type': 'application/json' },
      body: JSON.stringify({ brokerId, instanceId: captured.instanceId, operationId }), signal: AbortSignal.timeout(35_000) });
    const value = await response.json();
    if (!response.ok || value.success !== true || value.brokerId !== brokerId || value.instanceId !== captured.instanceId || value.operationId !== operationId || (action === 'drain' && value.drained !== true)) throw Error(value.error || 'Native work did not finish draining. Existing data was preserved.');
    const current = await record(join(serviceRoot, 'daemon.json'));
    if (!current || `${current.pid}:${current.startedAt}` !== captured.instanceId) throw Error('The native service restarted during the ownership operation. Existing data was preserved.');
  }
  return { capture, drain: (captured, operationId) => request(captured, operationId, 'drain'), resume: (captured, operationId) => request(captured, operationId, 'resume') };
}
