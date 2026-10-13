// A member shapes its own profile in conversation (ADR-0126).
//
//   SQUAD_ACTION: {"type":"profile","op":"set","name":"Alex","role":"GTM Leader",
//                  "instructions":"…","personality":"…","skills":["…"]}
//
// The channel-action manager routes the line here with the turn's identity,
// like ADR-0110's `schedule` and ADR-0124's `task`. This module validates it
// with the browser's own rules (src/lib/member-shaping.js), refuses a change
// to any member but the one executing the turn, records the change on the
// bridge's registered member copy (agentChannelAccess, so a Telegram or
// channel turn sees the new identity at once) and returns the receipt the
// manager appends to the reply. The browser applies the receipt's `patch`
// through updateAgent, the profile editor's path, and that write replaces
// this copy with the full member. No routes of its own and no store of its
// own: setting the same values twice is the same state, so a replayed turn
// needs no ledger.

import { PROFILE_ACTION_TYPE, namesSelf, personalityFileContent, profileChangeLine, validateProfileAction } from "../../src/lib/member-shaping.js";
import { uniqueName } from "../../src/lib/teams.js";

export const name = "member-shaping";

let bridgeContext = null;

function log(ctx, severity, message, attributes = {}) {
  ctx?.logEvent?.(severity, message, { "event.domain": "autohand.squad", ...attributes });
}

/** The registered member copy with the patch applied; personality becomes PERSONALITY.md. */
export function patchedMemberCopy(agent, patch) {
  const next = { ...agent };
  for (const field of ["name", "role", "instructions", "skills"]) if (patch[field] !== undefined) next[field] = structuredClone(patch[field]);
  if (patch.personality !== undefined) {
    const files = (Array.isArray(agent?.profileFiles) ? agent.profileFiles : []).filter((file) => file?.section !== "persona");
    files.push({ section: "persona", fileName: "PERSONALITY.md", originalFileName: "PERSONALITY.md", content: personalityFileContent(patch.personality, next.role), source: "manual" });
    next.profileFiles = files;
  }
  return next;
}

async function otherMemberNames(ctx, actorId) {
  try {
    const state = await ctx?.readChannelsState?.();
    return Object.entries(state?.agentChannelAccess || {}).filter(([id, access]) => id !== actorId && !access?.removed).map(([, access]) => access?.agent?.name).filter(Boolean);
  } catch {
    return [];
  }
}

export async function profileAction({ id, context, raw, signal, declined }) {
  const ctx = bridgeContext;
  const actions = ctx?.agentChannelActions;
  const receipt = { id, type: PROFILE_ACTION_TYPE, actorId: context.actorId, status: "failed", message: "" };
  try {
    if (signal?.aborted || declined) throw new Error("this turn was stopped before the profile change could run");
    if (!context.identityValid) throw new Error("the action identity does not match the executing member");
    const { type: _type, ...rest } = raw;
    const { patch, member } = validateProfileAction(rest);
    const access = await actions?.memberAccess?.(context.actorId);
    const before = access?.agent || { id: context.actorId };
    if (access?.removed) throw new Error("this member is no longer available");
    if (!namesSelf(member, { id: context.actorId, name: before.name })) throw new Error(`a member can only change its own profile, not ${member}'s`);
    // A chosen name another member already has is numbered, as the team
    // builder numbers a collision (ADR-0118).
    if (patch.name) patch.name = uniqueName(patch.name, await otherMemberNames(ctx, context.actorId));
    if (access?.agent) await actions.setAccess(context.actorId, { agent: patchedMemberCopy(access.agent, patch), profile: access.profile });
    receipt.status = "applied";
    receipt.patch = patch;
    receipt.message = profileChangeLine(patch, before);
    log(ctx, ctx?.SEVERITY?.INFO, `member-shaping: ${context.actorId} set ${Object.keys(patch).join(", ")}`, { "event.name": "member.profile.shaped", "autohand.member.id": context.actorId, "autohand.member.role": patch.role || "" });
  } catch (error) {
    receipt.status = "failed";
    receipt.message = `Profile not changed: ${error?.message || error}.`;
    log(ctx, ctx?.SEVERITY?.WARN, `member-shaping: profile action rejected: ${error?.message || error}`, { "event.name": "member.profile.rejected", "autohand.member.id": context.actorId });
  }
  return receipt;
}

export async function init(ctx) {
  bridgeContext = ctx;
  try {
    ctx.agentChannelActions?.registerHandler?.(PROFILE_ACTION_TYPE, profileAction);
  } catch (error) {
    log(ctx, ctx.SEVERITY?.WARN, `member-shaping: profile actions unavailable: ${error?.message || error}`, { "event.name": "member.profile.unavailable" });
  }
}

export async function handle() {
  return false;
}
