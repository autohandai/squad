import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AutohandSDK } from '@autohandai/agent-sdk';
import { readSkillPackage } from '../server/skills/local.mjs';
import { prepareSkillContext, acknowledgeSkillContext, coalesceSkillReceipts, observeSkillAttachment, nativeSkillAttachmentEvent } from '../server/skills/runtime.mjs';

const directory = await mkdtemp(join(tmpdir(), 'squad-skill-stdio-'));
const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const cliPath = join(root, 'scripts', 'fixtures', 'skill-receipt-rpc.mjs');
await chmod(cliPath, 0o755);
const snapshot = join(directory, 'member', 'skills', 'review');
await mkdir(snapshot, { recursive: true });
await writeFile(join(snapshot, 'SKILL.md'), '---\nname: Review\ndescription: Review code changes\n---\nRetain all constraints.');
const { manifest } = await readSkillPackage(snapshot);
const entry = { id: 'review', name: 'Review', description: 'Review code changes', dir: snapshot, path: join(snapshot, 'SKILL.md'), scope: 'member', ownerId: 'alice', reference: { authority: 'local:personal:agents', packageId: 'review', revision: manifest.revision, resource: 'SKILL.md' }, manifest };
const prepared = await prepareSkillContext({ prompt: '$review', installed: [entry], actor: { memberId: 'alice' }, agentHome: join(directory, 'member'), taskId: 'squad-task', requestId: 'squad-request' });
const receipt = { version: 1, taskId: 'native-task', sessionId: 'fixture-session', requestId: 'actual-request', reference: entry.reference, contentDigest: 'a'.repeat(64), reason: 'explicit', state: 'submitted', capability: 'provider-request', policyEpoch: 1, recordedAt: Date.now(), scope: 'member:alice', resources: manifest.resources };
const fixturePath = join(directory, 'receipt.json');
await writeFile(fixturePath, JSON.stringify(receipt));
const source = await readFile(join(root, 'server.mjs'), 'utf8');
const observerSource = source.slice(source.indexOf('function observeRuntimeSkillEvent('), source.indexOf('\nfunction runtimeMemberInstructions('));
const collectorSource = source.slice(source.indexOf('async function collectSdkPrompt('), source.indexOf('\nasync function startSdkRun('));
const runs = new Map();
const dependencies = { nativeSkillAttachmentEvent, observeSkillAttachment, coalesceSkillReceipts, runs,
  CHAT_TURN_CEILING_MS: 3000, QUIET_TURN_MS: 3000, keepaliveEvent: () => false, AutohandStallError: Error, stopMessage: () => 'Fixture stopped',
  changeBatches: { observe() {}, settle: async () => ({ errors: [], applied: 0, files: [] }) }, ChangeBatches: { summary: () => '' } };
const { collectSdkPrompt, observeRuntimeSkillEvent } = new Function(...Object.keys(dependencies), `${observerSource}\n${collectorSource}\nreturn {collectSdkPrompt,observeRuntimeSkillEvent};`)(...Object.values(dependencies));

for (const mode of ['native', 'text-only', 'malformed', 'rejected']) {
  const sdk = new AutohandSDK({ cwd: directory, cliPath, timeout: 3000, envVars: { AUTOHAND_HOME: join(directory, 'sdk-home'), SQUAD_RECEIPT_FIXTURE_PATH: fixturePath, SQUAD_RECEIPT_FIXTURE_MODE: mode } });
  const events = [];
  const observed = [];
  const runtime = { skillContext: prepared, skillInstall: { installed: [entry] }, skillReceipts: acknowledgeSkillContext(prepared, { adapter: 'autohand', supplied: true }), workId: `work-${mode}` };
  runs.set(runtime.workId, { contextLayers: {} });
  let failure;
  try {
    await sdk.start();
    await collectSdkPrompt(sdk, prepared.text, 3000, event => {
      events.push(event);
      const projected = observeRuntimeSkillEvent(runtime, event);
      if (projected?.type === 'skill_attachment') observed.push(projected.receipt);
    }, undefined, 1000);
  } catch (error) { failure = error; }
  finally { await sdk.close(); }
  const confirmed = events.map(event => observeSkillAttachment(prepared, event, [entry])).filter(Boolean);
  if (mode === 'native') {
    const raw = events.find(event => event.type === 'unknown_notification' && event.method === 'autohand.skillAttachment');
    assert.deepEqual(raw.params.receipt, receipt, 'SDK 1.0.5 preserves every native receipt field over actual child stdio');
    assert.equal(nativeSkillAttachmentEvent(raw).type, 'skill_attachment');
    assert.equal(confirmed.length, 1);
    assert.equal(confirmed[0].state, 'submitted');
    assert.equal(confirmed[0].requestId, 'actual-request');
    assert.equal(observed.length, 1, 'the actual Squad collector and callback receive the installed SDK notification');
    assert.equal(runtime.skillReceipts.length, 1, 'the native request upgrades one supplied packet without duplicates');
    assert.equal(runs.get(runtime.workId).contextLayers.skillReceipts[0].requestId, 'actual-request');
  } else assert.equal(confirmed.length, 0, `${mode}: response text, malformed evidence and rejection never establish loading`);
  if (mode !== 'native') assert.equal(runtime.skillReceipts[0].state, 'supplied');
  if (mode === 'rejected') assert.match(failure?.message || '', /rejected request/);
  else assert.equal(failure, undefined);
}
assert.equal(nativeSkillAttachmentEvent({ type: 'unknown_notification', method: 'unrelated.skillAttachment', params: { receipt } }), null);
console.log('check-skill-receipt-transport: SDK 1.0.5 child-stdio receipt preserved; exact decoder, text-only, malformed and rejection cases passed; zero provider calls');
