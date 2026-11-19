// Host contract 0.4 (ADR-0252): member birds and pictures, group chats and
// actionable cards, against the real owner-bound bridge with an offline
// fixture engine.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMobileFixture } from './lib/mobile-fixture.mjs';
import { until } from './lib/reliability-browser.mjs';
import { sealPacket, openPacket } from '../server/mobile/protocol.mjs';
import { permissionCard, scheduleCard, teamCard } from '../server/mobile/cards.mjs';
import { phoneAvatar } from '../server/mobile/adapter.mjs';
import { historyRecord, runFromRecord } from '../server/runs/history.mjs';

// Pure shapes first.
assert.equal(phoneAvatar('/avatars/birds/256/kea.webp'), '/avatars/birds/kea.webp', 'a bird travels as its one stored URL');
assert.equal(phoneAvatar('/avatars/birds/notabird.webp'), '', 'an unknown bird is not sent');
const pictureA = phoneAvatar('data:image/png;base64,AAAA'), pictureB = phoneAvatar('data:image/png;base64,AAAB');
assert.match(pictureA, /^picture:[a-f0-9]{24}$/, 'an uploaded picture travels as a key, never its bytes');
assert.notEqual(pictureA, pictureB, 'a changed picture is a new key');
const pending = permissionCard({ requestId: 'r1', tool: 'write_file', description: 'Write src/index.html' }, null, 'Eva');
assert.deepEqual(pending.actions.map(action => action.id), ['allow_once', 'allow_session', 'deny_once']);
assert.equal(pending.title, 'Eva asks to use write_file');
assert.deepEqual(permissionCard({ requestId: 'r1' }, { state: 'done', result: 'Allowed once', title: 'Eva asks to use write_file' }, 'Eva').actions, [], 'a decided card offers no action');
assert.equal(scheduleCard({ id: 'p', title: 'Morning', status: 'proposed', expired: true }).state, 'expired');
const receipt = { id: 'team-action-x', type: 'team', status: 'proposed', proposal: { name: 'Crew', objective: 'Ship', leadKey: 'a', members: [{ key: 'a', name: 'Ada', role: 'Frontend Developer' }, { key: 'b', name: 'QA Engineer', role: 'QA Engineer' }] } };
const proposed = teamCard('run-1', receipt, null, 'Eva');
assert.equal(proposed.actions[0].label, 'Create team · 2 members', 'the Mac button’s words');
assert.deepEqual(proposed.items, [{ title: 'Ada', detail: 'Frontend Developer · leads' }, { title: 'QA Engineer', detail: '' }], 'a member named for its role says the role once');
// A proposed team survives a bridge restart in run history.
const restored = runFromRecord(historyRecord({ id: 'run-1', status: 'completed', kind: 'chat', channelActions: [receipt, { type: 'profile', status: 'applied' }] }));
assert.deepEqual(restored.channelActions, [receipt], 'only the proposed team is kept');

const { bridge, member } = await startMobileFixture();
try {
  const noah = { ...member, id: 'fixture-noah', name: 'Noah', role: 'Engineer' };
  assert.equal((await bridge.api(`/api/members/${noah.id}/channel-access`, 'PUT', { agent: noah, profile: '', profilePatch: {} })).success, true);
  const configured = await bridge.api('/api/mobile/config', 'PUT', { enabled: true, local: true, relay: false, tunnel: false, endpoint: '', port: 0 });
  assert.equal(configured.success, true, configured.error);
  // Keep the random port across the restart at the end.
  const port = Number(new URL(configured.data.endpoint).port);
  assert.equal((await bridge.api('/api/mobile/config', 'PUT', { enabled: true, local: true, relay: false, tunnel: false, endpoint: '', port })).success, true);
  const created = await bridge.api('/api/mobile/pair', 'POST', {});
  assert.equal(created.success, true, created.error);
  const offer = JSON.parse(Buffer.from(new URL(created.data.link).searchParams.get('data'), 'base64url').toString());
  const endpoint = `http://127.0.0.1:${new URL(offer.endpoint).port}/v1/mobile`;
  const deviceID = randomUUID(), key = randomBytes(32), pairKey = Buffer.from(offer.secret, 'base64');
  async function request(command, parameters = {}, { pair = false, id = randomUUID() } = {}) {
    const secret = pair ? pairKey : key;
    const packet = sealPacket({ issuedAt: Date.now() / 1000, command, parameters }, secret,
      { kind: pair ? 'pair' : 'device', computerID: offer.computerID, peerID: pair ? offer.pairingID : deviceID, requestID: id }, 'request');
    const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(packet) });
    assert.equal(response.ok, true);
    return openPacket(await response.json(), secret, 'response');
  }
  await request('pair.claim', { deviceID, deviceName: 'Contract 0.4 iPhone', deviceKey: key.toString('base64') }, { pair: true });
  const code = (await bridge.api('/api/mobile/status')).data.pending.code;
  assert.equal((await bridge.api('/api/mobile/approve', 'POST', { pairingID: offer.pairingID, code })).success, true);
  let snapshot = (await request('snapshot')).data;
  for (const capability of ['avatars', 'groups', 'cards']) assert.ok(snapshot.capabilities.includes(capability), `advertises ${capability}`);
  assert.deepEqual(snapshot.groups, []);

  // Birds and pictures.
  await bridge.api('/api/status/snapshot', 'POST', { members: [{ id: member.id, name: 'Eva', avatar: '/avatars/birds/kea.webp' }] });
  assert.equal((await request('snapshot')).data.members.find(row => row.id === member.id).avatar, '/avatars/birds/kea.webp');
  const bird = await request('avatar', { memberID: member.id });
  assert.equal(bird.ok, true, bird.error);
  assert.equal(bird.data.contentType, 'image/webp'); assert.equal(bird.data.key, 'kea');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const onDisk = await readFile(join(root, 'dist/avatars/birds/256/kea.webp')).catch(() => readFile(join(root, 'public/avatars/birds/256/kea.webp')));
  assert.ok(Buffer.from(bird.data.data, 'base64').equals(onDisk), 'the same 256 px render the menu bar reads');
  assert.equal((await request('avatar', { bird: 'kiwi' })).data.key, 'kiwi');
  assert.equal((await request('avatar', { bird: 'notabird' })).ok, false);
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await bridge.api('/api/status/snapshot', 'POST', { members: [{ id: member.id, name: 'Eva', avatar: png }] });
  const pictureKey = (await request('snapshot')).data.members.find(row => row.id === member.id).avatar;
  assert.equal(pictureKey, phoneAvatar(png), 'an uploaded picture is a key in the snapshot');
  const picture = (await request('avatar', { memberID: member.id })).data;
  assert.equal(picture.contentType, 'image/png'); assert.equal(picture.key, pictureKey);
  assert.equal(`data:image/png;base64,${picture.data}`, png);
  assert.equal((await request('avatar', { memberID: noah.id })).ok, false, 'no picture, no bytes');

  // Group chats.
  const launch = await bridge.api('/api/group-chats', 'POST', { name: 'Launch crew', memberIds: [member.id, noah.id], requestId: 'launch' });
  assert.equal(launch.success, true, launch.error);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal((await bridge.api('/api/group-chats', 'POST', { name: 'Ops', memberIds: [member.id, noah.id], requestId: 'ops' })).success, true);
  await bridge.api('/api/channels', 'POST', { id: `channel-${randomUUID()}`, name: 'not-a-group', visibility: 'private', memberIds: [member.id] }).catch(() => {});
  snapshot = (await request('snapshot')).data;
  assert.deepEqual(snapshot.groups.map(group => group.name), ['Ops', 'Launch crew'], 'only genuine groups, newest first');
  assert.deepEqual(snapshot.groups[1].memberIDs.sort(), [member.id, noah.id].sort());
  const sendID = randomUUID(), post = { groupID: launch.data.id, text: 'Morning, crew' };
  const sent = await request('group.message', post, { id: sendID });
  assert.equal(sent.ok, true, sent.error);
  assert.deepEqual(sent.data.deliveries.map(row => row.memberID).sort(), [member.id, noah.id].sort(), 'a group answers like the desktop: everyone by default');
  assert.ok(sent.data.deliveries.every(row => ['queued', 'running'].includes(row.status)), JSON.stringify(sent.data.deliveries));
  assert.deepEqual((await request('group.message', post, { id: sendID })).data, sent.data, 'a retried post returns its receipt');
  assert.equal((await request('group.message', { ...post, text: 'Different' }, { id: sendID })).ok, false);
  snapshot = (await request('snapshot')).data;
  assert.equal(snapshot.groups[0].name, 'Launch crew', 'activity moves a group to the top');
  assert.ok(['You', 'Eva', 'Noah'].includes(snapshot.groups[0].preview.author), 'the newest line, the post or a reply that already landed');
  await until(async () => (await request('group.conversation', { groupID: launch.data.id })).data.messages.filter(row => row.role === 'member').length === 2, 'both members’ replies land in the group');
  const conversation = (await request('group.conversation', { groupID: launch.data.id })).data.messages;
  assert.equal(conversation[0].role, 'person'); assert.equal(conversation[0].body, 'Morning, crew');
  assert.ok(conversation.slice(1).every(row => row.body === 'Message received on this computer.' && row.status === 'complete'));
  const mentioned = await request('group.message', { groupID: launch.data.id, text: '@Noah just you' });
  assert.deepEqual(mentioned.data.deliveries.map(row => row.memberID), [noah.id], 'a mention picks who answers');
  assert.equal((await request('group.conversation', { groupID: 'group-missing' })).ok, false);
  const memberLast = (await request('snapshot')).data.members.find(row => row.id === member.id).lastMessageAt;
  assert.equal(memberLast, undefined, 'group replies are not direct turns');

  // Cards: a proposed team.
  const turnFor = async text => {
    assert.equal((await request('message', { memberID: member.id, text })).ok, true);
    let turn;
    await until(async () => { turn = (await request('conversation', { memberID: member.id })).data.turns.find(row => row.prompt.includes(text) && row.status === 'complete'); return Boolean(turn); }, `the reply to ${text}`);
    return turn;
  };
  let turn = await turnFor('Please PROPOSE_TEAM');
  assert.ok(Date.parse((await request('snapshot')).data.members.find(row => row.id === member.id).lastMessageAt), 'members carry their newest direct turn');
  let card = turn.cards?.find(item => item.kind === 'team');
  assert.ok(card, `team card under the reply: ${JSON.stringify(turn)}`);
  assert.equal(card.state, 'pending'); assert.equal(card.title, 'Eva proposes the Launch crew team');
  assert.deepEqual(card.items.map(item => item.title), ['Ada', 'Lin']);
  assert.deepEqual(card.actions.map(action => action.id), ['create', 'dismiss']);
  assert.equal(turn.reply.includes('proposes the'), false, 'the receipt line leaves the body, as on the Mac');
  const actID = randomUUID();
  const requested = await request('card.act', { cardID: card.id, action: 'create' }, { id: actID });
  assert.equal(requested.ok, true, requested.error);
  assert.equal(requested.data.card.state, 'requested');
  assert.deepEqual(requested.data.card.actions, []);
  let decisions = (await bridge.api('/api/mobile/team-decisions')).data.decisions;
  assert.equal(decisions.length, 1); assert.equal(decisions[0].action, 'create'); assert.equal(decisions[0].proposal.name, 'Launch crew');
  assert.equal((await bridge.api('/api/mobile/team-decisions/claim', 'POST', { receiptId: decisions[0].receiptId })).data.claimed, true);
  assert.equal((await bridge.api('/api/mobile/team-decisions/claim', 'POST', { receiptId: decisions[0].receiptId })).data.claimed, false, 'a second window cannot create the team again');
  assert.equal((await bridge.api('/api/mobile/team-decisions', 'POST', { receiptId: decisions[0].receiptId, state: 'done' })).success, true);
  assert.deepEqual((await bridge.api('/api/mobile/team-decisions')).data.decisions, []);
  card = (await request('conversation', { memberID: member.id })).data.turns.find(row => row.id === turn.id).cards[0];
  assert.equal(card.state, 'done');
  assert.deepEqual((await request('card.act', { cardID: card.id, action: 'create' }, { id: actID })).data, requested.data, 'a retried decision returns its receipt');
  assert.equal((await request('card.act', { cardID: card.id, action: 'dismiss' })).data.card.state, 'done', 'a decided card never changes again');
  assert.equal((await bridge.api('/api/mobile/team-decisions')).data.decisions.length, 0, 'and asks the window for nothing');
  // Not now: recorded at once, the window only marks its copy.
  turn = await turnFor('Again PROPOSE_TEAM');
  card = turn.cards.find(item => item.kind === 'team');
  assert.equal((await request('card.act', { cardID: card.id, action: 'dismiss' })).data.card.state, 'declined');
  decisions = (await bridge.api('/api/mobile/team-decisions')).data.decisions;
  assert.deepEqual(decisions.map(row => row.action), ['dismiss']);
  await bridge.api('/api/mobile/team-decisions', 'POST', { receiptId: decisions[0].receiptId, state: 'declined' });
  // Decided on the Mac first: the phone shows it decided.
  turn = await turnFor('Third PROPOSE_TEAM');
  card = turn.cards.find(item => item.kind === 'team');
  await bridge.api('/api/mobile/team-decisions', 'POST', { receiptId: card.id.split(':').at(-1), state: 'done' });
  assert.equal((await request('conversation', { memberID: member.id })).data.turns.find(row => row.id === turn.id).cards[0].state, 'done');

  // Cards: a proposed automation.
  turn = await turnFor('Please PROPOSE_SCHEDULE');
  card = turn.cards?.find(item => item.kind === 'schedule');
  assert.ok(card, `schedule card under the reply: ${JSON.stringify(turn)}`);
  assert.equal(card.state, 'pending'); assert.equal(card.title, 'Proposed automation · Morning check');
  assert.deepEqual(card.actions.map(action => action.id), ['confirm', 'decline']);
  // The Inbox (contract 0.6, ADR-0263) lists the same waiting card, answerable in place.
  snapshot = (await request('snapshot')).data;
  for (const capability of ['inbox', 'feedback']) assert.ok(snapshot.capabilities.includes(capability), `advertises ${capability}`);
  let box = await request('inbox');
  assert.equal(box.ok, true, box.error);
  const waiting = box.data.decisions.find(row => row.card.id === card.id);
  assert.ok(waiting, `the Inbox lists the proposed automation: ${JSON.stringify(box.data)}`);
  assert.equal(waiting.memberID, member.id); assert.equal(waiting.card.state, 'pending');
  assert.ok(Array.isArray(box.data.stopped), 'stopped replies are listed');
  assert.equal((await request('inbox', { extra: true })).ok, false, 'the Inbox takes no parameters');
  assert.equal((await request('card.act', { cardID: card.id, action: 'decline' })).data.card.state, 'declined');
  box = await request('inbox');
  assert.ok(!box.data.decisions.some(row => row.card.id === card.id), 'a decided automation leaves the Inbox');
  // Feedback from the phone is validated on the computer before anything is sent.
  assert.equal((await request('feedback.send', { kind: 'bug', summary: 'short' })).ok, false, 'a summary under 8 characters is refused');
  assert.equal((await request('feedback.send', { kind: 'praise', summary: 'Something long enough' })).ok, false, 'only bug or feedback');
  assert.equal((await request('card.act', { cardID: card.id, action: 'confirm' })).data.card.state, 'declined', 'no second effect');
  assert.equal((await bridge.api(`/api/routines/proposals?memberId=${member.id}`)).data.proposals[0].status, 'declined', 'the Mac sees the same decision');

  // Cards: a permission that is no longer waiting.
  const late = await request('card.act', { cardID: 'permission:not-waiting', action: 'allow_once' });
  assert.equal(late.ok, true, late.error); assert.equal(late.data.card.state, 'expired');
  assert.equal((await request('card.act', { cardID: 'nothing:here', action: 'create' })).ok, false);

  // A restart keeps the proposed team under its reply and its decision.
  const doneTurn = (await request('conversation', { memberID: member.id })).data.turns.find(row => row.prompt.includes('Please PROPOSE_TEAM'));
  // Run history is written 400 ms after the last change (server/runs/history.mjs).
  await new Promise(resolve => setTimeout(resolve, 1000));
  await bridge.restart();
  const after = (await request('conversation', { memberID: member.id })).data.turns.find(row => row.id === doneTurn.id);
  assert.equal(after.cards?.[0]?.state, 'done', 'the card and its decision survive a bridge restart');
  console.log('PASS phone host contract 0.4: birds and uploaded pictures travel as keys and arrive as the same bytes; only genuine group chats, newest activity first, with previews; group posts dispatch like the desktop (everyone, mentions win), mirror replies and deduplicate; team, automation and permission cards attach to their turn, decide once through the desktop routes, wait honestly for the Squad window, and survive a restart.');
} finally { await bridge.close(); }
