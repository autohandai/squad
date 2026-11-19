#!/usr/bin/env node
// The composer's mic with on-device dictation (ADR-0260), rendered against a
// real isolated bridge whose voice helper is a stand-in script (no microphone,
// no model). Proves Dictate → Stop dictation puts the words in the composer.
// Regression: on 20 Nov 2026 the button's cleanup cancelled the recording
// when it switched to "listening", and Stop answered "Dictation is not
// listening." This check fails on that build.
import assert from 'node:assert/strict';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startBridge, startBrowser, until } from './lib/reliability-browser.mjs';
import { seedOwnedBrowserFixture } from './lib/owned-bridge-fixture.mjs';

const dir = await mkdtemp(join(tmpdir(), 'squad-voice-stand-in-'));
const helper = join(dir, 'squad-voice');
await writeFile(helper, `#!/usr/bin/env node
process.env.VOICE_LOG = ${JSON.stringify(join(dir, 'log.txt'))};
const emit = value => process.stdout.write(JSON.stringify(value) + '\\n');
const command = process.argv[2];
require('fs').appendFileSync(process.env.VOICE_LOG || '/dev/null', 'run ' + command + '\\n');
if (command === 'status') { emit({ modelReady: true, engine: 'autohand-voice' }); process.exit(0); }
if (command === 'listen') {
  emit({ event: 'listening' });
  let buffer = '';
  process.stdin.on('data', chunk => {
    buffer += chunk; require('fs').appendFileSync(process.env.VOICE_LOG || '/dev/null', 'stdin ' + chunk);
    if (buffer.includes('cancel')) { emit({ event: 'cancelled' }); process.exit(0); }
    if (buffer.includes('stop')) { emit({ event: 'text', text: 'Summarise the open pull requests.' }); process.exit(0); }
  });
} else { emit({ event: 'error', code: 'usage', message: 'unsupported' }); process.exit(1); }
`);
await chmod(helper, 0o755);

const bridge = await startBridge({ prepare: async () => ({ AUTOHAND_SQUAD_VOICE_HELPER: helper }) });
let browser;
try {
  const member = { id: 'dictation-eva', name: 'Eva', role: 'Reviewer', status: 'online', workspace: process.cwd(), projects: [{ path: process.cwd() }], harness: { id: 'autohand' } };
  browser = await startBrowser();
  await seedOwnedBrowserFixture(bridge, browser, { members: [member] });
  await browser.navigate(`${bridge.origin}/conversations/new?member=${member.id}`);
  const mic = label => `document.querySelector('button[aria-label="${label}"]')`;
  await until(() => browser.evaluate(`!!${mic('Dictate')}`), 'the mic is offered', 30000);
  // The page asks the bridge whether on-device voice exists; until it has the
  // answer the mic would use the browser's speech service instead.
  const log = () => import('node:fs/promises').then(fs => fs.readFile(join(dir, 'log.txt'), 'utf8')).catch(() => '');
  await until(async () => ((await log()).match(/run status/g) || []).length >= 1, 'the page knows on-device voice is here');
  await browser.evaluate(`${mic('Dictate')}.click()`);
  await until(() => browser.evaluate(`!!${mic('Stop dictation')}`), 'the mic is listening');
  // Give the button time to settle in "listening" before stopping.
  await new Promise(resolve => setTimeout(resolve, 800));
  await browser.evaluate(`${mic('Stop dictation')}.click()`);
  await until(() => browser.evaluate("[...document.querySelectorAll('textarea')].some(area => area.value.includes('Summarise the open pull requests.'))"), 'the words land in the composer', 20000);
  assert.equal(await browser.evaluate("document.body.innerText.includes('Dictation is not listening')"), false, 'no "not listening" error');
  console.log('PASS dictation: Dictate, then Stop dictation, puts the transcribed words in the composer.');
} finally {
  await browser?.close();
  await bridge.close();
}
