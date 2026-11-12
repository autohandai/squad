import assert from 'node:assert/strict';
import { mkdir, rename, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { startBridge, until } from './lib/reliability-browser.mjs';

const bridge = await startBridge({ development: false });
try {
  const channel = (await bridge.api('/api/channels', 'POST', { id: 'notification-room', name: 'Release notifications' })).data;
  const initial = (await bridge.api('/api/notifications/settings')).data.settings;
  assert.equal(initial.channelDefault, 'mentions', 'existing Squads default to mentions without a new flood of post alerts');
  const defaults = await bridge.api('/api/notifications/settings', 'PUT', { channelDefault: 'all' });
  assert.equal(defaults.data.settings.channelDefault, 'all');
  const muted = await bridge.api(`/api/notifications/channels/${channel.id}`, 'PATCH', { mode: 'muted', hidden: true });
  assert.equal(muted.status, 200, 'a channel can be muted and hidden without changing its membership');
  assert.deepEqual(muted.data.settings.channelOverrides[channel.id], { mode: 'muted', hidden: true });
  const legacy = await bridge.api('/api/notifications/settings', 'PUT', { mention: false });
  assert.equal(legacy.data.settings.channelOverrides[channel.id].hidden, true, 'older global settings writes preserve per-channel choices');
  assert.equal((await bridge.api(`/api/notifications/channels/${channel.id}`, 'PATCH', { mode: 'bogus' })).status, 400);
  await bridge.restart();
  const reopened = (await bridge.api('/api/notifications/settings')).data.settings;
  assert.equal(reopened.channelDefault, 'all');
  assert.equal(reopened.channelOverrides[channel.id].mode, 'muted');
  assert.equal((await bridge.api('/api/channels')).data.channels.some(item => item.id === channel.id), true, 'mute/hide never deletes a conversation');
  const inherited = await bridge.api(`/api/notifications/channels/${channel.id}`, 'PATCH', { mode: 'default', hidden: false });
  assert.deepEqual(inherited.data.settings.channelOverrides[channel.id], { hidden: false }, 'a channel can return to the Settings default and be shown again');
  await bridge.api('/api/members/eva/channel-access', 'PUT', { agent: { id: 'eva', name: 'Eva', role: 'Reviewer', status: 'online' }, profile: '', profilePatch: {} });
  await bridge.api(`/api/channels/${channel.id}/members`, 'POST', { add: ['eva'] });
  await bridge.api('/api/notifications/settings', 'PUT', { mention: true });
  async function post(id, body) {
    const at = new Date().toISOString();
    assert.equal((await bridge.api('/api/channels/sync', 'PUT', { messages: { [channel.id]: [{ id, role: 'agent', agentId: 'eva', authorName: 'Eva', status: 'complete', body, createdAt: at, updatedAt: at }] } })).success, true);
  }
  await bridge.api('/api/notifications/focus', 'POST', { route: '/conversations/new?member=eva' });
  await post('post-all', 'Release review is ready.');
  await until(async () => (await bridge.api('/api/notifications')).data.items.some(item => item.messageId === 'post-all'), 'all posts mode notifies from a real saved member message');
  assert.equal((await bridge.api('/api/notifications')).data.items.find(item => item.messageId === 'post-all').suppressed, false, 'a direct chat does not expose a different channel conversation');
  assert.equal((await bridge.api('/api/notifications')).data.items.find(item => item.messageId === 'post-all').title, 'Eva in #Release notifications', 'a canonical member name is available even without a browser status cache');
  await post('post-all', 'Release review is ready.');
  const past = '2020-01-01T00:00:00.000Z';
  await bridge.api('/api/channels/sync', 'PUT', { messages: { [channel.id]: [{ id: 'historical-post', role: 'agent', agentId: 'eva', body: 'An imported old reply.', status: 'complete', createdAt: past, updatedAt: past }] } });
  await post('scan-barrier', 'A new saved publication.');
  await until(async () => (await bridge.api('/api/notifications')).data.items.some(item => item.messageId === 'scan-barrier'), 'a later publication reaches the same observer');
  const replayed = (await bridge.api('/api/notifications')).data.items;
  assert.equal(replayed.filter(item => item.messageId === 'post-all').length, 1, 'receipt replay does not duplicate alerts');
  assert(!replayed.some(item => item.messageId === 'historical-post'), 'historical cache imports stay quiet');
  await bridge.api('/api/notifications/focus', 'POST', { route: '/channels/' + channel.id });
  await post('focused-post', 'Already visible in the channel.');
  await until(async () => (await bridge.api('/api/notifications')).data.items.some(item => item.messageId === 'focused-post'), 'focused post recorded as read');
  const focused = (await bridge.api('/api/notifications')).data.items.find(item => item.messageId === 'focused-post');
  assert.equal(focused.suppressed, true); assert.equal(focused.read, true); assert.equal(focused.native, null);
  await bridge.api('/api/notifications/focus', 'POST', { route: '/squad' });
  await bridge.api(`/api/notifications/channels/${channel.id}`, 'PATCH', { mode: 'muted' });
  await post('post-muted', 'This channel is muted.');
  await bridge.api(`/api/notifications/channels/${channel.id}`, 'PATCH', { mode: 'mentions' });
  await post('post-teammate', '@Eva please review this.');
  await post('post-human', '@reliability please review this.');
  await until(async () => (await bridge.api('/api/notifications')).data.items.some(item => item.messageId === 'post-human'), 'the verified person receives their own mention');
  const feed = (await bridge.api('/api/notifications')).data.items;
  assert(!feed.some(item => ['post-muted', 'post-teammate'].includes(item.messageId)), 'mute and mentions-only suppress unwanted posts');
  const beforeFailure = (await bridge.api('/api/notifications/settings')).data.settings;
  const file = join(bridge.dataRoot, 'notifications.json');
  await rename(file, file + '.previous'); await mkdir(file);
  try {
    const failed = await bridge.api('/api/notifications/settings', 'PUT', { channelDefault: 'muted' });
    assert.equal(failed.status, 500, 'a failed disk save cannot return a success receipt');
    assert.deepEqual((await bridge.api('/api/notifications/settings')).data.settings, beforeFailure, 'failed settings remain uncommitted');
  } finally { await rmdir(file); await rename(file + '.previous', file); }
  assert.equal((await bridge.api('/api/notifications/settings', 'PUT', { channelDefault: 'all' })).success, true, 'a failed write does not poison later saves');
  await bridge.restart();
  assert.equal((await bridge.api('/api/notifications/settings')).data.settings.channelDefault, 'all');
  assert.equal((await bridge.api('/api/notifications')).data.items.filter(item => item.messageId === 'post-all').length, 1, 'restart does not replay old notifications');
  console.log('PASS: owned notification defaults/overrides, actual saved posts/mentions, focus, replay/history suppression, persistence/failure recovery, hide/show and inherited defaults.');
} finally { await bridge.close(); }
