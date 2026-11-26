// A full window cache never blocks Squad (ADR-0286, issue #88). WebKit gives
// the app about 5 MB of localStorage whatever the disk has free; the owner
// saw "Your device's local storage is full" with 9 GB free, because boot wrote
// the whole direct-message history there and a QuotaExceededError stopped it.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { activateOwnedStorage, createOwnedStorage, HISTORY_CACHE_KEYS, onStoragePressure, physicalStorageKey } from '../src/lib/owned-storage.js';

const LIMIT = 5 * 1024 * 1024;
const values = new Map();
const size = map => [...map].reduce((sum, [name, text]) => sum + 2 * (name.length + text.length), 0);
const backing = {
  get length() { return values.size; },
  key: index => [...values.keys()][index] ?? null,
  getItem: key => values.get(key) ?? null,
  removeItem: key => { values.delete(key); },
  setItem(key, value) {
    const next = new Map(values); next.set(key, value);
    if (size(next) > LIMIT) throw Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError', code: 22 });
    values.set(key, value);
  },
};
activateOwnedStorage({ storageKey: 'fixture-owner', generation: 'g1', state: 'ready', actor: { id: 'a' }, owner: { id: 'o' } });
const storage = createOwnedStorage(() => backing);
const events = []; onStoragePressure(event => events.push(event));
const big = label => JSON.stringify({ leia: Array.from({ length: 1400 }, (_, i) => ({ id: `${label}-${i}`, body: 'history '.repeat(240) })) });

// 1. The owner's case: last session's history already fills the cache, and
//    boot writes the roster, a newer history and the channel list.
values.set(physicalStorageKey('autohandSquad.v1.messages'), big('old'));
values.set(physicalStorageKey('autohandSquad.v1.channelMessages'), 'c'.repeat(700_000));
assert.ok(size(values) > LIMIT * 0.9, 'the fixture starts nearly full');
const roster = JSON.stringify(Array.from({ length: 13 }, (_, i) => ({ id: `m${i}`, name: `Member ${i}`, instructions: 'brief '.repeat(3000) })));
const newer = big('new');
assert.doesNotThrow(() => storage.setItem('autohandSquad.v1.agents', roster), 'the roster write never throws');
assert.equal(storage.getItem('autohandSquad.v1.agents'), roster);
assert.equal(values.get(physicalStorageKey('autohandSquad.v1.agents')), roster, 'the roster is kept on disk: history gave way first');
assert.equal(storage.getItem('autohandSquad.v1.channelMessages'), 'c'.repeat(700_000), 'evicted history is still readable this session');
assert.doesNotThrow(() => storage.setItem('autohandSquad.v1.messages', newer), 'a history larger than the whole cache never throws');
assert.equal(storage.getItem('autohandSquad.v1.messages'), newer, 'the window still reads the newest history');
assert.notEqual(values.get(physicalStorageKey('autohandSquad.v1.messages')), big('old'), 'no stale history is left to load next time');
assert.doesNotThrow(() => storage.setItem('autohandSquad.v1.channels', '[{"id":"general"}]'));
assert.equal(values.get(physicalStorageKey('autohandSquad.v1.channels')), '[{"id":"general"}]', 'small records still reach disk');
assert.ok(events.some(event => event.kept === 'memory') && events.some(event => event.kept === 'disk'), 'pressure is reported, not hidden');
assert.ok(storage.key(0) !== null && [...Array(storage.length).keys()].map(i => storage.key(i)).includes('autohandSquad.v1.messages'), 'memory-held keys are still listed');

// 2. A later write that fits goes back to disk and leaves memory.
storage.setItem('autohandSquad.v1.messages', '{}');
assert.equal(values.get(physicalStorageKey('autohandSquad.v1.messages')), '{}');
storage.removeItem('autohandSquad.v1.messages');
assert.equal(storage.getItem('autohandSquad.v1.messages'), null);

// 3. Other storage failures still surface.
const blocked = createOwnedStorage(() => ({ ...backing, setItem() { throw Object.assign(new Error('blocked'), { name: 'SecurityError' }); } }));
assert.throws(() => blocked.setItem('autohandSquad.v1.agents', '[]'), /blocked/);

// 4. The boot screen no longer blames the disk.
const boot = await readFile(new URL('../src/components/account/OwnershipBootstrap.jsx', import.meta.url), 'utf8');
assert.ok(!boot.includes('device’s local storage is full'), 'no "your device is full" for Squad’s own cache');
assert.ok(HISTORY_CACHE_KEYS.includes('autohandSquad.v1.messages') && !HISTORY_CACHE_KEYS.includes('autohandSquad.v1.agents'), 'members are never the first to give way');
console.log('Owned storage quota checks passed: a full 5 MB window cache moves history off disk first, keeps the roster and small records on disk, keeps everything readable this session, reports pressure, never throws on quota, and the boot screen no longer says the device is full.');
