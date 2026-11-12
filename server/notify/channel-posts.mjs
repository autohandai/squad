import { mentionsPerson } from '../../src/lib/channel-mentions.js';

const complete = message => message.status === 'complete';

/** Observe saved replies/publications, never old history or intermediate tokens. */
export async function createChannelPostObserver({ read, profile, onPost, now = Date.now }) {
  const since = now();
  const initial = await read();
  const seen = new Set((initial.messages || []).filter(complete).map(message => message.id));
  let closed = false;
  let dirty = false;
  let draining = null;

  async function scan() {
    const state = await read();
    if (closed) return;
    const channels = new Map(state.channels.map(channel => [channel.id, channel]));
    for (const message of state.messages) {
      if (closed) return;
      if (!complete(message) || seen.has(message.id)) continue;
      seen.add(message.id);
      const member = state.agentChannelAccess?.[message.agentId];
      const channel = channels.get(message.channelId);
      // Old cache reconciliation may discover history for the first time.
      const timestamp = Date.parse(message.updatedAt || message.createdAt);
      if (!Number.isFinite(timestamp) || timestamp < since || message.role !== 'agent' || !message.body?.trim() || !member?.agent || member.removed || !channel?.memberIds.includes(message.agentId)) continue;
      await onPost({ name: 'channel.posted', at: message.updatedAt || message.createdAt, channelId: channel.id,
        memberId: message.agentId, authorName: member.agent.name, messageId: message.id, preview: message.body.slice(0, 240),
        mentionsYou: mentionsPerson(message.body, profile()) || mentionsPerson(message.body, { name: 'you' }) });
    }
  }

  function changed() {
    if (closed) return Promise.resolve();
    dirty = true;
    if (!draining) draining = (async () => {
      while (dirty && !closed) { dirty = false; await scan(); }
    })().finally(() => { draining = null; });
    return draining;
  }

  return { changed, dispose() { closed = true; } };
}
