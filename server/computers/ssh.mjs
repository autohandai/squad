// Computers reached over SSH (ADR-0282). Squad does not run members over a
// raw shell: a member on another computer runs on that computer's own Squad,
// through the remote-member runner of ADR-0025. SSH is how this computer
// reaches that Squad when it isn't on the network: Squad keeps one
// `ssh -N -L` forward open per saved computer, so the other Squad's bridge
// (127.0.0.1:<remotePort> over there) answers on 127.0.0.1:<localPort> here,
// and a member's Runs on points at that local address with the token the
// other computer minted ("Share this machine").
//
//   <squadStateDir>/computers.json  (mode 0600)
//   { "ssh": [{ id, label, user, host, port, identityFile, remotePort, localPort, addedAt }] }
//
// No password is ever asked for or stored: BatchMode means the key (a file
// under ~/.ssh, or the ssh agent) has to work on its own.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { chmod, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';

export const COMPUTERS_FILE = 'computers.json';
export const SQUAD_BRIDGE_PORT = 19821;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

/** A saved or candidate SSH computer, cleaned; refuses anything ssh could read as an option. */
export function cleanSshComputer(input, { home = homedir() } = {}) {
  const value = input && typeof input === 'object' ? input : {};
  const user = String(value.user ?? '').trim(), host = String(value.host ?? '').trim();
  if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,31}$/.test(user)) throw fail('Use the user name you sign in with on that computer, like igor.');
  if (!/^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,62})(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}))*|\[[0-9A-Fa-f:]{2,45}\])$/.test(host) || host.length > 253) throw fail('Use the computer’s host name or IP address, like studio.local or 192.168.1.20.');
  const port = value.port === undefined || value.port === '' ? 22 : Number(value.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw fail('The SSH port is a number from 1 to 65535.');
  const remotePort = value.remotePort === undefined || value.remotePort === '' ? SQUAD_BRIDGE_PORT : Number(value.remotePort);
  if (!Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535) throw fail('Squad’s port on that computer is a number from 1 to 65535.');
  let identityFile = String(value.identityFile ?? '').trim();
  if (identityFile) {
    const sshDir = resolve(home, '.ssh');
    identityFile = resolve(identityFile.startsWith('~/') ? join(home, identityFile.slice(2)) : identityFile);
    if (!identityFile.startsWith(sshDir + sep)) throw fail('Choose a key in your ~/.ssh folder, or leave it empty to use the ssh agent.');
  }
  const label = String(value.label ?? '').trim().slice(0, 60) || host.replace(/^\[|\]$/g, '');
  return { label, user, host, port, identityFile, remotePort };
}

/** The ssh arguments for one computer: `options` before the destination, `command` after it. */
export function sshArguments(computer, { options = [], command = [], connectTimeout = 8 } = {}) {
  return [
    '-o', 'BatchMode=yes', '-o', `ConnectTimeout=${connectTimeout}`, '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
    '-p', String(computer.port), ...(computer.identityFile ? ['-i', computer.identityFile, '-o', 'IdentitiesOnly=yes'] : []),
    ...options, '--', `${computer.user}@${computer.host.replace(/^\[|\]$/g, '')}`, ...command,
  ];
}

/** Key files a person can choose: private keys with a .pub beside them. Names only, never contents. */
export async function listSshKeys({ home = homedir() } = {}) {
  const dir = join(home, '.ssh');
  const names = await readdir(dir).catch(() => []);
  return names.filter(name => names.includes(`${name}.pub`)).sort().map(name => ({ name, path: join(dir, name) }));
}

const freePort = () => new Promise((done, reject) => {
  const server = createServer(); server.unref();
  server.on('error', reject);
  server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => done(port)); });
});

/** One sentence from ssh's stderr, in the person's words. */
export function sshProblem(stderr, computer) {
  const text = String(stderr || '');
  const where = `${computer.user}@${computer.host}`;
  if (/Permission denied/i.test(text)) return `${where} refused the key. Add this computer’s public key to ~/.ssh/authorized_keys there, or choose another key.`;
  if (/Could not resolve hostname|Name or service not known|nodename nor servname/i.test(text)) return `${computer.host} could not be found. Check the host name.`;
  if (/Connection refused/i.test(text)) return `${computer.host} refused SSH on port ${computer.port}. Is Remote Login (SSH) on there?`;
  if (/timed out|No route to host|Network is unreachable/i.test(text)) return `${computer.host} did not answer on port ${computer.port}.`;
  if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(text)) return `${computer.host}’s identity changed since you last connected. Check it, then remove its line from ~/.ssh/known_hosts.`;
  if (/forwarding failed|Address already in use/i.test(text)) return `The connection to Squad on ${computer.host} could not be opened.`;
  return text.trim().split('\n').filter(Boolean).pop()?.slice(0, 200) || `${where} could not be reached.`;
}

export function createSshComputers({ squadStateDir, sshPath = 'ssh', home = homedir(), fetchImpl = fetch, now = () => new Date().toISOString(), spawnImpl = spawn }) {
  if (!squadStateDir) throw fail('squadStateDir is required', 500);
  const path = join(squadStateDir, COMPUTERS_FILE);
  const tunnels = new Map(); // id -> { child, state, error, retry, attempt }
  let queue = Promise.resolve(), closed = false;
  const serial = action => { const next = queue.then(action); queue = next.catch(() => {}); return next; };

  async function read() {
    try { const value = JSON.parse(await readFile(path, 'utf8')); return { ssh: Array.isArray(value?.ssh) ? value.ssh : [] }; }
    catch (error) { if (error.code === 'ENOENT') return { ssh: [] }; throw fail(`${path} is not readable: ${error.message}`, 500); }
  }
  async function write(state) {
    await mkdir(squadStateDir, { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await chmod(tmp, 0o600).catch(() => {}); await rename(tmp, path);
  }

  /** Runs ssh once and resolves with its exit code and stderr. */
  function run(computer, command, timeoutMs = 15_000) {
    return new Promise(done => {
      let stderr = '', stdout = '';
      const child = spawnImpl(sshPath, sshArguments(computer, { command }), { stdio: ['ignore', 'pipe', 'pipe'] });
      const timer = setTimeout(() => { child.kill('SIGKILL'); stderr += '\nConnection timed out'; }, timeoutMs);
      child.stdout?.on('data', chunk => { stdout += chunk; });
      child.stderr?.on('data', chunk => { stderr += chunk; });
      child.on('error', error => { clearTimeout(timer); done({ code: -1, stdout, stderr: error.code === 'ENOENT' ? 'ssh is not installed on this computer.' : error.message }); });
      child.on('close', code => { clearTimeout(timer); done({ code, stdout, stderr }); });
    });
  }

  /** Starts `ssh -N -L` and resolves once the local port answers, or rejects with ssh's reason. */
  function forward(computer, localPort) {
    return new Promise((done, reject) => {
      let stderr = '', settled = false;
      const child = spawnImpl(sshPath, sshArguments(computer, { options: ['-N', '-o', 'ExitOnForwardFailure=yes', '-L', `127.0.0.1:${localPort}:127.0.0.1:${computer.remotePort}`] }), { stdio: ['ignore', 'ignore', 'pipe'] });
      child.stderr?.on('data', chunk => { stderr += chunk; });
      const finish = (error) => { if (settled) return; settled = true; clearInterval(poll); clearTimeout(timer); error ? reject(error) : done(child); };
      child.on('error', error => finish(fail(error.code === 'ENOENT' ? 'ssh is not installed on this computer.' : error.message)));
      child.on('close', () => finish(fail(sshProblem(stderr, computer))));
      const timer = setTimeout(() => { child.kill('SIGKILL'); finish(fail(sshProblem(`${stderr}\nConnection timed out`, computer))); }, 15_000);
      const poll = setInterval(async () => {
        const open = await new Promise(answer => { const socket = createServer(); socket.once('error', () => answer(true)); socket.listen(localPort, '127.0.0.1', () => socket.close(() => answer(false))); });
        if (open) finish(null);
      }, 150);
      child.stderrText = () => stderr;
    });
  }

  /** Whether a Squad bridge answers at this address: any HTTP reply counts (it asks for a token). */
  async function squadAnswers(localPort) {
    try {
      const response = await fetchImpl(`http://127.0.0.1:${localPort}/api/runtime`, { signal: AbortSignal.timeout(5000), redirect: 'manual' });
      await response.body?.cancel?.();
      return true;
    } catch { return false; }
  }

  /**
   * Test a candidate: SSH signs in, then a forward reaches Squad's bridge
   * over there. One sentence for each outcome.
   */
  async function test(input) {
    const computer = cleanSshComputer(input, { home });
    if (computer.identityFile) await stat(computer.identityFile).catch(() => { throw fail(`${computer.identityFile} does not exist.`); });
    const signedIn = await run(computer, ['true']);
    if (signedIn.code !== 0) return { reachable: false, squad: false, message: sshProblem(signedIn.stderr, computer) };
    const port = await freePort();
    let child;
    try { child = await forward(computer, port); }
    catch (error) { return { reachable: true, squad: false, message: `Signed in to ${computer.user}@${computer.host}, but ${error.message.charAt(0).toLowerCase()}${error.message.slice(1)}` }; }
    try {
      const squad = await squadAnswers(port);
      return { reachable: true, squad, message: squad
        ? `Signed in to ${computer.user}@${computer.host}. Squad is running there.`
        : `Signed in to ${computer.user}@${computer.host}, but Squad isn’t answering on port ${computer.remotePort} there. Open Squad on that computer.` };
    } finally { child.kill('SIGTERM'); }
  }

  function publicComputer(record) {
    const tunnel = tunnels.get(record.id);
    return { id: record.id, label: record.label, user: record.user, host: record.host, port: record.port, identityFile: record.identityFile ? record.identityFile.replace(home, '~') : '',
      remotePort: record.remotePort, localUrl: `http://127.0.0.1:${record.localPort}`, addedAt: record.addedAt,
      state: tunnel?.state || 'stopped', error: tunnel?.error || '' };
  }

  function keepOpen(record) {
    if (closed) return;
    const tunnel = tunnels.get(record.id) || { attempt: 0 };
    tunnels.set(record.id, tunnel);
    tunnel.record = record; tunnel.state = 'connecting'; clearTimeout(tunnel.retry);
    forward(record, record.localPort).then(child => {
      if (closed || tunnels.get(record.id) !== tunnel) { child.kill('SIGTERM'); return; }
      tunnel.child = child; tunnel.state = 'connected'; tunnel.error = ''; tunnel.attempt = 0;
      child.on('close', () => {
        if (tunnel.child !== child) return;
        tunnel.child = null;
        if (closed || tunnels.get(record.id) !== tunnel) return;
        tunnel.state = 'reconnecting'; tunnel.error = sshProblem(child.stderrText?.() || 'The connection ended.', record);
        tunnel.retry = setTimeout(() => keepOpen(record), Math.min(60_000, 1000 * 2 ** Math.min(tunnel.attempt++, 6))); tunnel.retry.unref?.();
      });
    }).catch(error => {
      if (closed || tunnels.get(record.id) !== tunnel) return;
      tunnel.state = 'reconnecting'; tunnel.error = error.message;
      tunnel.retry = setTimeout(() => keepOpen(record), Math.min(60_000, 1000 * 2 ** Math.min(tunnel.attempt++, 6))); tunnel.retry.unref?.();
    });
  }
  function stop(id) {
    const tunnel = tunnels.get(id); if (!tunnel) return;
    tunnels.delete(id); clearTimeout(tunnel.retry); tunnel.child?.kill('SIGTERM');
  }

  return {
    test,
    keys: () => listSshKeys({ home }),
    list: async () => (await read()).ssh.map(publicComputer),
    /** Keeps every saved computer's forward open; call once at boot. */
    start: async () => { for (const record of (await read()).ssh) keepOpen(record); },
    add: input => serial(async () => {
      const computer = cleanSshComputer(input, { home });
      const state = await read();
      if (state.ssh.length >= 20) throw fail('Squad keeps at most 20 SSH computers.');
      if (state.ssh.some(row => row.user === computer.user && row.host === computer.host && row.port === computer.port)) throw fail(`${computer.user}@${computer.host} is already saved.`);
      const checked = await test(computer);
      if (!checked.reachable) throw fail(checked.message);
      const record = { id: randomUUID(), ...computer, localPort: await freePort(), addedAt: now() };
      state.ssh.push(record); await write(state);
      keepOpen(record);
      return { computer: publicComputer(record), test: checked };
    }),
    remove: id => serial(async () => {
      const state = await read();
      const record = state.ssh.find(row => row.id === id);
      if (!record) throw fail('That computer is no longer saved.', 404);
      state.ssh = state.ssh.filter(row => row.id !== id); await write(state);
      stop(id);
      return { removed: true, localUrl: `http://127.0.0.1:${record.localPort}` };
    }),
    close: () => { closed = true; for (const id of [...tunnels.keys()]) stop(id); return queue; },
  };
}
