// Pairing and state rules for Telegram remote access (ADR-0088). Pure
// functions over the persisted state; the bridge (bridge.mjs) does the I/O.
//
// Exactly one Telegram account owns the bot. It pairs by sending the
// single-use code shown in Settings, either typed (`/pair CODE`) or through
// the `https://t.me/<bot>?start=CODE` deep link. Wrong codes rotate the code
// so guessing is pointless; everyone else gets a one-line refusal.

import { randomBytes } from "node:crypto";

export const STATE_VERSION = 1;
export const NOTIFY_MODES = Object.freeze(["long", "all", "off"]);
export const DEFAULT_NOTIFY_MODE = "long";
/** A finished run counts as long work from this duration on. */
export const LONG_RUN_MS = 60_000;
export const TURN_HISTORY_LIMIT = 200;
export const PAIRING_CODE_LENGTH = 8;

// Unambiguous characters only, so the code can be typed from a phone.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function newPairingCode(length = PAIRING_CODE_LENGTH) {
  return [...randomBytes(length)].map((byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

export function normalizeNotifyMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  return NOTIFY_MODES.includes(mode) ? mode : DEFAULT_NOTIFY_MODE;
}

/** The last four characters of the token, never the token. */
export function maskToken(token) {
  const value = String(token || "");
  return value ? `…${value.slice(-4)}` : "";
}

/** Telegram tokens look like `123456789:AAH…` (digits, colon, 35 chars). */
export function looksLikeBotToken(token) {
  return /^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(String(token || "").trim());
}

export function pairingDeepLink(botUsername, code) {
  const bot = String(botUsername || "").replace(/^@/, "").trim();
  return bot && code ? `https://t.me/${bot}?start=${encodeURIComponent(code)}` : "";
}

/** Coerce anything read from disk into a complete state object. */
export function normalizeState(saved) {
  const source = saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  const owner = source.owner && typeof source.owner === "object" && Number.isFinite(Number(source.owner.id))
    ? { id: Number(source.owner.id), name: String(source.owner.name || source.owner.id), chatId: Number(source.owner.chatId || source.owner.id), pairedAt: String(source.owner.pairedAt || "") }
    : null;
  return {
    version: STATE_VERSION,
    token: typeof source.token === "string" ? source.token : "",
    bot: source.bot && typeof source.bot === "object" ? { id: Number(source.bot.id) || 0, username: String(source.bot.username || ""), name: String(source.bot.name || "") } : null,
    owner,
    pairingCode: owner ? "" : typeof source.pairingCode === "string" && source.pairingCode ? source.pairingCode : newPairingCode(),
    pairingFailures: Number.isInteger(source.pairingFailures) ? source.pairingFailures : 0,
    notifyMode: normalizeNotifyMode(source.notifyMode),
    target: source.target && typeof source.target === "object" && source.target.memberId ? { memberId: String(source.target.memberId) } : null,
    updateOffset: Number.isInteger(source.updateOffset) ? source.updateOffset : 0,
    turns: Array.isArray(source.turns) ? source.turns.filter((turn) => turn && typeof turn === "object" && turn.id && turn.memberId).slice(-TURN_HISTORY_LIMIT) : [],
    notifiedProposals: Array.isArray(source.notifiedProposals) ? source.notifiedProposals.map(String).slice(-500) : [],
    decisions: source.decisions && typeof source.decisions === "object" && !Array.isArray(source.decisions) ? source.decisions : {},
  };
}

/** `/pair CODE`, `/start CODE` (deep link), with an optional `@bot` suffix. */
export function pairingCodeFrom(text) {
  const match = String(text || "").trim().match(/^\/(?:start|pair)(?:@\w+)?\s+([A-Za-z0-9_-]+)\s*$/);
  return match ? match[1].toUpperCase() : "";
}

export function displayName(user = {}) {
  if (user.username) return `@${user.username}`;
  return [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || String(user.id || "someone");
}

/**
 * Decide what an inbound message from `from` means for pairing. Returns one
 * of:
 *   { kind: "owner" }                       the paired account; handle normally
 *   { kind: "paired", state }               this message paired the account
 *   { kind: "refused", state, reply }       not the owner; a wrong code rotates
 *                                           the pairing code
 */
export function evaluateSender(state, { from, chatId, text }) {
  if (state.owner && Number(from?.id) === state.owner.id) return { kind: "owner", state };
  if (state.owner) return { kind: "refused", state, reply: "🔒 This Squad is paired with another Telegram account." };
  const attempt = pairingCodeFrom(text);
  if (attempt && state.pairingCode && attempt === state.pairingCode) {
    const next = {
      ...state,
      owner: { id: Number(from.id), name: displayName(from), chatId: Number(chatId || from.id), pairedAt: new Date().toISOString() },
      pairingCode: "",
      pairingFailures: 0,
    };
    return { kind: "paired", state: next };
  }
  if (attempt) {
    // A wrong code burns the current code: the next attempt needs the new one
    // shown in Settings, so guessing never converges.
    const next = { ...state, pairingCode: newPairingCode(), pairingFailures: state.pairingFailures + 1 };
    return { kind: "refused", state: next, reply: "🔒 That code is not valid. A new code is now shown in Settings → Remote access on the computer running Squad." };
  }
  return { kind: "refused", state, reply: "🔒 This Squad isn't paired yet. Open Settings → Remote access on the computer running Squad and use the pairing link or code shown there." };
}

/** Unpair: forget the owner, the target, and issue a fresh code. */
export function unpaired(state) {
  return { ...state, owner: null, target: null, pairingCode: newPairingCode(), pairingFailures: 0 };
}

/**
 * Whether a finished run or chat should reach the phone under `mode`.
 * Failed work always notifies; completed work follows the mode, where
 * "long" means a minute or more (an unknown duration does not count).
 */
export function shouldNotifyFinished({ status, durationMs, mode }) {
  if (String(status || "").toLowerCase() === "failed") return true;
  const notifyMode = normalizeNotifyMode(mode);
  if (notifyMode === "off") return false;
  if (notifyMode === "all") return true;
  return Number.isFinite(durationMs) && durationMs >= LONG_RUN_MS;
}

/** The browser-facing status: never the token, only its masked hint. */
export function publicStatus(state, live = {}) {
  return {
    configured: Boolean(state.token),
    tokenHint: maskToken(state.token),
    bot: state.bot ? { username: state.bot.username, name: state.bot.name } : null,
    polling: Boolean(live.polling),
    error: live.error || "",
    lastPollAt: live.lastPollAt || "",
    paired: state.owner ? { name: state.owner.name, pairedAt: state.owner.pairedAt } : null,
    pairing: state.token && state.bot && !state.owner ? { code: state.pairingCode, link: pairingDeepLink(state.bot.username, state.pairingCode) } : null,
    notifyMode: state.notifyMode,
    target: state.target,
    running: live.running || null,
  };
}

/** A turn record as the browser sees it. */
export function publicTurn(turn) {
  return {
    id: turn.id,
    memberId: turn.memberId,
    memberName: turn.memberName || "",
    prompt: turn.prompt || "",
    reply: turn.reply || "",
    status: turn.status,
    error: turn.error || "",
    source: "telegram",
    startedAt: turn.startedAt,
    updatedAt: turn.updatedAt,
    finishedAt: turn.finishedAt || null,
    durationMs: turn.durationMs ?? null,
    workspace: turn.workspace || "",
  };
}
