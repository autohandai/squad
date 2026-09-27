// Whether a member will pick up work right now, and what it says when it
// will not. Pure: no React, no DOM, so scripts/check-member-availability.mjs
// can import it from Node.
//
// Today there is exactly one reason a member declines: it is on a break the
// person put it on. Offline is not a break, because offline is not a
// decision. Keeping the reason in the return value rather than a boolean
// means a second reason later does not change any call site.
//
// See docs/adrs/ADR-0027-member-breaks.md.

/** The member status that means "on a break". */
export const BREAK_STATUS = "paused";

export function isOnBreak(member) {
  return Boolean(member) && member.status === BREAK_STATUS;
}

/**
 * `{ canWork, reason, notice, reply }` for a member.
 *   notice  one short sentence about the member, for the person
 *   reply   the same news in the member's own voice, for the stream
 * Both are always strings, so a caller never has to guard.
 */
export function memberAvailability(member, copy = {}) {
  if (!isOnBreak(member)) return { canWork: true, reason: "", notice: "", reply: "" };
  return {
    canWork: false,
    reason: "break",
    notice: declineNotice(member, copy),
    reply: copy.memberOnBreakReply || "I'm on a break, so I'm not picking up new work. End my break and I'll get straight to it.",
  };
}

/** "Noah is on a break", or "" when the member is available. */
export function declineNotice(member, copy = {}) {
  if (!isOnBreak(member)) return "";
  const name = String(member?.name || "").trim() || "This member";
  return (copy.memberOnBreak || "{name} is on a break").replace("{name}", name);
}

/** The patch that puts a member on a break. Stopping its work is the caller's job. */
export function beginBreak(member, now = new Date()) {
  return { status: BREAK_STATUS, breakStartedAt: now.toISOString() };
}

/** The patch that ends a break. Safe on a member that was never on one. */
export function endBreak() {
  return { status: "active", breakStartedAt: "" };
}
