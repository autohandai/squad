// Webhook triggers for member routines (ADR-0254). Pure helpers: the secret
// a webhook URL carries, its constant-time check, the per-routine call
// limiter and the payload text a run receives. The route
// (server/routes/routines.route.mjs) owns HTTP and dispatch.
//
// A webhook routine's URL is POST /api/routines/hooks/<routineId>/<token>
// on the local bridge. The token is 32 random bytes (base64url), minted by
// the bridge and never accepted from a client. It is kept in routines.json so
// the owner can copy the URL again; the comparison hashes both sides so its
// time does not depend on where they differ.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const WEBHOOK_PATH_PREFIX = "/api/routines/hooks/";
export const WEBHOOK_MAX_BODY_BYTES = 64 * 1024;
export const WEBHOOK_PAYLOAD_CHARS = 8000;
export const WEBHOOK_WINDOW_MS = 60_000;
export const WEBHOOK_MAX_CALLS_PER_WINDOW = 10;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function mintWebhookToken() {
  return randomBytes(32).toString("base64url");
}

function digest(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest();
}

// A routine without a token still costs one comparison, against a value no
// caller can present, so a missing routine and a wrong token answer alike.
const NEVER = digest(`never-${randomBytes(16).toString("hex")}`);

/** True when `presented` is the routine's current webhook token. Constant-time. */
export function webhookTokenMatches(expected, presented) {
  const shaped = TOKEN_PATTERN.test(String(presented || ""));
  const left = expected ? digest(expected) : NEVER;
  const right = digest(shaped ? presented : "");
  return timingSafeEqual(left, right) && Boolean(expected) && shaped;
}

/** The webhook record a routine stores: token plus bookkeeping, or null. */
export function normalizeWebhook(input) {
  if (!input || typeof input !== "object") return null;
  const token = TOKEN_PATTERN.test(String(input.token || "")) ? String(input.token) : "";
  const iso = (value) => {
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
  };
  return {
    token,
    createdAt: iso(input.createdAt),
    rotatedAt: iso(input.rotatedAt),
    revokedAt: token ? null : iso(input.revokedAt),
    lastCalledAt: iso(input.lastCalledAt),
    calls: Number.isInteger(input.calls) && input.calls >= 0 ? input.calls : 0,
  };
}

/** A fresh webhook record, or a rotated one keeping the call history. */
export function issueWebhook(previous = null, now = new Date().toISOString()) {
  const current = normalizeWebhook(previous);
  return {
    token: mintWebhookToken(),
    createdAt: current?.createdAt || now,
    rotatedAt: current?.token || current?.revokedAt ? now : null,
    revokedAt: null,
    lastCalledAt: current?.lastCalledAt || null,
    calls: current?.calls || 0,
  };
}

export function revokeWebhook(previous, now = new Date().toISOString()) {
  const current = normalizeWebhook(previous) || { createdAt: now, lastCalledAt: null, calls: 0 };
  return { ...current, token: "", rotatedAt: current.rotatedAt || null, revokedAt: now };
}

/** The path for a routine's current token, or "" when revoked. */
export function webhookPath(routine) {
  const token = routine?.webhook?.token;
  return token ? `${WEBHOOK_PATH_PREFIX}${encodeURIComponent(routine.id)}/${token}` : "";
}

/**
 * What the app and the MCP tools see about a routine's webhook. The URL is
 * built from the bridge's own origin; external services reach it only
 * through a tunnel the person already runs (ADR-0254).
 */
export function publicWebhook(routine, origin = "") {
  if (routine?.trigger !== "webhook") return null;
  const record = normalizeWebhook(routine.webhook) || { token: "", createdAt: null, rotatedAt: null, revokedAt: null, lastCalledAt: null, calls: 0 };
  const path = webhookPath(routine);
  return {
    active: Boolean(record.token),
    path,
    url: path && origin ? `${String(origin).replace(/\/$/, "")}${path}` : "",
    createdAt: record.createdAt,
    rotatedAt: record.rotatedAt,
    revokedAt: record.revokedAt,
    lastCalledAt: record.lastCalledAt,
    calls: record.calls,
    maxBodyBytes: WEBHOOK_MAX_BODY_BYTES,
    maxCallsPerMinute: WEBHOOK_MAX_CALLS_PER_WINDOW,
  };
}

/** Split `/api/routines/hooks/<id>/<token>` into its parts, or null. */
export function parseWebhookPath(pathname) {
  if (!String(pathname || "").startsWith(WEBHOOK_PATH_PREFIX)) return null;
  const rest = pathname.slice(WEBHOOK_PATH_PREFIX.length).split("/");
  if (rest.length !== 2 || !rest[0] || !rest[1]) return null;
  let id;
  try {
    id = decodeURIComponent(rest[0]);
  } catch {
    return null;
  }
  return { id, token: rest[1] };
}

/**
 * A sliding-window counter per routine: at most `max` accepted calls in
 * `windowMs`. In memory on purpose; a bridge restart forgets the window.
 */
export function createWebhookLimiter({ windowMs = WEBHOOK_WINDOW_MS, max = WEBHOOK_MAX_CALLS_PER_WINDOW } = {}) {
  const calls = new Map();
  return {
    /** { allowed, retryAfterSeconds } for a call at `now` (ms). Records it when allowed. */
    take(key, now = Date.now()) {
      const recent = (calls.get(key) || []).filter((at) => now - at < windowMs);
      if (recent.length >= max) {
        calls.set(key, recent);
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000)) };
      }
      recent.push(now);
      calls.set(key, recent);
      return { allowed: true, retryAfterSeconds: 0 };
    },
    forget(key) {
      calls.delete(key);
    },
  };
}

/** The JSON body as bounded text for the run's prompt and history. */
export function webhookPayloadText(body, limit = WEBHOOK_PAYLOAD_CHARS) {
  if (body === undefined || body === null || (typeof body === "object" && !Array.isArray(body) && !Object.keys(body).length)) return "";
  let text;
  try {
    text = JSON.stringify(body, null, 2);
  } catch {
    text = String(body);
  }
  return text.length > limit ? `${text.slice(0, limit)}\n… (truncated at ${limit} characters)` : text;
}
