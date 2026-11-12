import { access,open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export async function nativeOwnershipHelper({ rootDir = fileURLToPath(new URL('../..', import.meta.url)), serviceRoot = process.env.AUTOHAND_SQUAD_SERVICE_HOME || process.env.AUTOHAND_SQUAD_HOME || '' } = {}) {
  const name = `autohand-squad-daemon${process.platform === 'win32' ? '.exe' : ''}`;
  const paths = process.env.AUTOHAND_SQUAD_DAEMON ? [resolve(process.env.AUTOHAND_SQUAD_DAEMON)] : [
    join(rootDir, 'bin', name), join(rootDir, name), join(dirname(process.execPath), name),
    join(rootDir, '..', '..', 'bin', name), ...(serviceRoot ? [join(serviceRoot, 'bin', name)] : []),
    join(rootDir, 'daemon', 'target', 'debug', name), join(rootDir, 'daemon', 'target', 'release', name),
  ];
  for (const path of paths) { try { await access(path, constants.X_OK); return path; } catch { /* Only trusted packaged locations. */ } }
  throw Error('The Windows ownership runtime is unavailable. Update or rebuild Squad; existing data was preserved.');
}
function helperEnvironment() {
  const env = { ...process.env };
  for (const name of ['AUTOHAND_SQUAD_NATIVE_GRANT_TOKEN', 'AUTOHAND_SQUAD_WORKER_TOKEN', 'AUTOHAND_SQUAD_WORKER_CONTEXT']) delete env[name];
  return env;
}
export async function runOwnershipHelper(args, options) {
  return execute(await nativeOwnershipHelper(options), args, { env: helperEnvironment(), windowsHide: true, timeout: 10_000, maxBuffer: 8192 });
}
export function validateJobName(name) {
  if (typeof name !== 'string' || !/^Global\\AutohandSquad-[a-f0-9]{64}$/.test(name)) throw Error('The saved Windows job identity is invalid. Existing data was preserved.');
  return name;
}
export function windowsJobPipe(name) { return `\\\\.\\pipe\\AutohandSquad-${validateJobName(name).slice(21)}`; }
export async function windowsJobIsEmpty(name, options) {
  const { stdout } = await runOwnershipHelper(['--ownership-job-status', validateJobName(name)], options);
  const value = JSON.parse(stdout);
  if (typeof value.empty !== 'boolean') throw Error('Windows work cleanup could not be verified.');
  return value.empty;
}
export async function windowsBootUptime() {
  const {stdout}=await runOwnershipHelper(['--ownership-uptime']);
  const value=JSON.parse(stdout).uptimeMs;
  if(!Number.isSafeInteger(value)||value<0)throw Error('Windows startup identity could not be checked.');
  return value;
}
async function readWindowsDrainReceipt(name,receiptPath) {
  if(receiptPath) {
    let file;
    try {
      file=await open(receiptPath,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
      const info=await file.stat();
      if(!info.isFile()||info.nlink!==1||info.size>4096)throw Error('Invalid Windows drain receipt.');
      const value=JSON.parse(await file.readFile('utf8'));
      if(value.version!==1||value.jobName!==name||value.drained!==true)throw Error('Windows drain receipt does not match this work.');
      return true;
    }catch(error){if(error.code!=='ENOENT')throw error;}finally{await file?.close();}
  }
  return false;
}
export async function windowsJobDrained(name,options={}) {
  validateJobName(name);
  if(await readWindowsDrainReceipt(name,options.receiptPath))return true;
  const value=options.queryStatus ? await options.queryStatus(name) : JSON.parse((await runOwnershipHelper(['--ownership-job-status',name],options)).stdout);
  // The watchdog writes the receipt before exiting. It can do both while our
  // status helper starts, so a missing job must trigger a fresh receipt read.
  if(await readWindowsDrainReceipt(name,options.receiptPath))return true;
  if(value.empty===true)return true;
  // Absence of an object name alone is not a completed-I/O barrier. A strictly
  // lower OS uptime proves a reset; equal/higher uptime proves nothing.
  return value.missing===true&&Number.isSafeInteger(value.uptimeMs)&&value.uptimeMs>=0&&Number.isSafeInteger(options.bootUptimeMs)&&value.uptimeMs<options.bootUptimeMs;
}
export async function createWindowsJob(name, options) {
  if(!options?.receiptPath)throw Error('Windows work requires its durable drain receipt.');
  // libuv kills non-detached Windows children with their Node parent. The
  // watchdog must survive long enough to drain its job and flush the receipt
  // after broker loss; its control pipe remains connected until that loss.
  const helper = spawn(await nativeOwnershipHelper(options), ['--ownership-job', validateJobName(name),options.receiptPath], { env: helperEnvironment(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,detached:true });
  let buffer = '', failure, closing;
  const results = new Map(), pending = new Map();
  const fail = error => { failure ||= error; for (const waiter of pending.values()) {clearTimeout(waiter.timer);waiter.reject(failure);} pending.clear(); };
  helper.on('error', fail);
  helper.stdin.on('error', fail);
  helper.stderr.resume();
  const exited = new Promise(resolve => helper.once('close', () => {fail(Error('Windows work supervision stopped. Existing data was preserved.'));resolve();}));
  helper.stdout.setEncoding('utf8');
  helper.stdout.on('data', chunk => {
    buffer += chunk;
    if (buffer.length > 8192) { helper.kill();fail(Error('Invalid Windows supervision response.'));return; }
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline);buffer = buffer.slice(newline + 1);
      try {
        const value = JSON.parse(line);
        const key = value.ready ? 'ready' : value.attached ? 'attached' : value.drained ? 'drained' : '';
        if (!key || value.success !== true) throw Error('Invalid Windows supervision response.');
        const waiter = pending.get(key);
        if (waiter) {clearTimeout(waiter.timer);pending.delete(key);waiter.resolve(value);} else results.set(key, value);
      } catch (error) { helper.kill();fail(error); }
    }
  });
  const wait = key => {
    if (results.has(key)) return Promise.resolve(results.get(key));
    if (failure) return Promise.reject(failure);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {pending.delete(key);reject(Error('Windows work supervision timed out. Existing data was preserved.'));}, 35_000);
      pending.set(key, {resolve,reject,timer});
    });
  };
  try { await wait('ready'); } catch (error) { helper.kill();await exited;throw error; }
  return {
    pid:helper.pid,
    pipe: windowsJobPipe(name),
    async attached(pid) { const value = await wait('attached');if (value.attached !== pid) throw Error('The waiting Windows worker did not match its supervisor.'); },
    terminate() {
      return closing ||= (async () => {
        try {
          const drained = wait('drained');
          if (!failure) helper.stdin.end(`${JSON.stringify({action:'terminate'})}\n`);
          await drained;
        } catch (error) {
          helper.kill();await exited;
          if (!await windowsJobDrained(name,options)) throw error;
        }
        await exited;
      })();
    },
  };
}
