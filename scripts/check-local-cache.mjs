import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseLocalJson, writeChannelMessagesCache, compactChannelMessagesCache, writeLocalJson } from '../src/lib/local-cache.js';

const values = new Map([['other-history', 'x'.repeat(1_100_000)]]);
const storage = {
  getItem: key => values.get(key) ?? null,
  setItem(key, value) {
    const next = new Map(values); next.set(key, value);
    const bytes = [...next].reduce((sum, [name, text]) => sum + 2 * (name.length + text.length), 0);
    if (bytes > 5 * 1024 * 1024) throw Object.assign(new Error('quota exceeded'), { name: 'QuotaExceededError' });
    values.set(key, value);
  },
};
const history = { general: Array.from({ length: 100 }, (_, i) => ({ id: `message-${i}`, body: 'history '.repeat(2048) + ' APAC 🦜 日本語', status: i === 99 ? 'loading' : 'complete' })) };
assert.throws(() => storage.setItem('channel-history', JSON.stringify(history)), /quota/);
writeChannelMessagesCache(storage, 'channel-history', history);
const saved = storage.getItem('channel-history');
assert.ok(saved.startsWith('@squad-cache:lz16:v1:'));
assert.deepEqual(parseLocalJson(saved), history, 'Reload retains all messages, Unicode and pending updates');
storage.setItem('member-draft', JSON.stringify({ role: 'GTM APAC Leader', instructions: 'Keep the authored brief.' }));
assert.equal(JSON.parse(storage.getItem('member-draft')).role, 'GTM APAC Leader', 'History compression leaves space for a new draft');
writeChannelMessagesCache(storage, 'small-history', { general: [{ body: 'ordinary JSON' }] });
assert.equal(storage.getItem('small-history'), JSON.stringify({ general: [{ body: 'ordinary JSON' }] }));
assert.deepEqual(parseLocalJson('{"legacy":true}'), { legacy: true });
const before = storage.getItem('channel-history');
assert.throws(() => writeChannelMessagesCache({ setItem() { throw Object.assign(new Error('storage blocked'), { name: 'SecurityError' }); } }, 'channel-history', history), /storage blocked/);
assert.equal(storage.getItem('channel-history'), before);
// An unchanged legacy cache can still fill storage before a new draft is added.
values.clear();
values.set('channel-history', JSON.stringify(history));
values.set('other-history', 'x'.repeat(850_000));
const draft = JSON.stringify({ role: 'GTM APAC Leader', description: 'authored '.repeat(25_000) });
assert.throws(() => storage.setItem('member-draft', draft), /quota/);
assert.equal(compactChannelMessagesCache(storage, 'channel-history'), true);
storage.setItem('member-draft', draft);
assert.equal(storage.getItem('member-draft'), draft);
assert.deepEqual(parseLocalJson(storage.getItem('channel-history')), history);
assert.equal(compactChannelMessagesCache(storage, 'channel-history'), false, 'Already compacted history is not recompressed');
// The roster may be the first changed value while the old channel cache is
// unchanged. Exercise App's persistence entry point rather than a parallel one.
const source = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const persistSource = source.slice(source.indexOf('function persistLocal('), source.indexOf('function activeAgentForReads('));
const persist = Function('window', 'STORAGE_KEYS', 'writeLocalJson', persistSource + '; return persistLocal;')({ localStorage: storage }, { channelMessages: 'channel-history' }, writeLocalJson);
values.clear(); values.set('channel-history', JSON.stringify(history)); values.set('other-history', 'x'.repeat(850_000));
const roster = [{ id: 'alex', name: 'Alex', role: 'GTM APAC Leader', instructions: 'authored '.repeat(25_000) }];
assert.throws(() => storage.setItem('agents', JSON.stringify(roster)), /quota/);
persist('agents', roster);
assert.deepEqual(parseLocalJson(storage.getItem('agents')), roster, 'Confirmed members survive a reload even when history initially fills local storage');
assert.deepEqual(parseLocalJson(storage.getItem('channel-history')), history);
console.log('Local cache checks passed: quota fallback, complete Unicode/pending history, legacy JSON, preserved failures and member-draft headroom.');
