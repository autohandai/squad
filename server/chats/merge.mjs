import { createHash } from 'node:crypto';
import { MAX_CHAT_BYTES, MAX_MESSAGES_PER_CHAT, chatDigest, countTurns } from './store.mjs';
import { conversationRestoreMessages } from '../../src/lib/shared-conversations.js';

export function mergeConversationRecord(memberId, sources, { id, title = '', digest, now = new Date().toISOString() }) {
  const messages = sources.flatMap(source => {
    const transcript = source.kind === 'thread' ? [{ ...source.record.root, status: 'complete', createdAt: source.record.createdAt }, ...source.record.messages] : source.record.messages;
    return transcript.map((message, index) => ({
      ...structuredClone(message),
      id: `merged-${createHash('sha256').update(JSON.stringify([source.kind, source.record.id, message.id, index])).digest('hex').slice(0, 32)}`,
      historySource: { kind: source.kind, id: source.record.id, title: source.record.title || source.record.root?.body || '', messageId: message.id },
    }));
  });
  if (messages.length > MAX_MESSAGES_PER_CHAT) throw Object.assign(new Error(`This selection has ${messages.length} messages; a merged conversation can hold ${MAX_MESSAGES_PER_CHAT}. Choose fewer conversations. The originals are unchanged.`), { status: 413 });
  const workspaces = [...new Set(sources.map(source => source.record.workspace).filter(Boolean))];
  const record = {
    id, memberId, title: String(title).trim().slice(0, 120) || `Merged conversation (${sources.length})`,
    startedAt: sources.map(source => source.record.startedAt || source.record.createdAt).filter(Boolean).sort()[0] || now,
    endedAt: now, createdAt: now, harness: '', workspace: workspaces.length === 1 ? workspaces[0] : '',
    messageCount: messages.length, turns: countTurns(messages), limited: sources.some(source => source.record.limited),
    sessions: {}, digest: chatDigest(messages), messages,
    merge: { digest, sources: sources.map(source => ({ kind: source.kind, id: source.record.id })), originalsRetained: true },
  };
  if (Buffer.byteLength(JSON.stringify(record)) > MAX_CHAT_BYTES) throw Object.assign(new Error('This selection exceeds the merged conversation storage limit. Choose fewer conversations; no messages or work evidence were trimmed.'), { status: 413 });
  if (!conversationRestoreMessages(messages)) throw Object.assign(new Error('A selected conversation contains work details that cannot be reopened safely. The originals are unchanged; no evidence was trimmed.'), { status: 413 });
  return record;
}
