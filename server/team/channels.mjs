import { createHash, randomUUID } from "node:crypto";
import { redactSecrets } from "../control-plane/control-plane.mjs";

const problem = (message, status = 400) => Object.assign(new Error(message), { status });

/** Channel operations for an authenticated member; publication never dispatches work. */
export function createTeamChannels({ read, mutate }) {
  function channelFor(state, memberId, channelId) {
    const member = state.agentChannelAccess?.[memberId];
    if (!member?.agent || member.removed) throw problem("This member is no longer available.", 403);
    const channel = state.channels.find(item => item.id === channelId && item.memberIds.includes(memberId));
    if (!channel) throw problem("That channel is missing or you are not a member of it.", 403);
    return { channel, member: member.agent };
  }

  return {
    async list(memberId) {
      const state = await read();
      if (!state.agentChannelAccess?.[memberId]?.agent || state.agentChannelAccess[memberId].removed) throw problem("This member is no longer available.", 403);
      return state.channels.filter(channel => channel.memberIds.includes(memberId)).map(channel => ({
        id: channel.id, name: channel.name, visibility: channel.visibility,
        purpose: channel.purpose || "", memberIds: channel.memberIds,
        projects: channel.projects || [], replyMode: channel.replyMode || "thread",
      }));
    },

    async read(memberId, { channel_id: channelId, thread_id: threadId, limit = 50 }) {
      const state = await read();
      channelFor(state, memberId, channelId);
      if (threadId && !state.threads.some(thread => thread.id === threadId && thread.channelId === channelId)) throw problem("That thread does not belong to this channel.", 404);
      const messages = state.messages.filter(message => message.channelId === channelId && (!threadId || message.threadId === threadId))
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).slice(-limit)
        .map(message => ({ id: message.id, threadId: message.threadId || "", parentMessageId: message.parentMessageId || "", authorId: message.agentId || "", authorName: message.authorName || "", role: message.role, status: message.status, text: redactSecrets(message.body).slice(0, 8000), createdAt: message.createdAt }));
      return { channelId, messages };
    },

    async post(memberId, { channel_id: channelId, thread_id: threadId, text, request_id: requestId }) {
      const body = String(text || "").trim();
      if (!body || body.length > 8000) throw problem("A channel message must contain 1–8000 characters.");
      const key = requestId ? createHash("sha256").update(JSON.stringify([memberId, requestId])).digest("hex") : randomUUID();
      const id = `team-channel-${key}`;
      return mutate(state => {
        const { channel, member } = channelFor(state, memberId, channelId);
        const previous = state.messages.find(message => message.id === id);
        if (previous) {
          if (previous.channelId !== channelId || previous.body !== body || (threadId && previous.threadId !== threadId)) throw problem("This request_id was already used for a different channel message.", 409);
          return { status: "published", duplicate: true, messageId: id, channelId, threadId: previous.threadId };
        }
        let thread = threadId ? state.threads.find(item => item.id === threadId && item.channelId === channelId) : null;
        if (threadId && !thread) throw problem("That thread does not belong to this channel.", 404);
        const timestamp = new Date().toISOString();
        const parentMessageId = thread?.parentMessageId || "";
        if (!thread) {
          thread = { id: `${id}-thread`, channelId, parentMessageId: id, title: body.slice(0, 160), creatorId: memberId, memberIds: [], replyCount: 0, createdAt: timestamp, updatedAt: timestamp };
          state.threads.push(thread);
        } else {
          thread.replyCount = Number(thread.replyCount || 0) + 1;
          thread.updatedAt = timestamp;
        }
        state.messages.push({ id, channelId, threadId: thread.id, parentMessageId, role: "agent", agentId: memberId, authorName: member.name, body, status: "complete", createdAt: timestamp, updatedAt: timestamp });
        channel.updatedAt = timestamp;
        return { status: "published", duplicate: false, messageId: id, channelId, threadId: thread.id, note: "The message is saved in the channel. No teammate was dispatched by this publication." };
      });
    },
  };
}
