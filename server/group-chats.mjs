import { createHash, randomUUID } from 'node:crypto';
import { isGroupChat } from '../src/lib/group-chats.js';
import { channelError } from './channels-store.mjs';

const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function text(value, label, limit) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw channelError(`${label} must contain 1–${limit} characters.`);
  return value.trim();
}
function fields(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) throw channelError('Unsupported group chat fields.');
}
const requestKey = value => value === undefined ? randomUUID() : text(value, 'requestId', 256);
const missingGroup = actorId => actorId
  ? channelError('That group chat is missing or you are not a member of it.', 403)
  : channelError('Group chat not found.', 404);
function actor(state, actorId, group) {
  if (!actorId) return;
  if (!state.agentChannelAccess?.[actorId]?.agent || state.agentChannelAccess[actorId].removed || !group.memberIds.includes(actorId)) throw channelError('That group chat is missing or you are not a member of it.', 403);
}
function groupFor(state, id, actorId) {
  const group = state.channels.find(item => item.id === id);
  if (!group) throw missingGroup(actorId);
  actor(state, actorId, group);
  if (!isGroupChat(group)) throw channelError('This conversation is a channel, not a group chat.', 409);
  return group;
}

/** The existing serialized channel store owns groups and their history. */
export function createGroupChats({ store, normalizeChannel }) {
  return {
    async list({ actorId } = {}) {
      const state = await store.read();
      if (actorId && (!state.agentChannelAccess?.[actorId]?.agent || state.agentChannelAccess[actorId].removed)) throw channelError('This member is no longer available.', 403);
      return state.channels.filter(group => isGroupChat(group) && (!actorId || group.memberIds.includes(actorId)));
    },
    async get(id, { actorId } = {}) { return groupFor(await store.read(), id, actorId); },
    async create(input, { actorId } = {}) {
      fields(input, ['name', 'memberIds', 'requestId']);
      const name = text(input.name, 'Group name', 80);
      if (!Array.isArray(input.memberIds) || input.memberIds.length > 20 || input.memberIds.some(id => typeof id !== 'string' || !id || id.length > 80)) throw channelError('Choose two to twenty existing members.');
      const memberIds = [...new Set(input.memberIds)];
      if (memberIds.length < 2) throw channelError('Choose at least two different members.');
      const requestId = requestKey(input.requestId);
      const id = `group-${fingerprint(requestId).slice(0, 32)}`;
      const requestHash = fingerprint({ name, memberIds: [...memberIds].sort() });
      return store.mutate(state => {
        const previous = state.channels.find(item => item.id === id);
        if (previous) {
          actor(state, actorId, previous);
          if (previous.groupCreation?.requestHash !== requestHash) throw channelError('This group creation request conflicts with an earlier request.', 409);
          return previous;
        }
        if (state.deletedChannelIds.includes(id)) throw channelError('This group chat was deleted. Use a new requestId.', 409);
        actor(state, actorId, { memberIds });
        for (const memberId of memberIds) if (!state.agentChannelAccess?.[memberId]?.agent || state.agentChannelAccess[memberId].removed) throw channelError(`Member ${memberId} is not available.`, 404);
        if (state.channels.some(item => item.name.toLowerCase() === name.toLowerCase())) throw channelError(`A conversation named ${name} already exists.`, 409);
        const group = normalizeChannel({ id, name, kind: 'group', visibility: 'private', memberIds,
          creatorId: actorId || 'person', groupCreation: { requestHash }, createdAt: new Date().toISOString() });
        state.channels.push(group);
        return group;
      });
    },
    async convert(id, input, { actorId } = {}) {
      fields(input, ['name', 'visibility', 'requestId']);
      if (!['public', 'private'].includes(input.visibility)) throw channelError('Choose public or private channel visibility explicitly.');
      const name = input.name === undefined ? undefined : text(input.name, 'Channel name', 80);
      const requestId = requestKey(input.requestId);
      const requestHash = fingerprint({ name, visibility: input.visibility, requestId });
      return store.mutate(state => {
        const group = state.channels.find(item => item.id === id);
        if (!group) throw missingGroup(actorId);
        actor(state, actorId, group);
        if (!isGroupChat(group)) {
          if (group.groupConversion?.requestHash === requestHash) return group;
          throw channelError('This group has already been converted to a channel.', 409);
        }
        const nextName = name || group.name;
        if (state.channels.some(item => item.id !== id && item.name.toLowerCase() === nextName.toLowerCase())) throw channelError(`A conversation named ${nextName} already exists.`, 409);
        const channel = normalizeChannel({ ...group, kind: 'channel', name: nextName, visibility: input.visibility,
          groupConversion: { requestHash, convertedAt: new Date().toISOString() }, updatedAt: new Date().toISOString() });
        state.channels = state.channels.map(item => item.id === id ? channel : item);
        return channel;
      });
    },
    async remove(id, { actorId } = {}) {
      return store.mutate(state => {
        groupFor(state, id, actorId);
        state.channels = state.channels.filter(group => group.id !== id);
        state.threads = state.threads.filter(thread => thread.channelId !== id);
        state.messages = state.messages.filter(message => message.channelId !== id);
        state.deletedChannelIds = [...new Set([...state.deletedChannelIds, id])];
        return { id, deleted: true };
      });
    },
  };
}
