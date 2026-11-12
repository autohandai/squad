export const isGroupChat = conversation => conversation?.kind === 'group';

/** Additive metadata: older private channels remain channels. */
export function conversationLifecycle(source = {}) {
  return {
    kind: isGroupChat(source) ? 'group' : 'channel',
    ...(source.groupCreation?.requestHash ? { groupCreation: source.groupCreation } : {}),
    ...(source.groupConversion?.requestHash ? { groupConversion: source.groupConversion } : {}),
  };
}
