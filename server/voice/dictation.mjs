// Autohand Voice on this computer (ADR-0260): dictation recorded and
// transcribed on-device by the bundled `squad-voice` helper (Parakeet TDT v3
// via FluidAudio on the Neural Engine). The bridge runs one recording at a
// time; the browser asks it to start and stop, so the same mic button works in
// the desktop window, Quick Chat and a browser on this Mac.
import { spawn } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const HELPER = 'squad-voice';

/** The packaged runtime ships it under vendor/; a checkout builds it in native/. */
export function helperCandidates(rootDir, env = process.env) {
  return [
    env.AUTOHAND_SQUAD_VOICE_HELPER,
    join(rootDir, 'vendor', HELPER, HELPER),
    join(rootDir, 'native', 'voice-helper', '.build', 'release', HELPER),
  ].filter(Boolean);
}

export function createVoiceService({ rootDir, env = process.env, platform = process.platform, spawnImpl = spawn, accessImpl = access } = {}) {
  let helper; // resolved path, or null when there is none
  let preparing = null; // { fraction, error, done }
  let session = null; // { child, lines, started }

  async function locate() {
    if (helper !== undefined) return helper;
    helper = null;
    if (platform !== 'darwin') return helper;
    for (const candidate of helperCandidates(rootDir, env)) {
      try { await accessImpl(candidate, constants.X_OK); helper = candidate; break; } catch { /* next */ }
    }
    return helper;
  }

  /** Run a helper command and collect its JSON lines. */
  function run(args, { onLine } = {}) {
    const child = spawnImpl(helper, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const lines = [];
    const reader = createInterface({ input: child.stdout });
    reader.on('line', line => {
      let event; try { event = JSON.parse(line); } catch { return; }
      lines.push(event); onLine?.(event);
    });
    const done = new Promise(resolve => child.once('close', code => resolve({ code, lines })));
    child.once('error', () => {});
    return { child, lines, done };
  }
  const errorOf = (lines, fallback) => {
    const failure = lines.find(line => line.event === 'error');
    return Object.assign(new Error(failure?.message || fallback), { status: failure?.code === 'microphone_denied' ? 403 : 503, code: failure?.code || 'voice_failed' });
  };

  async function status() {
    if (!await locate()) return { available: false, reason: platform === 'darwin' ? 'This Squad build has no on-device voice.' : 'On-device voice is available on macOS.' };
    const { lines } = await run(['status']).done;
    const report = lines.find(line => 'modelReady' in line) || {};
    return { available: true, engine: 'parakeet-tdt-0.6b-v3', modelReady: Boolean(report.modelReady), listening: Boolean(session),
      preparing: preparing && !preparing.done ? { fraction: preparing.fraction } : null, prepareError: preparing?.error || '' };
  }

  async function prepare() {
    if (!await locate()) throw Object.assign(new Error('This Squad build has no on-device voice.'), { status: 404 });
    if (preparing && !preparing.done) return status();
    preparing = { fraction: 0, error: '', done: false };
    const job = run(['prepare'], { onLine: line => { if (line.event === 'progress' && Number.isFinite(line.fraction)) preparing.fraction = Math.max(0, Math.min(1, line.fraction)); } });
    void job.done.then(({ code, lines }) => { preparing.done = true; if (code !== 0) preparing.error = errorOf(lines, 'The model could not be downloaded.').message; });
    return status();
  }

  async function start() {
    if (!await locate()) throw Object.assign(new Error('This Squad build has no on-device voice.'), { status: 404 });
    if (session) throw Object.assign(new Error('Dictation is already listening.'), { status: 409 });
    const job = run(['listen']);
    session = job;
    const ready = await Promise.race([
      new Promise(resolve => { const check = () => { if (job.lines.some(line => line.event === 'listening' || line.event === 'error')) resolve(); else setTimeout(check, 25); }; check(); }),
      job.done,
      new Promise(resolve => setTimeout(resolve, 30_000)),
    ]);
    void ready;
    if (!job.lines.some(line => line.event === 'listening')) {
      session = null;
      job.child.kill('SIGKILL');
      throw errorOf(job.lines, 'Dictation could not start.');
    }
    return { listening: true };
  }

  async function finish(command) {
    const job = session;
    if (!job) throw Object.assign(new Error('Dictation is not listening.'), { status: 409 });
    session = null;
    job.child.stdin.end(`${command}\n`);
    const timer = setTimeout(() => job.child.kill('SIGKILL'), 120_000);
    const { lines } = await job.done.finally(() => clearTimeout(timer));
    if (command === 'cancel') return { cancelled: true };
    const text = lines.find(line => line.event === 'text');
    if (!text) throw errorOf(lines, 'Transcription did not finish.');
    return { text: String(text.text || '') };
  }

  return { status, prepare, start, stop: () => finish('stop'), cancel: () => finish('cancel'), close: () => { session?.child.kill('SIGKILL'); session = null; } };
}
