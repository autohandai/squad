// Read-only projection: persisted thread metadata must remain discoverable
// when this device lacks its transcript. Never manufacture member replies.
export function channelTranscript(messages = [], threads = [], channelId = "") {
  const records = Array.isArray(messages) ? messages : [];
  const ids = new Set(records.map(message => message?.id));
  const result = [...records];
  for (const thread of Array.isArray(threads) ? threads : []) {
    if (!thread?.id || (channelId && thread.channelId && thread.channelId !== channelId)) continue;
    const rootId = thread.parentMessageId || `${thread.id}-root`;
    if (ids.has(rootId) || records.some(message => message?.threadId === thread.id && message?.role === "user" && !message?.parentMessageId)) continue;
    const replies = records.filter(message => message?.threadId === thread.id && message?.role === "agent");
    const savedCount = Number(thread.replyCount);
    const count = Number.isFinite(savedCount) ? Math.max(0, Math.floor(savedCount)) : 0;
    const unavailable = Math.max(0, count - replies.length);
    const note = unavailable
      ? `${count} ${count === 1 ? "reply was" : "replies were"} recorded in this thread; ${unavailable === 1 ? "1 is" : unavailable === count ? "their messages are" : `${unavailable} are`} unavailable on this device.`
      : "Only the thread record is available on this device.";
    result.push({
      id: rootId, channelId: thread.channelId || channelId, threadId: thread.id,
      role: "system", authorName: "Squad", status: "record", archivedThread: true,
      body: `${thread.title || "Saved thread"}\n\n${replies.length && !unavailable ? "The original prompt is unavailable on this device." : note}`,
      createdAt: thread.createdAt || thread.updatedAt || "", updatedAt: thread.updatedAt || thread.createdAt || "",
    });
    ids.add(rootId);
  }
  return result;
}
