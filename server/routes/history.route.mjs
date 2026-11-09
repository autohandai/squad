// One management view over saved chats and independent reply threads.
// Merge is a new transcript with provenance, never a provider-session splice.
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { ChatStore, MAX_CHATS_PER_MEMBER, validMemberId, validChatId } from '../chats/store.mjs';
import { mergeConversationRecord } from '../chats/merge.mjs';
import { withMemberThreads, removeMemberThread } from './member-threads.route.mjs';
import { readPersistentJson, writePersistentJson } from '../persistent-json.mjs';

export const name = 'history';
let chats, file, state, writing = Promise.resolve();
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
function serial(operation) { const next = writing.catch(() => {}).then(operation); writing = next; return next; }
export async function init(ctx) {
  chats = new ChatStore({ squadStateDir: ctx.squadStateDir });
  file = join(ctx.squadStateDir, 'conversation-history.json');
  state = await readPersistentJson(file, { version: 1, deleted: [] });
  if (state.version !== 1 || !Array.isArray(state.deleted)) throw new Error('Saved conversation history is damaged; the original file has been kept.');
  for (const ref of state.deleted.filter(ref => ref.kind === 'chat')) await chats.remove(ref.memberId, ref.id);
}

export async function handle(req, res, url, ctx) {
  const match = url.pathname.match(/^\/api\/members\/([^/]+)\/history(?:\/(merge|chat|thread)(?:\/([^/]+))?)?$/);
  if (!match) return false;
  try {
    const memberId = decodeURIComponent(match[1]);
    if (!validMemberId(memberId)) throw fail('Invalid member identity.');
    const action = match[2];
    let data, status = 200;
    if (!action && req.method === 'GET') {
      const [saved, threads] = await Promise.all([chats.list(memberId), withMemberThreads(memberId, threads => threads.map(thread => ({ kind: 'thread', id: thread.id, title: thread.root.body, createdAt: thread.createdAt, endedAt: thread.updatedAt, messageCount: thread.messages.length + 1, working: thread.messages.some(message => message.status === 'loading') })))]);
      data = { items: [...saved.map(chat => ({ ...chat, kind: 'chat', working: false })), ...threads].filter(item => !state.deleted.some(ref => ref.memberId === memberId && ref.kind === item.kind && ref.id === item.id)).sort((a, b) => String(b.endedAt || b.createdAt).localeCompare(String(a.endedAt || a.createdAt))) };
    } else if (action === 'merge' && req.method === 'POST') {
      const body = await ctx.readBody(req);
      const selection = body.selection;
      if (!Array.isArray(selection) || selection.length < 2 || selection.length > 20 || selection.some(ref => !['chat', 'thread'].includes(ref?.kind) || !validChatId(ref.id)) || new Set(selection.map(ref => `${ref.kind}:${ref.id}`)).size !== selection.length) throw fail('Select 2–20 different conversations from this member.');
      if (typeof body.requestId !== 'string' || !body.requestId.trim() || body.requestId.length > 128) throw fail('A stable merge request id is required.');
      data = await serial(() => withMemberThreads(memberId, async threads => {
        const id = `chat-merged-${createHash('sha256').update(JSON.stringify([memberId, body.requestId])).digest('hex').slice(0, 32)}`;
        const digest = createHash('sha256').update(JSON.stringify([selection, body.title || ''])).digest('hex');
        if (state.deleted.some(ref => ref.memberId === memberId && ref.id === id && ref.kind === 'chat')) throw fail('This merged conversation was deleted. Use a new explicit merge request.', 410);
        const previous = await chats.get(memberId, id);
        if (previous) {
          if (previous.merge?.digest !== digest) throw fail('This request id was used for a different merge.', 409);
          return { id, duplicate: true, originalsRetained: true };
        }
        if ((await chats.list(memberId)).length >= MAX_CHATS_PER_MEMBER) throw fail('This member has 100 saved conversations. Delete one before merging; nothing was removed automatically.', 409);
        const sources = [];
        for (const ref of selection) {
          const record = ref.kind === 'chat' ? await chats.get(memberId, ref.id) : threads.find(thread => thread.id === ref.id);
          if (!record || state.deleted.some(deleted => deleted.memberId === memberId && deleted.kind === ref.kind && deleted.id === ref.id)) throw fail('A selected conversation is no longer here. Refresh history and select again.', 404);
          if (ref.kind === 'thread' && record.messages.some(message => message.status === 'loading')) throw fail('Stop the selected working thread before merging it. Other work will keep running.', 409);
          sources.push({ kind: ref.kind, record });
        }
        const record = mergeConversationRecord(memberId, sources, { id, title: body.title || '', digest });
        const summary = await chats.save(record, { prune: false });
        return { ...summary, originalsRetained: true };
      }));
      status = 201;
    } else if (['chat', 'thread'].includes(action) && match[3] && req.method === 'DELETE') {
      const id = decodeURIComponent(match[3]);
      if (!validChatId(id)) throw fail('Invalid conversation identity.');
      data = await serial(async () => {
        if (action === 'thread') return { removed: await removeMemberThread(memberId, id) };
        if (!state.deleted.some(ref => ref.memberId === memberId && ref.kind === action && ref.id === id)) {
          const next = { ...state, deleted: [...state.deleted, { memberId, kind: action, id }] };
          await writePersistentJson(file, next);
          state = next;
        }
        return { removed: await chats.remove(memberId, id) };
      });
    } else throw fail('This history operation is unavailable.', 405);
    ctx.json(res, status, { success: true, data });
  } catch (error) { ctx.json(res, error.status || 500, { success: false, error: error.message }); }
  return true;
}
