import { createServer, request as httpRequest } from 'node:http';
import { fork } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdir, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { z } from 'zod';
import { ownerSchema } from '@autohand/squad-portable';
import { createIdentityService, actorKey, ownerKey } from './identity.mjs';
import { readPersistentJson, writePersistentJson } from '../persistent-json.mjs';
import { ensureDataset, ownedDirectory, stageDataset, readDataset, publishDataset } from './datasets.mjs';
import { acquireWriterLease } from './writer-lease.mjs';
import { createNativeDrain } from './native-drain.mjs';
import { createWorkerLedger } from './worker-ledger.mjs';
import { createWindowsJob } from './native-helper.mjs';
import { createOperationJournal } from './operation-journal.mjs';
import { createImportSources } from './import-sources.mjs';
import { planRestore, materializeRestore } from './restore.mjs';
import { MAX_DOCUMENT_BYTES } from '@autohand/squad-portable';
import { createOwnedCloudBackups } from './cloud-service.mjs';
import { prepareLegacyRecovery, legacyRecoveryInput } from './legacy-recovery.mjs';
import { REMOTE_TRANSPORT_HEADER,REMOTE_TRANSPORT_VALUE } from '../remote/auth.mjs';
import { createServer as createPortReservation } from 'node:net';

const fail = (message, status = 409, code = 'context_changed') => Object.assign(new Error(message), { status, code });
const isLoopback = value => value === '::1' || /^(?:::ffff:)?127\./.test(value || '');
const readOnlyPosts = new Set(['/api/backups', '/api/backups/export', '/api/memory/query', '/api/search']);
const publicGet = new Set(['/api/app-info', '/api/harnesses/login']);
const contextHeader = 'x-squad-context';

function json(res, status, data) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
  res.end(JSON.stringify(data));
}
async function readBody(req, maxBytes = 128 * 1024) {
  const bytes = Buffer.allocUnsafe(maxBytes); let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > maxBytes) throw fail('Request is too large.', 413, 'body_too_large'); bytes.set(chunk, size - chunk.length); }
  try { return JSON.parse(bytes.subarray(0, size).toString('utf8')); }
  catch { throw fail('Send valid JSON.', 400, 'invalid_json'); }
}
async function readUpload(req) {
  const chunks=[];let size=0;
  for await(const chunk of req) {size+=chunk.length;if(size>MAX_DOCUMENT_BYTES)throw fail('Choose a backup up to 256 MiB.',413,'body_too_large');chunks.push(chunk);}
  return Buffer.concat(chunks,size);
}

export function createOwnershipBroker({ rootDir, serviceRoot, configPath, host = '127.0.0.1', port = 19821, dev = false, hmrPort, identity, workerEntry = join(rootDir, 'server.mjs'), startupTimeoutMs = 45_000, terminationGraceMs = 10_000,ownedCloudBaseUrl,ownedCloudFetch }) {
  if(hmrPort!==undefined)z.number().int().min(1).max(65535).parse(hmrPort);
  serviceRoot = resolve(serviceRoot);
  identity ||= createIdentityService({ serviceRoot, configPath });
  const receiptFile = join(serviceRoot, 'ownership-active.json');
  const selectionFile = join(serviceRoot, 'ownership-selections.json');
  const brokerId = randomUUID(), controlToken = randomBytes(32).toString('hex');
  const startedAt = new Date().toISOString();
  const native = createNativeDrain({ serviceRoot, brokerId, token: controlToken });
  let releaseWriter, workerLedger, nativeHold = null;
  let phase = 'verifying', generation = randomUUID(), verified = null, access = null, dataset = null, error = '', worker = null;
  let pendingOperation=null;
  let observedFingerprint, transition = Promise.resolve(), closing = false, teamCheckedAt = 0, workerStarting, startingChild;
  const connections = new Set(), subscribers = new Set();
  const cloudControllers=new Set(),brokerActivities=new Set();
  const liveChildren = new Set(), childStops = new WeakMap();
  const childOutputClosed = new WeakMap();
  const childIntents = new WeakMap();
  const childLaunches = new WeakMap();
  const childJobs = new WeakMap();
  const publicContext = () => ({ state: phase, generation, actor: verified?.actor || null,
    owner: access?.owner || null, ownerLabel: access?.label || '', role: access?.role || '',
    canWrite: phase === 'ready' && access?.canWrite === true, scopeKey: access ? ownerKey(access.owner) : '',
    datasetId: dataset?.datasetId || '',
    storageKey: verified && access && dataset ? `${actorKey(verified.actor)}.${ownerKey(access.owner)}.${dataset.datasetId}` : '',
    offline: Boolean(verified?.offline), error,canRestartData:phase==='awaiting_restart'&&access?.canWrite===true, pendingOperation:pendingOperation?operationSummary(pendingOperation):null });
  const operationSummary=row=>({id:row.id,kind:row.kind,phase:row.phase,revision:row.revision,beforeDatasetId:row.beforeDatasetId,afterDatasetId:row.afterDatasetId,error:row.error,updatedAt:row.updatedAt,...(row.result?{result:row.result}:{})});

  async function publishReceipt() {
    const context = publicContext();
    await writePersistentJson(receiptFile, { version: 1, ...context, credentialFingerprint: verified?.fingerprint || '', expiresAt: verified ? new Date(Math.min(verified.expiresAt, access?.owner.kind === 'team' ? teamCheckedAt + 30_000 : Infinity)).toISOString() : '',
      dataRoot: dataset?.dataRoot || '', appRoot: dataset?.appRoot || '', workspaceRoot: dataset?.workspaceRoot || '' });
    for (const response of subscribers) { if (!response.destroyed) response.write(`data: ${JSON.stringify(context)}\n\n`); }
  }
  function revoke() {
    generation = randomUUID();
    for(const controller of cloudControllers)controller.abort(fail('The selected Squad changed. Cloud activity was cancelled.'));
    for (const connection of connections) { connection.upstream.destroy(); connection.response.destroy(); }
    connections.clear();
  }
  function terminateChild(child, reason) {
    if (childStops.has(child)) return childStops.get(child);
    const stop = (async () => {
      const killGroup = async () => {
        const job=childJobs.get(child);
        try {if(job)await job.terminate();}
        finally {try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* The captured private group may already be gone. */ }}
      };
      let forced;
      if (child.exitCode === null && child.signalCode === null) {
        const stopped = new Promise(resolveExit => { child.once('exit', resolveExit); child.once('close', resolveExit); });
        try { child.send?.({ type: 'ownership-deactivate', reason }); } catch { /* IPC may have closed. */ }
        // Windows SIGTERM forcibly kills the root and skips graceful writes.
        // Let IPC drain first, then terminate and verify the entire owned job.
        if(process.platform!=='win32')child.kill('SIGTERM');
        const timer = setTimeout(() => {forced=killGroup();forced.catch(()=>{});}, terminationGraceMs); timer.unref();
        try { await stopped; } finally { clearTimeout(timer); }
      }
      // The parent may have exited while a helper ignored graceful cleanup.
      // Its captured detached group remains ours and must be drained too.
      await forced;
      await killGroup();
      if (process.platform !== 'win32' && child.pid) {
        const deadline = Date.now() + 5000;
        while (true) {
          try { process.kill(-child.pid, 0); }
          catch (failure) { if (failure.code === 'ESRCH') break; if(failure.code!=='EPERM')throw failure; }
          if (Date.now() >= deadline) throw fail('The private worker process group did not finish draining. Existing data was preserved.', 503, 'drain_incomplete');
          await new Promise(resolveWait => setTimeout(resolveWait, 20));
        }
      }
      await childOutputClosed.get(child);
      await childLaunches.get(child)?.catch(() => {});
      await childIntents.get(child)?.clear();
      liveChildren.delete(child);
    })();
    childStops.set(child, stop); return stop;
  }
  async function stopWorker(reason) {
    worker = null;
    await Promise.all([...liveChildren].map(child => terminateChild(child, reason)));
  }
  async function quiesce(reason) {
    const nodeStop = stopWorker(reason);
    try {
      if (!nativeHold) nativeHold = { captured: await native.capture(), operationId: randomUUID() };
      await Promise.all([nodeStop, native.drain(nativeHold.captured, nativeHold.operationId),Promise.allSettled([...brokerActivities])]);
    } finally { await nodeStop; }
  }
  async function resumeNative() {
    if (!nativeHold) return;
    await native.resume(nativeHold.captured, nativeHold.operationId);
    nativeHold = null;
  }
  async function block(message, reason = 'The ownership context is unavailable.') {
    phase = verified ? 'blocked' : 'error'; error = message; revoke();
    await publishReceipt();
    await quiesce(reason);
  }
  function schedule(action) {
    const next = transition.then(async () => {
      try { return await action(); }
      catch (failure) {
        if (phase === 'verifying') { phase = verified ? 'blocked' : 'error'; error = failure.message || 'Squad could not finish changing ownership.'; revoke(); await publishReceipt(); }
        throw failure;
      }
    });
    transition = next.catch(() => {}); return next;
  }
  async function journal() {return createOperationJournal({serviceRoot,owner:access.owner,actor:verified.actor});}
  async function recoverOperations() {
    // activate/select hold the machine writer lease and have already drained
    // native/Node writers. Recovery compares the durable publication pointer.
    const pending=await (await journal()).reconcile();
    pendingOperation=pending.find(row=>row.afterDatasetId===dataset.datasetId)||null;
    phase=pendingOperation?'awaiting_restart':'ready';
  }
  function capturedContext() {
    const expected=generation,fingerprint=verified?.fingerprint;
    const context={...dataset,serviceRoot,owner:access.owner,actor:verified.actor,canWrite:access.canWrite,generation:expected};
    const assertCurrent=()=>{
      checkCredential();
      if(expected!==generation||identity.credential()?.fingerprint!==fingerprint||closing)throw fail('The account or selected Squad changed. Existing data was preserved.');
    };
    return {context,assertCurrent};
  }
  async function authorizeCurrent(write=false) {
    if(!verified||!access)throw fail('Sign in and choose a Squad.',401,'sign_in_required');
    const expected=generation,fingerprint=verified.fingerprint;
    const fresh=await identity.authorize(verified,access.owner);checkCredential();
    if(expected!==generation||fingerprint!==identity.credential()?.fingerprint)throw fail('The account changed while access was checked.');
    if(fresh.canWrite!==access.canWrite||fresh.role!==access.role)throw fail('Team permissions changed. Select this Squad again.',409,'permissions_changed');
    if(write&&!fresh.canWrite)throw fail('This Squad is read-only.',403,'owner_read_only');
    return fresh;
  }
  async function cloudActivity(departing,write,action) {
    if(departing!==generation||phase!=='ready')throw fail('The selected Squad changed before this cloud operation.');
    await authorizeCurrent(write);
    if(departing!==generation)throw fail('The selected Squad changed before this cloud operation.');
    const captured=capturedContext(),credential=identity.credential();captured.assertCurrent();
    if(credential?.fingerprint!==verified?.fingerprint||!credential?.token)throw fail('Sign in again before connecting cloud backups.',401,'identity_invalid');
    const controller=new AbortController();cloudControllers.add(controller);
    const pending=(async()=>{
      const service=createOwnedCloudBackups({...captured,identityToken:credential.token,baseUrl:ownedCloudBaseUrl,fetchImpl:ownedCloudFetch,signal:controller.signal});
      const result=await action(service);captured.assertCurrent();await authorizeCurrent(write);captured.assertCurrent();return result;
    })();
    brokerActivities.add(pending);
    try{return await pending;}finally{brokerActivities.delete(pending);cloudControllers.delete(controller);}
  }
  async function dataOperation(input,departing) {
    if(generation!==departing)throw fail('The selected Squad changed.');
    await authorizeCurrent(true);
    const operations=await journal();
    let row=await operations.create(input);
    if(row.phase!=='requested')return row;
    if(phase!=='ready')throw fail('Finish the current data operation before starting another.');
    const source=input.kind==='reset'?null:await createImportSources(capturedContext()).load(input.sourceId);
    if(source&&source.plan.sha256!==input.sourceDigest)throw fail('This import differs from the reviewed backup. Choose it again.');
    await authorizeCurrent(true);
    phase='draining';error='';revoke();const {context,assertCurrent}=capturedContext();
    pendingOperation=row;let drained=false;await publishReceipt();
    try {
      row=await operations.update(row.id,row.revision,{phase:'draining'});pendingOperation=row;
      await quiesce('Squad data is changing. Background work stays paused.');assertCurrent();drained=true;
      await authorizeCurrent(true);assertCurrent();
      const staged=await stageDataset(serviceRoot,ownerKey(context.owner));
      row=await operations.update(row.id,row.revision,{phase:'staging',afterDatasetId:staged.datasetId});pendingOperation=row;
      const restored=source?await materializeRestore(planRestore(source.document,{owner:context.owner,staged}),{serviceRoot,assertCurrent}):{memberCount:0,fileCount:0,routineCount:0,warnings:[]};
      assertCurrent();await authorizeCurrent(true);assertCurrent();
      const result={memberCount:restored.memberCount,fileCount:restored.fileCount,routineCount:restored.routineCount,warningCount:restored.warnings.length,warningSamples:restored.warnings.slice(0,10).map(message=>String(message).slice(0,1000))};
      row=await operations.update(row.id,row.revision,{phase:'publishing',result});pendingOperation=row;
      const published=await publishDataset(serviceRoot,ownerKey(context.owner),staged,input.beforeDatasetId,assertCurrent);
      row=await operations.update(row.id,row.revision,{phase:'awaiting_restart'});assertCurrent();
      dataset=published;pendingOperation=row;
      phase='awaiting_restart';error='';revoke();await publishReceipt();return row;
    } catch(failure) {
      // rename may have committed even if fsync/the response failed. Never
      // label that as a pre-publication failure or replay it on retry.
      const selected=await readDataset(serviceRoot,ownerKey(context.owner));
      if(row.afterDatasetId&&selected?.datasetId===row.afterDatasetId) {
        const recovered=await operations.reconcile();row=recovered.find(item=>item.id===row.id)||row;
        if(context.generation===generation) {dataset=selected;pendingOperation=row;phase='awaiting_restart';error='';revoke();await publishReceipt();}
        return row;
      }
      if(!['failed','complete','awaiting_restart'].includes(row.phase))row=await operations.update(row.id,row.revision,{phase:'failed',error:String(failure.message).slice(0,2000)});
      if(context.generation===generation) {
        pendingOperation=null;
        try {
          if(!drained)throw failure;
          await authorizeCurrent(true);assertCurrent();await resumeNative();assertCurrent();
          phase='ready';error='';revoke();await publishReceipt();
        } catch(recoveryFailure) {
          phase='blocked';error=recoveryFailure.message||'Squad could not confirm that background work stopped. Existing data was preserved.';revoke();await publishReceipt();
        }
      }
      throw failure;
    }
  }
  async function activate(current) {
    phase = 'verifying'; error = ''; verified = null; access = null; dataset = null; pendingOperation=null; revoke();
    await publishReceipt(); await quiesce('The signed-in account changed.');
    if (!current) { phase = 'signed_out'; await publishReceipt(); await resumeNative(); return; }
    try {
      const next = await identity.verify(current);
      if (closing || identity.credential()?.fingerprint !== current.fingerprint) return;
      verified = next;
      const selections = await readPersistentJson(selectionFile, { version: 1, owners: {} });
      const selected = selections.owners[actorKey(next.actor)] || identity.personal(next).owner;
      access = await identity.authorize(next, ownerSchema.parse(selected));
      dataset = await ensureDataset(serviceRoot, ownerKey(access.owner));
      if (identity.credential()?.fingerprint !== current.fingerprint) { verified = null; access = null; return; }
      await recoverOperations();error = ''; teamCheckedAt = Date.now();
      await publishReceipt();
      if(phase==='ready')await resumeNative();
    } catch (failure) {
      await block(failure.message || 'The signed-in owner could not be verified.');
    }
  }
  function checkCredential() {
    let current;
    try { current = identity.credential(); }
    catch (failure) { if (observedFingerprint !== 'invalid') { observedFingerprint = 'invalid'; void schedule(() => block(failure.message)); } return; }
    const fingerprint = current?.fingerprint || '';
    if (fingerprint !== observedFingerprint || (verified && verified.expiresAt <= Date.now())) {
      observedFingerprint = fingerprint;
      // Close admission synchronously; validation and draining happen after it.
      phase = 'verifying'; error = ''; revoke();
      void schedule(() => activate(current));
    }
  }
  const serviceOrigin = () => { const address = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host; return `http://${address.includes(':') ? `[${address}]` : address}:${server.address()?.port || port}`; };
  async function ensureWorker() {
    await transition;
    if (worker && worker.generation === generation) return worker;
    if (workerStarting) { await workerStarting; if (worker?.generation === generation) return worker; return ensureWorker(); }
    const expected = generation;
    workerStarting = (async () => {
    await stopWorker('The previous private runtime must finish before restart.');
    // Static pages also cause startup. Recheck team access before a runtime can
    // initialize schedulers, even if no private API request has happened yet.
    if (phase === 'ready') {
      let fresh;
      try { fresh = await identity.authorize(verified, access.owner); }
      catch (failure) { if (expected === generation) await schedule(() => block(failure.message)); throw failure; }
      if (expected !== generation || identity.credential()?.fingerprint !== verified?.fingerprint) throw fail('The account changed before runtime startup.');
      if (fresh.canWrite !== access.canWrite || fresh.role !== access.role) { await schedule(() => block('Team permissions changed. Select this Squad again.')); throw fail('Team permissions changed.'); }
    }
    const key = phase === 'ready' && access ? ownerKey(access.owner) : `locked-${generation}`;
    let privateHmrPort;
    if(dev) {
      if(hmrPort)privateHmrPort=hmrPort;
      else {
        const reservation=createPortReservation();
        await new Promise((ready,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',ready);});
        privateHmrPort=reservation.address().port;
        await new Promise(resolveClose=>reservation.close(resolveClose));
      }
    }
    if(expected!==generation||closing)throw fail('The account changed before private runtime allocation.');
    const paths = phase === 'ready' ? dataset : await stageDataset(serviceRoot, key);
    if (expected !== generation) throw fail('The account changed before runtime startup.');
    const { root: base, dataRoot, appRoot, workspaceRoot, logsRoot, datasetId } = paths;
    for (const name of ['state', 'app', 'member-homes', 'logs']) await ownedDirectory(serviceRoot, ['owners', key, 'datasets', datasetId, name], { create: false });
    const context = { version: 1, generation: expected, actor: phase === 'ready' ? verified.actor : null, owner: phase === 'ready' ? access.owner : null,
      label: access?.label || '', canWrite: phase === 'ready' && access?.canWrite === true, role: access?.role || '',
      credentialFingerprint: phase === 'ready' ? verified.fingerprint : '',
      serviceRoot, datasetId, dataRoot, appRoot, workspaceRoot, publicUrl: serviceOrigin() };
    const token = randomBytes(32).toString('hex');
    const output = await open(join(base, 'worker.log'), constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | (constants.O_NOFOLLOW || 0), 0o600);
    const outputInfo = await output.stat();
    if (!outputInfo.isFile() || outputInfo.nlink !== 1) { await output.close(); throw fail('The private runtime log is unsafe.', 503, 'owned_path_invalid'); }
    const intent = await workerLedger.pending();
    if (expected !== generation || closing) { await intent.clear(); await output.close(); throw fail('The account changed before private runtime launch.'); }
    let windowsJob;
    try {
      if(process.platform==='win32')windowsJob=await createWindowsJob(intent.jobName,{rootDir,serviceRoot,receiptPath:intent.receiptPath,bootUptimeMs:intent.bootUptimeMs});
      if(expected!==generation||closing)throw fail('The account changed before Windows work admission.');
    } catch(failure) {await windowsJob?.terminate();await intent.clear();await output.close();throw failure;}
    return new Promise((resolveReady, rejectReady) => {
      let child;
      try {child = fork(workerEntry, ['--host', '127.0.0.1', '--port', '0', ...(dev ? ['--dev','--hmr-port',String(privateHmrPort)] : [])], {
        cwd: rootDir, detached: process.platform !== 'win32',
        env: { ...process.env, AUTOHAND_SQUAD_HOME: dataRoot, AUTOHAND_SQUAD_SERVICE_HOME: serviceRoot,
          AUTOHAND_SQUAD_APP_STATE_DIR: appRoot, AUTOHAND_SQUAD_LOGS_DIR: logsRoot, AUTOHAND_USER_CONFIG_PATH: configPath,
          AUTOHAND_SQUAD_WORKER_CONTEXT: JSON.stringify(context), AUTOHAND_SQUAD_WORKER_TOKEN: token,
          ...(windowsJob?{AUTOHAND_SQUAD_WIN_JOB_PIPE:windowsJob.pipe}:{}) },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });} catch(failure) {
        void (async()=>{try{await windowsJob?.terminate();await intent.clear();}finally{await output.close();}})().then(()=>rejectReady(failure),rejectReady);
        return;
      }
      liveChildren.add(child);
      childIntents.set(child, intent);
      if(windowsJob)childJobs.set(child,windowsJob);
      startingChild = child;
      // Runtime output can contain prompts and paths. It belongs to this owner,
      // never the machine-wide service log or another account's feedback bundle.
      let logWrites = Promise.resolve();
      const log = chunk => { logWrites = logWrites.then(() => output.write(chunk)).catch(() => {}); };
      child.stdout.on('data', chunk => { void log(chunk); }); child.stderr.on('data', chunk => { void log(chunk); });
      childOutputClosed.set(child, new Promise(resolveOutput => child.once('close', () => { void logWrites.finally(() => output.close()).catch(() => {}).finally(resolveOutput); })));
      let failing = false;
      let awaitingStart = false, launchRecorded = false, startSent = false;
      const sendStart = () => {
        if (!awaitingStart || !launchRecorded || startSent || expected !== generation || closing || failing || child.exitCode !== null || child.signalCode !== null) return;
        startSent = true; child.send({ type: 'ownership-start', generation: expected });
      };
      const failStartup = async failure => { if (failing) return; failing = true; clearTimeout(timer); try {await terminateChild(child, 'Private runtime startup failed.');}catch(cleanupFailure){failure=cleanupFailure;}rejectReady(failure); };
      const timer = setTimeout(() => { void failStartup(fail('The private Squad runtime did not start.', 503, 'worker_unavailable')); }, startupTimeoutMs); timer.unref();
      child.once('error', failure => { void failStartup(failure); });
      child.once('exit', () => { clearTimeout(timer); if (startingChild === child) startingChild = null; if (worker?.child === child) worker = null; void failStartup(fail('The private Squad runtime stopped.', 503, 'worker_unavailable')); });
      const launch = (windowsJob?windowsJob.attached(child.pid):Promise.resolve()).then(()=>intent.launched(child.pid)); childLaunches.set(child, launch);
      void launch.then(() => { launchRecorded = true; sendStart(); }).catch(failure => { void failStartup(failure); });
      child.on('message', message => {
        if (message?.type === 'ownership-awaiting-start' && message.generation === expected) { awaitingStart = true; sendStart(); return; }
        if (message?.type !== 'ownership-ready' || message.generation !== expected || !Number.isInteger(message.port) || message.port <= 0 || message.port > 65535) return;
        clearTimeout(timer);
        if (expected !== generation || closing || failing) { void failStartup(fail('The account changed while its runtime was starting.')); return; }
        worker = { child, generation: expected, token, port: message.port, context };
        if (startingChild === child) startingChild = null;
        resolveReady(worker);
      });
    });
    })();
    try { return await workerStarting; } finally { workerStarting = null; }
  }
  function originAllowed(req) {
    if (!req.headers.origin) return true;
    try { const value = new URL(req.headers.origin); const local = new URL(serviceOrigin()); return ['localhost', '127.0.0.1', '[::1]'].includes(value.hostname) && value.port === local.port && value.protocol === local.protocol; }
    catch { return false; }
  }
  function sameContext(req, url) {
    const fromHeader = req.headers[contextHeader];
    const fromUrl = req.method === 'GET' ? url.searchParams.get('context') : null;
    return (fromHeader || fromUrl) === generation;
  }
  function managedRequest(req, path) {
    return (path.startsWith('/api/team/') && req.headers['x-squad-team-token'])
      || (path.startsWith('/api/vault/') && req.headers['x-squad-vault-token'])
      || (path.startsWith('/api/computer-use/') && req.headers['x-squad-computer-token']);
  }
  async function proxy(req, res, target, expected = generation, body) {
    if (expected !== generation || target.generation !== expected) throw fail('The account changed before the request started.');
    const headers = { ...req.headers, host: `127.0.0.1:${target.port}`, 'x-squad-worker-token': target.token, 'x-squad-context': expected };
    if(!isLoopback(req.socket.remoteAddress)||/^Bearer /i.test(String(req.headers.authorization||'')))headers[REMOTE_TRANSPORT_HEADER]=REMOTE_TRANSPORT_VALUE;
    if (body !== undefined) headers['content-length'] = String(body.length);
    delete headers['transfer-encoding'];
    await new Promise((resolveProxy, rejectProxy) => {
      const upstream = httpRequest({ hostname: '127.0.0.1', port: target.port, method: req.method, path: req.url, headers }, response => {
        if (expected !== generation) { response.destroy(); res.destroy(); resolveProxy(); return; }
        res.writeHead(response.statusCode || 502, { ...response.headers, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
        response.pipe(res); response.once('end', resolveProxy); response.once('error', rejectProxy);
      });
      const connection = { upstream, response: res }; connections.add(connection);
      upstream.once('error', rejectProxy); res.once('close', () => { connections.delete(connection); upstream.destroy(); resolveProxy(); });
      if (body !== undefined) upstream.end(body); else req.pipe(upstream);
    });
  }

  const server = createServer(async (req, res) => {
    checkCredential();
    try {
      let url;
      try { url = new URL(req.url || '/', serviceOrigin()); }
      catch { throw fail('Invalid request URL.', 400, 'invalid_request_url'); }
      const local = isLoopback(req.socket.remoteAddress);
      if (url.pathname === '/api/health') { json(res, 200, { success: true, service: 'autohand-squad-bridge', pid: process.pid, startedAt, ...(local?{stateDir:serviceRoot}:{}), ownership: 1 }); return; }
      if (url.pathname.startsWith('/api/') && !originAllowed(req)) throw fail('This browser origin is not allowed.', 403, 'origin_denied');
      if(url.pathname==='/api/system/reset'||url.pathname==='/api/system/reset/status')throw fail('This reset protocol was replaced by owner-scoped data operations. Reopen Settings → System in the updated Squad app.',410,'reset_protocol_replaced');
      if (local && !req.headers.authorization && req.method === 'GET' && url.pathname === '/api/runtime' && !req.headers[contextHeader] && !url.searchParams.has('context')) { json(res, 200, { success:true, data:{service:'autohand-squad-bridge', ownership:{state:phase,generation}} }); return; }
      if (url.pathname.startsWith('/api/ownership/')) {
        if (!local) throw fail('Ownership control is available only on this computer.', 403, 'local_required');
        if (url.pathname === '/api/ownership/context' && req.method === 'GET') { json(res, 200, { success: true, data: publicContext() }); return; }
        if (url.pathname === '/api/ownership/events' && req.method === 'GET') {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
          subscribers.add(res); res.write(`data: ${JSON.stringify(publicContext())}\n\n`); res.on('close', () => subscribers.delete(res)); return;
        }
        if (url.pathname === '/api/ownership/retry' && req.method === 'POST') {
          if (!sameContext(req, url)) throw fail('The sign-in context changed. Refresh before retrying.');
          await schedule(() => activate(identity.credential()));
          json(res, 200, { success: true, data: publicContext() }); return;
        }
        await transition;
        if (!verified || !sameContext(req, url)) throw fail('The account changed. Reopen Squad.');
        if(url.pathname==='/api/ownership/legacy/preview'&&req.method==='POST') {
          const departing=generation,input=legacyRecoveryInput.parse(await readBody(req,8*1024*1024));
          if(departing!==generation||phase!=='ready')throw fail('The selected Squad changed before recovery.');
          await authorizeCurrent(true);if(departing!==generation)throw fail('The selected Squad changed before recovery.');
          const captured=capturedContext();
          const pending=(async()=>{const plan=await prepareLegacyRecovery(captured,input);captured.assertCurrent();await authorizeCurrent(true);captured.assertCurrent();return plan;})();
          brokerActivities.add(pending);
          try {json(res,201,{success:true,data:await pending});}finally{brokerActivities.delete(pending);}
          return;
        }
        if(url.pathname.startsWith('/api/ownership/cloud/')) {
          const departing=generation;
          if(url.pathname==='/api/ownership/cloud/backups'&&req.method==='GET') {
            const cursor=z.string().max(200).parse(url.searchParams.get('cursor')||'');
            json(res,200,{success:true,data:await cloudActivity(departing,false,service=>service.list({cursor}))});return;
          }
          if(url.pathname==='/api/ownership/cloud/reconnect'&&req.method==='POST') {json(res,200,{success:true,data:await cloudActivity(departing,false,service=>service.reconnect())});return;}
          if(url.pathname==='/api/ownership/cloud/backups'&&req.method==='POST') {
            const input=z.object({id:z.uuid(),backupId:z.uuid(),label:z.string().trim().min(1).max(120),resolutions:z.array(z.object({key:z.string().max(300),remoteRevision:z.number().int().nonnegative(),remoteHash:z.string().regex(/^[a-f0-9]{64}$/),choice:z.literal('local')}).strict()).max(10_001).default([])}).strict().parse(await readBody(req,4*1024*1024));
            json(res,200,{success:true,data:await cloudActivity(departing,true,service=>service.save(input))});return;
          }
          const cloudOperation=url.pathname.match(/^\/api\/ownership\/cloud\/operations\/([a-f0-9-]{36})$/);
          if(cloudOperation&&req.method==='GET') {json(res,200,{success:true,data:await cloudActivity(departing,false,service=>service.status(cloudOperation[1]))});return;}
          if(url.pathname==='/api/ownership/cloud/imports'&&req.method==='POST') {
            const input=z.object({id:z.uuid(),planId:z.uuid(),format:z.enum(['json','yaml']).default('json')}).strict().parse(await readBody(req,2048));
            json(res,201,{success:true,data:await cloudActivity(departing,true,service=>service.prepareImport(input))});return;
          }
          if(url.pathname==='/api/ownership/cloud/downloads'&&req.method==='POST') {
            const input=z.object({id:z.uuid(),planId:z.uuid(),format:z.enum(['json','yaml']).default('json')}).strict().parse(await readBody(req,2048));
            json(res,201,{success:true,data:await cloudActivity(departing,false,service=>service.download(input))});return;
          }
          const cloudBackup=url.pathname.match(/^\/api\/ownership\/cloud\/backups\/([a-f0-9-]{36})$/);
          if(cloudBackup&&req.method==='DELETE') {
            const input=z.object({confirm:z.literal('remove-cloud-backup')}).strict().parse(await readBody(req,512));
            json(res,200,{success:true,data:await cloudActivity(departing,true,service=>service.remove({planId:cloudBackup[1],confirm:input.confirm}))});return;
          }
          throw fail('Cloud backup route not found.',404,'route_not_found');
        }
        if(url.pathname==='/api/ownership/imports'&&req.method==='POST') {
          if(phase!=='ready')throw fail('Finish the current data operation before preparing an import.');
          await authorizeCurrent(true);const captured=capturedContext();
          const format=z.enum(['json','yaml']).parse(url.searchParams.get('format'));
          const id=z.uuid().parse(url.searchParams.get('requestId'));
          const bytes=await readUpload(req);captured.assertCurrent();
          const plan=await createImportSources(captured).prepare({bytes,format,id});
          await authorizeCurrent(true);captured.assertCurrent();
          json(res,201,{success:true,data:plan});return;
        }
        const importMatch=url.pathname.match(/^\/api\/ownership\/imports\/([a-f0-9-]{36})$/);
        if(importMatch&&req.method==='GET') {
          await authorizeCurrent(true);const captured=capturedContext(),plan=await createImportSources(captured).get(importMatch[1]);captured.assertCurrent();
          json(res,200,{success:true,data:plan});return;
        }
        if(url.pathname==='/api/ownership/operations'&&req.method==='POST') {
          const input=z.object({id:z.uuid(),kind:z.enum(['restore','reset']),beforeDatasetId:z.uuid(),sourceId:z.uuid().nullable().default(null),sourceDigest:z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),confirmation:z.literal('replace-current-squad')}).strict().parse(await readBody(req,4096));
          const departing=generation,fingerprint=verified.fingerprint;delete input.confirmation;
          const row=await schedule(()=>dataOperation(input,departing));
          checkCredential();if(identity.credential()?.fingerprint!==fingerprint)throw fail('The signed-in account changed. Reopen its Squad to check the operation.');
          json(res,200,{success:true,data:{operation:operationSummary(row),context:publicContext()}});return;
        }
        const operationMatch=url.pathname.match(/^\/api\/ownership\/operations\/([a-f0-9-]{36})(\/restart)?$/);
        if(operationMatch&&req.method==='GET'&&!operationMatch[2]) {
          await authorizeCurrent();const captured=capturedContext(),row=await (await journal()).get(operationMatch[1]);captured.assertCurrent();
          json(res,200,{success:true,data:operationSummary(row)});return;
        }
        if(operationMatch&&req.method==='POST'&&operationMatch[2]) {
          const input=z.object({revision:z.number().int().positive()}).strict().parse(await readBody(req,2048)),departing=generation;
          await schedule(async()=>{
            if(departing!==generation||phase!=='awaiting_restart'||pendingOperation?.id!==operationMatch[1])throw fail('This completion screen changed. Refresh before restarting Squad.');
            await authorizeCurrent(true);const captured=capturedContext();
            await (await journal()).acknowledge(operationMatch[1],input.revision);captured.assertCurrent();
            pendingOperation=null;phase='ready';error='';revoke();await publishReceipt();await resumeNative();
          });
          json(res,200,{success:true,data:publicContext()});return;
        }
        if (url.pathname === '/api/ownership/owners' && req.method === 'GET') {
          try { json(res, 200, { success: true, data: { owners: await identity.owners(verified), error: '' } }); }
          catch (failure) { json(res, 200, { success: true, data: { owners: [identity.personal(verified)], error: failure.message } }); }
          return;
        }
        if (url.pathname === '/api/ownership/select' && req.method === 'POST') {
          const input = z.object({ owner: ownerSchema, expectedGeneration: z.string().uuid() }).strict().parse(await readBody(req, 4096));
          const departing = generation;
          if (input.expectedGeneration !== departing) throw fail('The selected Squad changed. Try again.');
          const selected = await identity.authorize(verified, input.owner);
          await schedule(async () => {
            if (generation !== departing || identity.credential()?.fingerprint !== verified?.fingerprint) throw fail('The account changed.');
            phase = 'verifying'; revoke(); await publishReceipt(); await quiesce('The selected Squad changed. Background work stays paused.');
            const fresh = await identity.authorize(verified, selected.owner);
            dataset = await ensureDataset(serviceRoot, ownerKey(fresh.owner));
            if (identity.credential()?.fingerprint !== verified?.fingerprint) throw fail('The account changed.');
            const selections = await readPersistentJson(selectionFile, { version: 1, owners: {} });
            selections.owners[actorKey(verified.actor)] = selected.owner; await writePersistentJson(selectionFile, selections);
            access = fresh;await recoverOperations();error = ''; teamCheckedAt = Date.now(); await publishReceipt();if(phase==='ready')await resumeNative();
          });
          json(res, 200, { success: true, data: publicContext() }); return;
        }
        throw fail('Ownership route not found.', 404, 'route_not_found');
      }
      const isApi = url.pathname.startsWith('/api/');
      let body;
      const publicRead = local && req.method === 'GET' && publicGet.has(url.pathname) && (url.pathname !== '/api/harnesses/login' || url.searchParams.get('id') === 'autohand');
      if (publicRead && (req.headers[contextHeader] || url.searchParams.has('context')) && !sameContext(req, url)) throw fail('The account changed before this request started.');
      const login = local && ((url.pathname === '/api/harnesses/login' && ['POST', 'DELETE'].includes(req.method)) || (url.pathname === '/api/harnesses/login/open' && req.method === 'POST'));
      const logout = local && url.pathname === '/api/account/logout' && req.method === 'POST';
      if ((login || logout) && !sameContext(req, url)) throw fail('The sign-in context changed. Refresh before continuing.');
      if (login) {
        if (url.pathname === '/api/harnesses/login' && req.method === 'POST') {
          const input = z.object({ id: z.literal('autohand') }).strict().parse(await readBody(req, 4096));
          body = Buffer.from(JSON.stringify(input));
        } else if (url.searchParams.get('id') !== 'autohand') throw fail('Choose Autohand sign-in.', 400, 'invalid_login');
      }
      await transition;
      if ((login || logout || (publicRead && (req.headers[contextHeader] || url.searchParams.has('context')))) && !sameContext(req, url)) throw fail('The sign-in context changed before this request started.');
      let acceptedGeneration = generation;
      if (isApi && !publicRead && !login && !logout) {
        if (phase !== 'ready' || !verified || !access) throw fail(error || 'Sign in and select an authorized Squad.', 401, 'sign_in_required');
        const remote = /^Bearer /i.test(String(req.headers.authorization || ''));
        if(!local&&!remote)throw fail('Remote requests require a valid served bearer credential; an ownership generation is not authorization.',401,'remote_auth_required');
        if(remote&&!access.canWrite)throw fail('Read-only owned data is available through the local data view and cloud API. Remote member execution is unavailable.',403,'owner_read_only');
        if (!sameContext(req, url) && !managedRequest(req, url.pathname) && !remote) throw fail('This request belongs to an expired ownership context.');
        const write = !['GET', 'HEAD'].includes(req.method) && !readOnlyPosts.has(url.pathname);
        const captured = generation;
        try {
          const fresh = await identity.authorize(verified, access.owner);
          checkCredential();
          if (captured !== generation) throw fail('The account changed while access was checked.');
          if (fresh.canWrite !== access.canWrite || fresh.role !== access.role) { await schedule(() => activate(identity.credential())); throw fail('Team permissions changed. Reopen this Squad.'); }
          if (write && !fresh.canWrite) throw fail('This team is read-only. Retrieval and backup remain available.', 403, 'owner_read_only');
        } catch (failure) {
          if (failure.status !== 403 && failure.code !== 'context_changed') await schedule(() => block(failure.message, 'Current team access could not be verified.'));
          throw failure;
        }
      }
      if (!local && !isApi) throw fail('Open Squad on this computer.', 403, 'local_required');
      acceptedGeneration = generation;
      const target = await ensureWorker();
      checkCredential();
      await proxy(req, res, target, acceptedGeneration, body);
      if (login || logout) checkCredential();
    } catch (failure) {
      if (!res.headersSent) json(res, failure.status || (failure instanceof z.ZodError ? 400 : 503), { success: false, error: failure.message || 'Squad could not complete this request.', code: failure.code || 'ownership_error' });
      else res.destroy();
    }
  });
  const timer = setInterval(() => {
    if (closing || !server.listening || !releaseWriter) return;
    checkCredential();
    if (phase === 'ready' && access?.owner.kind === 'team' && Date.now() - teamCheckedAt > 15_000) {
      teamCheckedAt = Date.now(); const captured = generation;
      void identity.authorize(verified, access.owner).then(async fresh => {
        if (captured !== generation) return;
        if (fresh.canWrite !== access.canWrite || fresh.role !== access.role) void schedule(() => activate(identity.credential()));
        else { teamCheckedAt = Date.now(); await publishReceipt(); }
      })
        .catch(failure => { if (captured === generation) void schedule(() => block(failure.message)); });
    }
  }, 250); timer.unref();
  async function listen() {
    await mkdir(serviceRoot, { recursive: true, mode: 0o700 });
    await ownedDirectory(serviceRoot, []);
    releaseWriter = await acquireWriterLease(join(serviceRoot, 'ownership-writer.sqlite'));
    try {
      workerLedger = await createWorkerLedger(serviceRoot, brokerId);
      await writePersistentJson(join(serviceRoot, 'ownership-control.json'), { version: 1, brokerId, token: controlToken });
      await new Promise((resolveListen, rejectListen) => { server.once('error', rejectListen); server.listen(port, host, resolveListen); });
    } catch (failure) { releaseWriter(); releaseWriter = null; throw failure; }
    checkCredential();
    return serviceOrigin();
  }
  async function close() {
    if (closing) return;
    closing = true; clearInterval(timer); phase = 'closed'; revoke();
    if (!releaseWriter) return;
    await transition; await publishReceipt(); await quiesce('Squad service stopped.'); await resumeNative();
    for (const response of subscribers) response.end(); subscribers.clear();
    await new Promise(resolveClose => server.close(resolveClose));
    releaseWriter?.(); releaseWriter = null;
  }
  return { server, listen, close, context: publicContext };
}

export async function runOwnershipBroker({ rootDir = process.cwd(), argv = process.argv.slice(2) } = {}) {
  const args = new Map();
  for (let index = 0; index < argv.length; index++) if (argv[index].startsWith('--')) args.set(argv[index].slice(2), argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : true);
  const autohandRoot = resolve(process.env.AUTOHAND_HOME || join(homedir(), '.autohand'));
  const serviceRoot = resolve(process.env.AUTOHAND_SQUAD_HOME || join(autohandRoot, 'squad'));
  const configPath = resolve(process.env.AUTOHAND_USER_CONFIG_PATH || join(autohandRoot, 'config.json'));
  const broker = createOwnershipBroker({ rootDir, serviceRoot, configPath, host: String(args.get('host') || '127.0.0.1'), port: Number(args.get('port') || 19821), dev: args.get('dev') === true,...(args.has('hmr-port')?{hmrPort:Number(args.get('hmr-port'))}:{}) });
  let done;
  const closed = new Promise(resolveClosed => { done = resolveClosed; });
  const stop = () => { void broker.close().then(done, () => process.exit(1)); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  const origin = await broker.listen();
  console.log(`autohandSWE ownership broker listening on ${origin}`);
  await closed;
}
