#!/usr/bin/env node
// On-device dictation (ADR-0260) through the bridge's voice service, with a
// stand-in helper that speaks the same JSON-line protocol as squad-voice. The
// real helper is exercised by `squad-voice transcribe` in the ADR's evidence.
import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVoiceService } from '../server/voice/dictation.mjs';

const dir = await mkdtemp(join(tmpdir(), 'squad-dictation-'));
const fake = join(dir, 'squad-voice');
await writeFile(fake, `#!${process.execPath}
const mode = process.env.FAKE_VOICE || 'ok';
const say = o => process.stdout.write(JSON.stringify(o) + '\\n');
const [cmd] = process.argv.slice(2);
if (cmd === 'status') { say({ modelReady: mode !== 'nomodel', modelDirectory: '/tmp/models' }); process.exit(0); }
if (cmd === 'prepare') { say({ event: 'progress', fraction: 0.5 }); say({ event: 'ready' }); process.exit(0); }
if (cmd === 'listen') {
  if (mode === 'denied') { say({ event: 'error', code: 'microphone_denied', message: 'Microphone access is off for Autohand Squad.' }); process.exit(1); }
  say({ event: 'listening' });
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { if (d.includes('stop')) { say({ event: 'text', text: 'remind me every day at nine' }); process.exit(0); } if (d.includes('cancel')) { say({ event: 'cancelled' }); process.exit(0); } });
}
`);
await chmod(fake, 0o755);
try {
  const service = createVoiceService({ rootDir: dir, env: { AUTOHAND_SQUAD_VOICE_HELPER: fake }, platform: 'darwin' });
  const status = await service.status();
  assert.deepEqual([status.available, status.modelReady, status.engine], [true, true, 'parakeet-tdt-0.6b-v3']);
  assert.deepEqual(await service.start(), { listening: true });
  await assert.rejects(service.start(), error => error.status === 409, 'one recording at a time');
  assert.deepEqual(await service.stop(), { text: 'remind me every day at nine' });
  await assert.rejects(service.stop(), error => error.status === 409, 'stop without a recording is refused');
  await service.start();
  assert.deepEqual(await service.cancel(), { cancelled: true });

  const denied = createVoiceService({ rootDir: dir, env: { AUTOHAND_SQUAD_VOICE_HELPER: fake, FAKE_VOICE: 'denied' }, platform: 'darwin' });
  process.env.FAKE_VOICE = 'denied';
  await assert.rejects(denied.start(), error => error.status === 403 && /Microphone access is off/.test(error.message));
  delete process.env.FAKE_VOICE;

  const linux = createVoiceService({ rootDir: dir, env: { AUTOHAND_SQUAD_VOICE_HELPER: fake }, platform: 'linux' });
  assert.equal((await linux.status()).available, false);
  const missing = createVoiceService({ rootDir: join(dir, 'nowhere'), env: {}, platform: 'darwin' });
  assert.equal((await missing.status()).available, false, 'no helper, no on-device voice (the mic falls back)');

  process.env.FAKE_VOICE = 'nomodel';
  const fresh = createVoiceService({ rootDir: dir, env: { AUTOHAND_SQUAD_VOICE_HELPER: fake }, platform: 'darwin' });
  assert.equal((await fresh.status()).modelReady, false);
  const preparing = await fresh.prepare();
  assert.equal(preparing.available, true);
  delete process.env.FAKE_VOICE;
  console.log('check-dictation: ok (status, start/stop with text, one recording at a time, cancel, microphone denied is 403, unavailable off macOS or without the helper, model download)');
} finally { await rm(dir, { recursive: true, force: true }); }
