// Serving side of remote members: tokens this bridge mints for other
// machines and the bearer check those machines must pass.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const REMOTE_TRANSPORT_HEADER = "x-autohand-transport";
export const REMOTE_TRANSPORT_VALUE = "remote";
const TOKEN_PREFIX = "ahs_";

/** A new bearer token: 32 random bytes, url-safe, prefixed so it is recognisable in logs. */
export function mintToken() {
  return `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function hashToken(token) {
  return createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

/** The bearer token from `Authorization: Bearer <token>`, or "". */
export function bearerTokenFromRequest(req) {
  const header = String(req?.headers?.authorization || "").trim();
  const match = header.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : "";
}

/** True when the request says it comes from another bridge's proxy. */
export function isRemoteTransport(req) {
  return String(req?.headers?.[REMOTE_TRANSPORT_HEADER] || "").trim().toLowerCase() === REMOTE_TRANSPORT_VALUE;
}

function safeEqualHex(a, b) {
  const left = Buffer.from(String(a), "hex");
  const right = Buffer.from(String(b), "hex");
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Does the request carry a bearer token that matches one of `tokens`?
 * `tokens` may hold raw token strings, `{ token }` records, or `{ hash }`
 * records (the `_served` shape from remotes.json). Comparison is on the
 * SHA-256 hash and constant-time. A request without a bearer token is never
 * allowed by this check; the caller decides whether same-origin applies.
 */
export function bearerTokenAllowed(req, tokens = []) {
  const presented = bearerTokenFromRequest(req);
  if (!presented) return false;
  const presentedHash = hashToken(presented);
  for (const item of tokens || []) {
    const hash = typeof item === "string" ? hashToken(item) : item?.hash || (item?.token ? hashToken(item.token) : "");
    if (hash && safeEqualHex(hash, presentedHash)) return true;
  }
  return false;
}

/** Which served token record (by hash) the request matches, or null. */
export function matchServedToken(req, served = []) {
  const presented = bearerTokenFromRequest(req);
  if (!presented) return null;
  const presentedHash = hashToken(presented);
  return served.find((item) => item?.hash && safeEqualHex(item.hash, presentedHash)) || null;
}
