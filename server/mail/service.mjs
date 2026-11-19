// Agent email (ADR-0262). Squad API owns addresses on code.autohandai.com
// and stores inbound mail; this computer collects it and hands each email to
// its member as a run, with the email fenced as outside data.
//
// Only accounts whose verified email is on an allowed domain (autohand.ai
// today) may hold addresses. Squad API decides; this service never guesses.

import { createHash } from "node:crypto";
import { createSquadApi, squadApiUrl } from "../squad-cloud/client.mjs";

export const MAIL_POLL_MS = 60_000;

const fail = (message, status = 400, code = "") => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });

/**
 * `deliver({ memberId, address, email })` hands one email to its member; the
 * bridge passes the routines module's `triggerEmailRoutine`, so each address
 * is an automation ("When an email arrives at …") with run history, a pause
 * switch and the reply in the member's direct messages.
 */
/**
 * `members()` lists the Squad's current members ({ id, name }); every one
 * without an address gets one from its name automatically (ADR-0262 revised).
 */
export function createAgentMail(ctx, { fetchImpl = fetch, baseUrl = squadApiUrl(), now = () => Date.now(), deliver, members = async () => [] } = {}) {
  const publicApi = createSquadApi({ baseUrl, fetchImpl });
  let session = null;
  let timer = null;
  let polling = null;
  let lastStatus = null;

  function identity() {
    let current;
    try { current = ctx.mobileRelayIdentity?.(); } catch { current = null; }
    if (!current?.token) throw fail("Sign in to Autohand to give members email addresses.", 403, "mail_sign_in");
    return current;
  }

  async function request(path, { method = "GET", body } = {}) {
    const { token } = identity();
    const fingerprint = createHash("sha256").update(token).digest("hex");
    if (!session || session.fingerprint !== fingerprint || Date.parse(session.expiresAt) <= now() + 60_000) {
      const exchanged = await publicApi.request("/v1/auth/exchange", { method: "POST", body: { identityToken: token, deviceName: "Squad mail" } });
      session = { fingerprint, token: exchanged.token, expiresAt: exchanged.expiresAt };
    }
    const response = await fetchImpl(`${publicApi.origin}${path}`, {
      method, redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { accept: "application/json", authorization: `Bearer ${session.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let value;
    try { value = await response.json(); } catch { throw fail("Squad's mail service returned an unreadable response.", 502); }
    if (response.status === 401) session = null;
    if (!response.ok || value.success !== true) throw fail(value.error?.message || "Squad's mail service refused this request.", response.status, value.error?.code);
    return value.data;
  }

  /** { signedIn, allowed, domain, mailboxes } — never throws for sign-in. */
  async function status() {
    try {
      const data = await request("/v1/mailboxes");
      lastStatus = { signedIn: true, allowed: Boolean(data.allowed), domain: data.domain || "", mailboxes: data.mailboxes || [] };
    } catch (error) {
      if (error.code === "mail_sign_in" || error.status === 401 || error.status === 403) lastStatus = { signedIn: error.code !== "mail_sign_in", allowed: false, domain: "", mailboxes: [] };
      else throw error;
    }
    return lastStatus;
  }

  async function forMember(memberId) {
    const current = await status();
    return { ...current, mailbox: current.mailboxes.find(item => item.memberId === memberId) || null };
  }

  /** What Chief of Staff may offer after naming a member; null when not allowed. */
  async function offer(memberId, memberName) {
    const current = await forMember(memberId);
    if (!current.allowed || current.mailbox) return null;
    const suggestion = await request(`/v1/mailboxes/suggest?${new URLSearchParams({ name: memberName })}`);
    return suggestion.address ? { address: suggestion.address, localPart: suggestion.localPart } : null;
  }

  async function register({ memberId, memberName, localPart = "" }) {
    if (!memberId || !memberName) throw fail("Name the member that should get the address.", 400);
    const created = await request("/v1/mailboxes", { method: "POST", body: { memberId, memberName, ...(localPart ? { localPart } : {}) } });
    ctx.emit?.("mail.changed", { memberId });
    schedule();
    return created;
  }

  /** Whether the name before the @ is free for this account (ADR-0267). */
  async function available(localPart) {
    return request(`/v1/mailboxes/available?${new URLSearchParams({ localPart: String(localPart || "").trim().toLowerCase() })}`);
  }

  /**
   * The person's one change of a member's address (ADR-0267). Squad API does
   * it in one step and refuses a second change.
   */
  async function rename(memberId, localPart) {
    const wanted = String(localPart || "").trim().toLowerCase().replace(/@.*$/, "");
    const { mailbox } = await forMember(memberId);
    if (!mailbox) throw fail("This member has no email address yet.", 404, "mailbox_not_found");
    if (mailbox.localPart === wanted) return { mailbox, created: false };
    const saved = await request(`/v1/mailboxes/${encodeURIComponent(mailbox.localPart)}/rename`, { method: "POST", body: { localPart: wanted } });
    ctx.emit?.("mail.changed", { memberId });
    return saved;
  }

  /** Sends a member's reply to the person who wrote (ADR-0267). */
  async function reply({ emailId, memberId, text }) {
    return request(`/v1/mail/${encodeURIComponent(emailId)}/reply`, { method: "POST", body: { memberId, text } });
  }

  /** Gives every member without an address one from its name. Returns how many were made. */
  let ensuring = null;
  async function ensureAll(current = null) {
    if (ensuring) return ensuring;
    ensuring = (async () => {
      const state = current || await status().catch(() => null);
      if (!state?.allowed) return 0;
      const held = new Set(state.mailboxes.map(item => item.memberId));
      let made = 0;
      for (const member of await members().catch(() => [])) {
        if (!member?.id || !member?.name || held.has(member.id)) continue;
        try {
          await request("/v1/mailboxes", { method: "POST", body: { memberId: member.id, memberName: member.name } });
          made += 1;
        } catch (error) {
          ctx.logEvent?.(ctx.SEVERITY?.WARN, `no address for member ${member.id}: ${error?.message || error}`, { "event.name": "mail.assign.failed", "autohand.member.id": member.id });
          if (error.code === "mail_limit") break;
        }
      }
      if (made) ctx.emit?.("mail.changed", {});
      return made;
    })().finally(() => { ensuring = null; });
    return ensuring;
  }

  async function remove(memberId) {
    const { mailbox } = await forMember(memberId);
    if (!mailbox) throw fail("This member has no email address.", 404, "mailbox_not_found");
    await request(`/v1/mailboxes/${encodeURIComponent(mailbox.localPart)}`, { method: "DELETE" });
    ctx.emit?.("mail.changed", { memberId });
    return { memberId, removed: mailbox.address };
  }

  /** Collects waiting mail and starts one run per email. Returns how many started. */
  async function poll() {
    if (polling) return polling;
    polling = (async () => {
      let current = await status().catch(() => null);
      if (!current?.allowed) return 0;
      if (await ensureAll(current)) current = await status();
      if (!current.mailboxes.length) return 0;
      const pending = await request("/v1/mail/pending");
      let started = 0;
      for (const message of pending.messages || []) {
        const mailbox = current.mailboxes.find(item => item.address === message.to);
        if (!mailbox) continue;
        try {
          const result = await deliver({ memberId: message.memberId, address: mailbox.address, email: message });
          // A paused email automation leaves the mail waiting on Squad API
          // (kept 90 days), so resuming it catches up.
          if (result?.skipped) continue;
          await request(`/v1/mail/${encodeURIComponent(message.id)}/delivered`, { method: "POST" });
          started += 1;
          ctx.logEvent?.(ctx.SEVERITY?.INFO, `email delivered to member ${message.memberId}`, { "event.name": "mail.delivered", "autohand.member.id": message.memberId });
        } catch (error) {
          ctx.logEvent?.(ctx.SEVERITY?.WARN, `email for member ${message.memberId} not delivered: ${error?.message || error}`, { "event.name": "mail.delivery.failed", "autohand.member.id": message.memberId });
        }
      }
      return started;
    })().finally(() => { polling = null; });
    return polling;
  }

  function schedule() {
    if (timer) return;
    timer = setInterval(() => { poll().catch(() => {}); }, MAIL_POLL_MS);
    timer.unref?.();
    poll().catch(() => {});
  }

  function stop() { if (timer) clearInterval(timer); timer = null; }

  return { status, forMember, offer, register, rename, available, reply, ensureAll, remove, poll, schedule, stop, get lastStatus() { return lastStatus; } };
}
