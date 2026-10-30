// TurboVec stays in the packaged Rust runtime. The bridge owns canonical
// memories; this process is a disposable, rebuildable search index.
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export function createMemoryVectorClient({ rootDir, stateDir, binary = process.env.AUTOHAND_SQUAD_MEMORY_INDEX_BINARY || process.env.AUTOHAND_SQUAD_DAEMON } = {}) {
  let child, starting, buffer = '', sequence = 0, closed = false;
  const pending = new Map();
  const unavailable = message => Object.assign(new Error(message), { status: 503 });
  async function executable() {
    const suffix = process.platform === 'win32' ? '.exe' : '';
    const paths = binary ? [resolve(binary)] : [
      join(rootDir, 'bin', `autohand-squad-daemon${suffix}`),
      join(rootDir, `autohand-squad-daemon${suffix}`),
      join(rootDir, '..', '..', 'MacOS', `autohand-squad-daemon${suffix}`),
      join(dirname(process.execPath), `autohand-squad-daemon${suffix}`),
      join(rootDir, '..', '..', 'bin', `autohand-squad-daemon${suffix}`),
      join(stateDir, 'bin', `autohand-squad-daemon${suffix}`),
      join(rootDir, 'daemon', 'target', 'debug', `autohand-squad-daemon${suffix}`),
      join(rootDir, 'daemon', 'target', 'release', `autohand-squad-daemon${suffix}`),
    ];
    for (const path of paths) { try { await access(path, constants.X_OK); return path; } catch { /* Next packaged location. */ } }
    throw unavailable('The memory index runtime is unavailable. Rebuild or update Squad, then retry indexing.');
  }
  function fail(error, processChild) {
    if (processChild && processChild !== child) return;
    child = undefined; buffer = '';
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); }
    pending.clear();
  }
  async function start() {
    if (closed) throw unavailable('The memory index is closed.');
    if (child) return child;
    if (!starting) starting = (async () => {
      const command = await executable();
      if (closed) throw unavailable('The memory index is closed.');
      const processChild = spawn(command, ['--memory-index', '--index-dir', join(stateDir, 'memory', 'vectors')], { cwd: rootDir, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      child = processChild;
      let diagnostic = '';
      processChild.stderr.on('data', data => { diagnostic = (diagnostic + String(data)).slice(-2000); });
      processChild.stdout.setEncoding('utf8');
      processChild.stdout.on('data', data => {
        buffer += data;
        if (buffer.length > 8 * 1024 * 1024) { processChild.kill(); return fail(unavailable('The memory index response was too large.'), processChild); }
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          if (!line.trim()) continue;
          let response;
          try { response = JSON.parse(line); } catch { processChild.kill(); return fail(unavailable('The memory index returned an invalid response.'), processChild); }
          const request = pending.get(response.id);
          if (!request) continue;
          pending.delete(response.id); clearTimeout(request.timer);
          if (response.success) request.resolve(response.data);
          else request.reject(unavailable(response.error || 'The memory index could not finish.'));
        }
      });
      processChild.on('error', () => fail(unavailable('The memory index could not start. Rebuild or update Squad, then retry.'), processChild));
      processChild.stdin.on('error', () => fail(unavailable('The memory index connection closed. Retry indexing.'), processChild));
      processChild.stdout.on('error', () => fail(unavailable('The memory index response connection closed. Retry indexing.'), processChild));
      processChild.on('exit', () => fail(unavailable(`The memory index stopped. Retry indexing.${diagnostic ? ' Details are in the local runtime log.' : ''}`), processChild));
      return processChild;
    })().finally(() => { starting = undefined; });
    return starting;
  }
  async function request(input) {
    const processChild = await start();
    const id = ++sequence;
    return new Promise((resolveRequest, reject) => {
      const timer = setTimeout(() => { processChild.kill(); fail(unavailable('The memory index took too long. Retry indexing.'), processChild); }, 30_000);
      pending.set(id, { resolve: resolveRequest, reject, timer });
      processChild.stdin.write(`${JSON.stringify({ ...input, id })}\n`, error => { if (error) { processChild.kill(); fail(unavailable('The memory index connection closed. Retry indexing.'), processChild); } });
    });
  }
  return { request, close() { closed = true; const processChild = child; fail(unavailable('The memory index closed.')); processChild?.kill(); } };
}
