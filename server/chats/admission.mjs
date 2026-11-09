// Moving engine-session files must not interrupt another window's reply.
export function createConversationChanges({ isBusy }) {
  const changing = new Set();
  const conflict = message => Object.assign(new Error(message), { status: 409, reason: 'conversation', code: 'MEMBER_CONVERSATION_CHANGE' });
  return {
    has: memberId => changing.has(memberId),
    assertCanStart(memberId) {
      if (changing.has(memberId)) throw conflict('This member is switching conversations. Try again when it has finished.');
    },
    async hold(memberId) {
      if (changing.has(memberId)) throw conflict('This member is already switching conversations.');
      changing.add(memberId);
      try {
        if (await isBusy(memberId)) throw conflict('Wait for this member’s current work to finish, or stop it, before switching conversations.');
      } catch (error) { changing.delete(memberId); throw error; }
      let released = false;
      return () => { if (!released) { released = true; changing.delete(memberId); } };
    },
  };
}
