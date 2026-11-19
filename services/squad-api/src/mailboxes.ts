// Agent email (Squad ADR-0262). A Squad member can have its own address,
// <name>@code.autohandai.com. Cloudflare Email Routing hands every message for
// that domain to this Worker's `email` handler; the message is kept here until
// the owner's Squad collects it and gives it to the member. Only accounts on an
// allowed domain (autohand.ai for now) may register addresses: the check is on
// the verified sign-in email, here, not in the app.
import { z } from "zod";
import PostalMime from "postal-mime";
import type { Env } from "./env.js";
import type { Principal } from "./auth.js";
import { ApiError, body, ok, requireValue } from "./http.js";

export const MAIL_DOMAIN_DEFAULT = "code.autohandai.com";
export const MAIL_ACCOUNT_DOMAINS_DEFAULT = "autohand.ai";
const MAX_MAILBOXES = 50;
const MAX_RAW_BYTES = 5 * 1024 * 1024;
const MAX_TEXT = 32_000;
const DAILY_LIMIT = 200;
// Addresses people expect to mean the domain, not an agent.
const RESERVED = new Set(["abuse", "admin", "administrator", "hostmaster", "info", "mailer-daemon", "noreply", "no-reply", "postmaster", "root", "security", "support", "webmaster", "hello", "squad", "autohand", "team", "billing", "help"]);
const LOCAL_PART = /^[a-z0-9](?:[a-z0-9.-]{0,28}[a-z0-9])?$/;

type Bindings = Pick<Env, "DB"> & { MAIL_DOMAIN?: string; MAIL_ACCOUNT_DOMAINS?: string; MAIL_RESERVED?: string };
const mailDomain = (env: Bindings) => (env.MAIL_DOMAIN || MAIL_DOMAIN_DEFAULT).toLowerCase();
const accountDomains = (env: Bindings) => (env.MAIL_ACCOUNT_DOMAINS || MAIL_ACCOUNT_DOMAINS_DEFAULT).split(",").map(item => item.trim().toLowerCase()).filter(Boolean);

/** Whether this signed-in account may give its members addresses. */
export function mailAllowed(env: Bindings, user: Pick<Principal, "email">): boolean {
  const domain = String(user.email || "").toLowerCase().split("@")[1] || "";
  return accountDomains(env).includes(domain);
}

/** "Thiago Álvarez" → "thiago.alvarez". */
export function localPartFrom(name: string): string {
  const base = String(name || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "").replace(/\.{2,}/g, ".").slice(0, 30).replace(/\.+$/g, "");
  return base.length >= 2 ? base : "";
}

/** Addresses other services on the domain already route (their own Email
 * Routing rules win over Squad's catch-all), so Squad never hands them out. */
const ownedElsewhere = (env?: Bindings) => new Set((env?.MAIL_RESERVED || "").split(",").map(item => item.trim().toLowerCase()).filter(Boolean));

export function validLocalPart(value: string, env?: Bindings): boolean {
  return LOCAL_PART.test(value) && !value.includes("..") && !RESERVED.has(value) && !ownedElsewhere(env).has(value);
}

async function taken(env: Bindings, localPart: string): Promise<boolean> {
  return Boolean(await env.DB.prepare("SELECT 1 FROM agent_mailboxes WHERE local_part=?").bind(localPart).first());
}

/** The first free address for a name: thiago, thiago2, thiago3 … */
export async function suggestLocalPart(env: Bindings, name: string): Promise<string> {
  const base = localPartFrom(name);
  if (!base) return "";
  for (let index = 1; index < 50; index += 1) {
    const candidate = index === 1 ? base : `${base.slice(0, 28)}${index}`;
    if (validLocalPart(candidate, env) && !await taken(env, candidate)) return candidate;
  }
  return "";
}

const view = (row: Record<string, unknown>, env: Bindings) => ({
  address: `${row.local_part}@${mailDomain(env)}`, localPart: row.local_part, memberId: row.member_id, memberName: row.member_name, createdAt: row.created_at,
});

export async function mailboxRoutes(request: Request, env: Env & Bindings, user: Principal, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith("/v1/mailboxes") && !url.pathname.startsWith("/v1/mail/")) return null;
  const allowed = mailAllowed(env, user);
  if (url.pathname === "/v1/mailboxes" && request.method === "GET") {
    const rows = allowed ? (await env.DB.prepare("SELECT * FROM agent_mailboxes WHERE user_id=? AND revoked_at IS NULL ORDER BY created_at").bind(user.id).all()).results : [];
    return ok({ allowed, domain: mailDomain(env), mailboxes: rows.map(row => view(row, env)) });
  }
  requireValue(allowed, 403, "mail_not_enabled", "Agent email addresses are not available for this account yet.");
  if (url.pathname === "/v1/mailboxes/suggest" && request.method === "GET") {
    const localPart = await suggestLocalPart(env, url.searchParams.get("name") || "");
    return ok({ localPart, address: localPart ? `${localPart}@${mailDomain(env)}` : "" });
  }
  if (url.pathname === "/v1/mailboxes" && request.method === "POST") {
    const input = await body(request, z.object({ memberId: z.string().min(1).max(160), memberName: z.string().min(1).max(80), localPart: z.string().max(30).optional() }).strict());
    const localPart = (input.localPart || await suggestLocalPart(env, input.memberName)).toLowerCase();
    requireValue(validLocalPart(localPart, env), 400, "mail_address_invalid", "Use 2–30 letters, numbers, dots or dashes, not a reserved name.");
    const existing = await env.DB.prepare("SELECT * FROM agent_mailboxes WHERE user_id=? AND member_id=? AND revoked_at IS NULL").bind(user.id, input.memberId).first();
    if (existing) return ok({ mailbox: view(existing, env), created: false });
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM agent_mailboxes WHERE user_id=? AND revoked_at IS NULL").bind(user.id).first<{ n: number }>();
    requireValue((count?.n || 0) < MAX_MAILBOXES, 409, "mail_limit", `An account can give at most ${MAX_MAILBOXES} members an address.`);
    const previous = await env.DB.prepare("SELECT user_id FROM agent_mailboxes WHERE local_part=?").bind(localPart).first<{ user_id: string }>();
    requireValue(!previous || previous.user_id === user.id, 409, "mail_address_taken", "That address belongs to someone else. Choose another.");
    const now = new Date().toISOString();
    // An address never moves to another account; its owner can give it back to a member.
    await env.DB.prepare(`INSERT INTO agent_mailboxes(local_part,user_id,member_id,member_name,created_at,revoked_at) VALUES (?,?,?,?,?,NULL)
      ON CONFLICT(local_part) DO UPDATE SET member_id=excluded.member_id, member_name=excluded.member_name, created_at=excluded.created_at, revoked_at=NULL WHERE agent_mailboxes.user_id=excluded.user_id`)
      .bind(localPart, user.id, input.memberId, input.memberName.trim(), now).run();
    const saved = await env.DB.prepare("SELECT * FROM agent_mailboxes WHERE local_part=? AND user_id=?").bind(localPart, user.id).first();
    requireValue(saved, 409, "mail_address_taken", "That address was just taken. Choose another.");
    return ok({ mailbox: view(saved, env), created: true }, 201);
  }
  const one = url.pathname.match(/^\/v1\/mailboxes\/([a-z0-9.-]{2,30})$/);
  if (one && request.method === "DELETE") {
    const result = await env.DB.prepare("UPDATE agent_mailboxes SET revoked_at=? WHERE local_part=? AND user_id=? AND revoked_at IS NULL").bind(new Date().toISOString(), one[1], user.id).run();
    requireValue(result.meta.changes, 404, "mailbox_not_found", "That address is not active on this account.");
    return ok({ removed: `${one[1]}@${mailDomain(env)}` });
  }
  if (url.pathname === "/v1/mail/pending" && request.method === "GET") {
    const rows = (await env.DB.prepare("SELECT id,local_part,member_id,from_address,from_name,subject,text,message_id,received_at FROM agent_mail WHERE user_id=? AND delivered_at IS NULL ORDER BY received_at LIMIT 20").bind(user.id).all()).results;
    return ok({ messages: rows.map(row => ({ id: row.id, to: `${row.local_part}@${mailDomain(env)}`, memberId: row.member_id, from: row.from_address, fromName: row.from_name || "", subject: row.subject || "", text: row.text, receivedAt: row.received_at })) });
  }
  const delivered = url.pathname.match(/^\/v1\/mail\/([a-f0-9-]{36})\/delivered$/);
  if (delivered && request.method === "POST") {
    await env.DB.prepare("UPDATE agent_mail SET delivered_at=? WHERE id=? AND user_id=? AND delivered_at IS NULL").bind(new Date().toISOString(), delivered[1], user.id).run();
    return ok({ id: delivered[1] });
  }
  throw new ApiError(404, "route_not_found", "Squad API route not found.");
}

const stripHtml = (html: string) => html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, "\n").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

/**
 * One inbound message from Email Routing. Returns `{ stored }` or a refusal
 * the handler passes to `setReject` (the sender gets a bounce, nothing is kept).
 */
export async function receiveAgentMail(env: Bindings, { to, from, raw }: { to: string; from: string; raw: ArrayBuffer }): Promise<{ stored: true; id: string } | { stored: false; reason: string }> {
  const [localRaw, domain] = String(to || "").toLowerCase().split("@");
  const localPart = localRaw.split("+")[0];
  if (domain !== mailDomain(env)) return { stored: false, reason: "This address is not handled here." };
  if (raw.byteLength > MAX_RAW_BYTES) return { stored: false, reason: "Message too large for an agent address (5 MB)." };
  const box = await env.DB.prepare("SELECT * FROM agent_mailboxes WHERE local_part=? AND revoked_at IS NULL").bind(localPart).first<Record<string, string>>();
  if (!box) return { stored: false, reason: "No agent has this address." };
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const today = await env.DB.prepare("SELECT COUNT(*) AS n FROM agent_mail WHERE local_part=? AND received_at>?").bind(localPart, since).first<{ n: number }>();
  if ((today?.n || 0) >= DAILY_LIMIT) return { stored: false, reason: "This agent's mailbox is full for today." };
  const parsed = await PostalMime.parse(raw);
  const text = (parsed.text?.trim() || (parsed.html ? stripHtml(parsed.html) : "")).slice(0, MAX_TEXT) || "(no text)";
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO agent_mail(id,local_part,user_id,member_id,from_address,from_name,subject,text,message_id,received_at,delivered_at) VALUES (?,?,?,?,?,?,?,?,?,?,NULL)")
    .bind(id, localPart, box.user_id, box.member_id, String(parsed.from?.address || from).slice(0, 320), String(parsed.from?.name || "").slice(0, 120), String(parsed.subject || "").slice(0, 300), text, String(parsed.messageId || "").slice(0, 300), new Date().toISOString()).run();
  return { stored: true, id };
}

/** Delivered mail older than 30 days, and anything older than 90, is removed. */
export async function cleanAgentMail(env: Bindings): Promise<void> {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM agent_mail WHERE delivered_at IS NOT NULL AND delivered_at<?").bind(new Date(now - 30 * 86_400_000).toISOString()),
    env.DB.prepare("DELETE FROM agent_mail WHERE received_at<?").bind(new Date(now - 90 * 86_400_000).toISOString()),
  ]);
}
