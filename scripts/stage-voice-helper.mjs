// Stage the on-device voice helper (ADR-0260) into the desktop runtime:
// build native/voice-helper (Swift, FluidAudio) when needed, copy it to
// runtime/vendor/squad-voice/squad-voice and sign it with the microphone
// entitlement under the hardened runtime. macOS only; elsewhere the voice
// routes report "available on macOS".
import { spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { releaseSigningIdentity, signMacCode } from './lib/macos-signing.mjs';

export async function stageVoiceHelper({ rootDir, runtimeDir, env = process.env }) {
  if (process.platform !== 'darwin' || env.AUTOHAND_SQUAD_SKIP_VOICE === '1') return { staged: false };
  const packageDir = join(rootDir, 'native', 'voice-helper');
  const built = join(packageDir, '.build', 'release', 'squad-voice');
  const result = spawnSync('swift', ['build', '-c', 'release', '--scratch-path', join(packageDir, '.build')], { cwd: packageDir, stdio: 'inherit' });
  if (result.status !== 0 || !existsSync(built)) throw new Error('The voice helper did not build (native/voice-helper). Set AUTOHAND_SQUAD_SKIP_VOICE=1 to stage without it.');
  const destination = join(runtimeDir, 'vendor', 'squad-voice');
  await mkdir(destination, { recursive: true });
  await copyFile(built, join(destination, 'squad-voice'));
  await chmod(join(destination, 'squad-voice'), 0o755);
  signMacCode(join(destination, 'squad-voice'), { identity: releaseSigningIdentity(env), entitlements: join(rootDir, 'native', 'voice-helper', 'entitlements.plist') });
  return { staged: true };
}
