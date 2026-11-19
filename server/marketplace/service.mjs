// The bridge's half of the agent marketplace (ADR-0246).
//
// Browsing goes through here so the app works offline with the last list it
// saw, and so the browser never talks to the marketplace API or x.ai itself.
// Every template is validated and re-hashed here before the app may add it.
// Publishing exchanges the signed-in Autohand credential for a Squad session;
// the credential never reaches the browser.
// See docs/integration/marketplace.md.

import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";

import { createSquadApi, squadApiUrl } from "../squad-cloud/client.mjs";
import { readMemberNotes, readMemberSkills, writeImportedSkills } from "../teams/package.mjs";
import {
  ATTRIBUTION_ID, GROK_ID, GROK_ORIGIN, LISTING_ID, SHA256_HEX, TEMPLATE_LIMITS, contentHash, grokCreatorName, grokTemplate, memberTemplateFindings, parseGrokBotPage,
  parseMarketplaceLink, secretFindings, templateFromMember, validateAgentTemplate, validateListingInput, validateListingTemplate,
} from "../../src/lib/marketplace.js";
import { memberExportRecord, skillExportRecord } from "../../src/lib/teams.js";

export const IMPORTS_FILE = "marketplace-imports.json";
export const CACHE_FILE = "marketplace-cache.json";
const fail = (message, status = 400, code = "marketplace_error") => Object.assign(new Error(message), { status, code });
// The browser treats 401/409 with sign_in_required, context_changed or
// identity_mismatch as "the Autohand account or Squad changed" and reloads the
// whole app (ownership-client.js). A cloud answer must never reach the browser
// in that shape: a squad-api without the marketplace (or without a Squad
// session) answers 401 sign_in_required, and passing it through reloaded the
// app in a loop while a squad:// link was open. Auth-shaped cloud answers mean
// "the marketplace is not available here", not "you signed out".
const ACCOUNT_CODES = new Set(["sign_in_required", "context_changed", "identity_mismatch"]);
function cloudFailure(error, fallbackMessage) {
  if (error?.status === 401 || error?.status === 403 || ACCOUNT_CODES.has(error?.code)) {
    return fail("The marketplace isn't available right now. Squad will retry; nothing was changed.", 503, "marketplace_unavailable");
  }
  return fail(error?.message || fallbackMessage, error.status, error.code);
}
const GROK_PAGE_BYTES = 1536 * 1024;
const GROK_PER_MINUTE = 6;
const GROK_CACHE_MS = 10 * 60_000;
const LIST_CACHE_ENTRIES = 60;

/** The x.ai origin, overridable only to a loopback fixture for checks. */
export function grokOrigin(value = process.env.AUTOHAND_SQUAD_GROK_ORIGIN || GROK_ORIGIN) {
  const url = new URL(value);
  if (url.origin === GROK_ORIGIN) return GROK_ORIGIN;
  if (url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname)) return url.origin;
  throw fail("The Grok origin can only be x.ai.", 500, "grok_origin_invalid");
}

const offlineMessage = "The marketplace could not be reached. Check your connection and retry.";
// The Squad API answered but has no marketplace yet (production before the
// marketplace rollout answers 401 sign_in_required to the public routes).
// That is not the person's connection, so it is not said to be (ADR-0261).
const notLiveMessage = "The Squad marketplace isn't open yet. Your connection is fine; it opens when the marketplace goes live.";

export function createMarketplace(ctx, { fetchImpl = fetch, baseUrl = squadApiUrl(), grok = grokOrigin(), now = () => Date.now() } = {}) {
  const publicApi = createSquadApi({ baseUrl, fetchImpl });
  const listCache = new Map();
  const grokCache = new Map();
  const grokHits = [];
  let session = null;
  let saved = null;

  async function persisted() {
    if (!saved) saved = (await ctx.readOptionalJsonFile(join(ctx.squadStateDir, CACHE_FILE)).catch(() => null)) || { version: 1, entries: {} };
    return saved;
  }

  /** A public read, remembered so the dialog still has something offline. */
  async function cachedRead(key, path) {
    try {
      const data = await publicApi.request(path, { signal: AbortSignal.timeout(8000) });
      const entry = { data, fetchedAt: new Date(now()).toISOString() };
      listCache.delete(key); listCache.set(key, entry);
      while (listCache.size > LIST_CACHE_ENTRIES) listCache.delete(listCache.keys().next().value);
      // The first page and the categories survive a restart; deeper pages do not need to.
      if (key === "categories" || key === "home" || key === "agents:" || key.startsWith("agent:")) {
        const store = await persisted();
        store.entries[key] = entry;
        const keys = Object.keys(store.entries).filter((item) => item.startsWith("agent:"));
        for (const old of keys.slice(0, Math.max(0, keys.length - 40))) delete store.entries[old];
        await ctx.writeJsonFile(join(ctx.squadStateDir, CACHE_FILE), store).catch(() => {});
      }
      return { ...data, offline: false, fetchedAt: entry.fetchedAt };
    } catch (error) {
      if (error?.status && error.status < 500 && error.status !== 429 && error.status !== 401 && error.status !== 403 && !ACCOUNT_CODES.has(error?.code)) throw cloudFailure(error, offlineMessage);
      const entry = listCache.get(key) || (await persisted()).entries[key];
      if (entry) return { ...entry.data, offline: true, fetchedAt: entry.fetchedAt };
      if (error?.status === 401 || error?.status === 404 || ACCOUNT_CODES.has(error?.code)) throw fail(notLiveMessage, 503, "marketplace_not_live");
      throw fail(offlineMessage, 503, "marketplace_offline");
    }
  }

  function listPath(query = {}) {
    const params = new URLSearchParams();
    if (typeof query.q === "string" && query.q.trim()) params.set("q", query.q.trim().slice(0, 200));
    if (typeof query.category === "string" && /^[a-z]{2,20}$/.test(query.category)) params.set("category", query.category);
    if (["autohand", "user", "team"].includes(query.creator)) params.set("creator", query.creator);
    if (["agent", "team", "all"].includes(query.kind)) params.set("kind", query.kind);
    if (typeof query.cursor === "string" && /^[A-Za-z0-9_-]{1,400}$/.test(query.cursor)) params.set("cursor", query.cursor);
    const limit = Number(query.limit);
    if (Number.isInteger(limit) && limit >= 1 && limit <= 50) params.set("limit", String(limit));
    return params.toString();
  }

  async function list(query) {
    const params = listPath(query);
    return cachedRead(`agents:${params}`, `/v1/marketplace/agents${params ? `?${params}` : ""}`);
  }
  const categories = () => cachedRead("categories", "/v1/marketplace/categories");
  /** The first screen in one read: featured, teams and each category's first agents. */
  const home = () => cachedRead("home", "/v1/marketplace/home?per=6");
  async function detail(id) {
    if (!LISTING_ID.test(String(id || ""))) throw fail("That is not a marketplace agent.", 404, "listing_not_found");
    return cachedRead(`agent:${id}`, `/v1/marketplace/agents/${id}`);
  }

  // --- receipts -----------------------------------------------------------

  const importsPath = () => join(ctx.squadStateDir, IMPORTS_FILE);
  async function liveMembers() {
    const state = await ctx.readChannelsState().catch(() => null);
    const access = state?.agentChannelAccess && typeof state.agentChannelAccess === "object" ? state.agentChannelAccess : {};
    return new Map(Object.entries(access).filter(([, record]) => record?.agent && !record.removed).map(([id, record]) => [id, record.agent.name || id]));
  }
  /** Receipts whose member still exists, named as it is called now. */
  async function imports() {
    const store = await ctx.readOptionalJsonFile(importsPath()).catch(() => null);
    const members = await liveMembers();
    return (Array.isArray(store?.imports) ? store.imports : [])
      .filter((entry) => entry && typeof entry.memberId === "string" && members.has(entry.memberId))
      .map((entry) => ({ ...entry, kind: entry.kind === "team" ? "team" : "agent", memberName: members.get(entry.memberId), memberIds: (Array.isArray(entry.memberIds) ? entry.memberIds : [entry.memberId]).filter((id) => members.has(id)) }));
  }
  async function recordImport(input = {}) {
    const source = input.source === "grok" ? "grok" : "marketplace";
    const memberId = String(input.memberId || "").trim();
    if (!/^[A-Za-z0-9._:-]{1,160}$/.test(memberId)) throw fail("Say which member was added.");
    // A team import records every member it created; memberId is its lead.
    const memberIds = [...new Set([memberId, ...(Array.isArray(input.memberIds) ? input.memberIds : [])].map(String).filter((id) => /^[A-Za-z0-9._:-]{1,160}$/.test(id)))].slice(0, 50);
    const entry = {
      source,
      listingId: source === "marketplace" && LISTING_ID.test(String(input.listingId || "")) ? input.listingId : "",
      grokId: source === "grok" && GROK_ID.test(String(input.grokId || "")) ? input.grokId : "",
      version: Number.isInteger(input.version) && input.version > 0 ? input.version : 0,
      contentHash: SHA256_HEX.test(String(input.contentHash || "")) ? input.contentHash : "",
      creator: String(input.creator || "").replace(/\s+/g, " ").trim().slice(0, 80),
      kind: input.kind === "team" ? "team" : "agent",
      memberId,
      memberIds,
      action: input.action === "update" ? "update" : "add",
      via: ["website-link", "in-app", "link", "phone"].includes(input.via) ? input.via : "in-app",
      at: new Date(now()).toISOString(),
    };
    if (source === "marketplace" && !entry.listingId) throw fail("Say which marketplace agent was added.");
    if (source === "grok" && !entry.grokId) throw fail("Say which Grok Bot template was added.");
    const store = (await ctx.readOptionalJsonFile(importsPath()).catch(() => null)) || { version: 1, imports: [] };
    const members = await liveMembers();
    const kept = (Array.isArray(store.imports) ? store.imports : []).filter((item) => members.has(item?.memberId) && !(item.memberId === memberId && item.listingId === entry.listingId && item.grokId === entry.grokId));
    await ctx.writeJsonFile(importsPath(), { version: 1, imports: [...kept, entry].slice(-1000) });
    // A confirmed install is counted by the marketplace, anonymously, with the
    // attribution id a website link carried (ADR-0253). Updates are not installs.
    if (source === "marketplace" && entry.action === "add") {
      void reportInstall({ id: entry.listingId, version: entry.version, via: entry.via, attribution: input.attribution });
    }
    return entry;
  }

  /** Tell the marketplace an install happened. Never fails the import. */
  async function reportInstall({ id, version, via, attribution } = {}) {
    if (!LISTING_ID.test(String(id || ""))) return { sent: false };
    // The marketplace API does not know "phone" yet (squad-api EVENT_SOURCES);
    // a phone add counts as in-app there, and keeps "phone" in the receipt
    // and in Squad's own funnel event (ADR-0256).
    const body = { type: "install", source: ["website-link", "in-app", "link"].includes(via) ? via : "in-app" };
    if (ATTRIBUTION_ID.test(String(attribution || ""))) body.attribution = attribution;
    if (Number.isInteger(version) && version > 0) body.version = version;
    try {
      await publicApi.request(`/v1/marketplace/agents/${id}/events`, { method: "POST", body, signal: AbortSignal.timeout(5000) });
      return { sent: true };
    } catch {
      return { sent: false };
    }
  }

  // --- templates ------------------------------------------------------------

  /** A template from the API, validated and re-hashed, or a refusal. */
  async function fetchTemplate({ id, version, sha256 } = {}) {
    if (!LISTING_ID.test(String(id || ""))) throw fail("That is not a marketplace agent.", 404, "listing_not_found");
    if (sha256 !== undefined && sha256 !== "" && !SHA256_HEX.test(String(sha256))) throw fail("That link's checksum is not valid.", 400, "link_invalid");
    let data;
    try {
      data = await publicApi.request(`/v1/marketplace/agents/${id}/template${Number.isInteger(version) && version > 0 ? `?version=${version}` : ""}`, { signal: AbortSignal.timeout(15_000) });
    } catch (error) {
      if (error?.status === 404) throw fail("This agent is not in the marketplace any more.", 404, "listing_not_found");
      if (error?.status === 429) throw fail(error.message, 429, "rate_limited");
      if (error?.status && error.status < 500) throw cloudFailure(error, "This agent could not be fetched.");
      throw fail("The marketplace could not be reached, so nothing was added. Retry when you are online.", 503, "marketplace_offline");
    }
    const kind = data?.agent?.kind === "team" ? "team" : "agent";
    const template = validateListingTemplate(kind, data?.document);
    if (!template.ok) throw fail(`This ${kind === "team" ? "team" : "agent"}'s template was refused: ${template.error}`, 422, "template_invalid");
    const hash = await contentHash(template.document);
    const expected = [data.contentHash, data.version === data.agent?.version ? data.agent?.contentHash : data.contentHash, sha256 || hash];
    if (expected.some((value) => value !== hash)) throw fail("This agent's template does not match its checksum, so nothing was added. It may have changed on the way.", 409, "template_mismatch");
    const existing = (await imports()).filter((entry) => entry.listingId === id);
    return { agent: data.agent, kind, version: data.version, contentHash: hash, document: template.document, existing };
  }

  // --- Grok Bot templates ----------------------------------------------------

  async function grokPreview({ url, instructions = "" } = {}) {
    const link = parseMarketplaceLink(url);
    if (link.kind !== "grok") throw fail(link.kind === "invalid" ? link.error : "That is not a Grok Bot link.", 400, "link_invalid");
    if (typeof instructions !== "string" || instructions.length > 20000) throw fail("Paste at most 20,000 characters of instructions.");
    const pastedFindings = secretFindings({ instructions });
    if (pastedFindings.length) throw fail(`The pasted instructions hold something that looks like a ${pastedFindings[0].kinds.join(" or ")}. Remove it and paste again.`, 400, "template_secrets");
    let bot = grokCache.get(link.id);
    if (!bot || bot.expires < now()) {
      while (grokHits.length && grokHits[0] < now() - 60_000) grokHits.shift();
      if (grokHits.length >= GROK_PER_MINUTE) throw fail("Wait a minute before opening another Grok Bot link.", 429, "rate_limited");
      grokHits.push(now());
      bot = { value: await fetchGrokPage(link.id), expires: now() + GROK_CACHE_MS };
      grokCache.set(link.id, bot);
    }
    const document = grokTemplate(bot.value, { instructions });
    const template = validateAgentTemplate(document);
    if (!template.ok) throw fail(`This Grok Bot template could not be turned into an agent: ${template.error}`, 422, "template_invalid");
    return { bot: bot.value, creator: grokCreatorName(bot.value), sourceUrl: `${GROK_ORIGIN}/bot/${link.id}`, document: template.document, contentHash: await contentHash(template.document), existing: (await imports()).filter((entry) => entry.grokId === link.id) };
  }

  async function fetchGrokPage(id) {
    let response;
    try {
      response = await fetchImpl(`${grok}/bot/${encodeURIComponent(id)}`, {
        redirect: "manual", signal: AbortSignal.timeout(10_000), credentials: "omit",
        headers: { accept: "text/html", "user-agent": `AutohandSquad/${ctx.packageMetadata?.version || "dev"} (user-initiated template import)` },
      });
    } catch {
      throw fail("x.ai could not be reached. Check your connection and retry.", 503, "grok_unavailable");
    }
    if (response.status >= 300 && response.status < 400) throw fail("x.ai sent that link somewhere else, so it was not followed.", 502, "grok_redirect");
    if (response.status === 404) throw fail("That Grok Bot template does not exist or is no longer shared.", 404, "grok_not_found");
    if (!response.ok) throw fail(`x.ai answered ${response.status}. Try again later, or paste the bot's instructions yourself.`, 502, "grok_unavailable");
    const reader = response.body?.getReader();
    if (!reader) throw fail("x.ai returned an empty page.", 502, "grok_unavailable");
    const chunks = [];
    let size = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > GROK_PAGE_BYTES) { await reader.cancel(); throw fail("That x.ai page is larger than a bot page should be.", 502, "grok_unavailable"); }
      chunks.push(next.value);
    }
    const html = new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
    const bot = parseGrokBotPage(html, id);
    if (!bot) throw fail("That page did not describe a Grok Bot template.", 422, "grok_unreadable");
    return bot;
  }

  // --- publishing --------------------------------------------------------------

  function identity() {
    let current;
    try { current = ctx.mobileRelayIdentity?.(); } catch { current = null; }
    if (!current?.token) throw fail("Sign in to Autohand to publish to the marketplace.", 403, "marketplace_sign_in");
    return current;
  }
  async function sessionApi() {
    const { token } = identity();
    const fingerprint = createHash("sha256").update(token).digest("hex");
    if (!session || session.fingerprint !== fingerprint || Date.parse(session.expiresAt) <= now() + 60_000) {
      const exchanged = await publicApi.request("/v1/auth/exchange", { method: "POST", body: { identityToken: token, deviceName: "Squad marketplace" } });
      session = { fingerprint, token: exchanged.token, expiresAt: exchanged.expiresAt };
    }
    const api = createSquadApi({ baseUrl, fetchImpl, token: session.token });
    return {
      request: (path, options = {}) => api.request(path, options),
      async withIdentity(path, { method = "GET", body, idempotencyKey } = {}) {
        // createSquadApi has no extra headers; team requests add X-Autohand-Identity.
        const response = await fetchImpl(`${api.origin}${path}`, {
          method, redirect: "error", signal: AbortSignal.timeout(15_000),
          headers: { accept: "application/json", authorization: `Bearer ${session.token}`, "x-autohand-identity": token, ...(body === undefined ? {} : { "content-type": "application/json" }), ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        let value;
        try { value = await response.json(); } catch { throw fail("The marketplace returned an unreadable response.", 502); }
        if (!response.ok || value.success !== true) throw Object.assign(fail(value.error?.message || "The marketplace refused this request.", response.status, value.error?.code), { details: value.error?.details });
        return value.data;
      },
    };
  }

  /** Who the person can publish as: themselves, and teams they own or administer. */
  async function publishContext() {
    let api;
    try { api = await sessionApi(); } catch (error) {
      if (error.code === "marketplace_sign_in") return { signedIn: false, owners: [] };
      throw fail(error.message || offlineMessage, error.status || 503, error.code || "marketplace_offline");
    }
    const { owners } = await api.withIdentity("/v1/owners");
    return {
      signedIn: true,
      owners: owners.filter((owner) => owner.owner.kind === "user" || (owner.owner.kind === "team" && ["owner", "admin"].includes(owner.role) && owner.canWrite))
        .map((owner) => owner.owner.kind === "user" ? { kind: "user", label: owner.label } : { kind: "team", id: owner.owner.id, label: owner.label }),
    };
  }

  /**
   * The template a member would publish as: `member` is the browser's member
   * record, `skills` the skill names to carry, `includeMemory` whether its
   * MEMORY.md goes too. Nothing is sent anywhere.
   */
  async function preview({ member, skills, includeMemory = false, tagline = "" } = {}) {
    if (!member || typeof member !== "object" || !String(member.name || "").trim()) throw fail("Say which member to publish.");
    const names = (Array.isArray(member.skills) ? member.skills : []).map((name) => String(name?.name || name?.id || name || "")).filter(Boolean);
    const wanted = Array.isArray(skills) ? new Set(skills.map(String)) : new Set(names);
    const carried = names.filter((name) => wanted.has(name)).slice(0, TEMPLATE_LIMITS.skills);
    const skillTexts = await readMemberSkills(ctx, member.id, carried);
    const memory = await readMemberNotes(ctx, member.id);
    const record = memberExportRecord({ ...member, skills: skillTexts.map((skill) => skill.name) });
    if (!record) throw fail("Say which member to publish.");
    const notes = includeMemory ? memory.slice(0, TEMPLATE_LIMITS.notes) : "";
    const raw = memberTemplateFindings({ member: record, skills: skillTexts, notes, tagline });
    const document = templateFromMember({ member: record, skills: skillTexts, notes, tagline });
    const checked = validateAgentTemplate(document);
    const template = raw.length ? { ok: false, findings: raw, error: `Something that looks like a ${raw[0].kinds.join(" or ")} is in ${raw[0].path}${raw.length > 1 ? ` and ${raw.length - 1} other place${raw.length > 2 ? "s" : ""}` : ""}. Remove it before sharing.` } : checked;
    return {
      document: template.ok ? template.document : document,
      memory, memoryTruncated: memory.length > TEMPLATE_LIMITS.notes,
      skills: skillTexts.map((skill) => ({ name: skill.name, description: skill.description })),
      missingSkills: carried.filter((name) => !skillTexts.some((skill) => skill.name === name)),
      findings: template.ok ? [] : template.findings || [],
      error: template.ok ? "" : template.error,
      contentHash: template.ok ? await contentHash(template.document) : "",
    };
  }

  async function publish(body = {}) {
    const built = await preview(body);
    if (built.error) throw Object.assign(fail(built.error, 400, built.findings.length ? "template_secrets" : "template_invalid"), { details: built.findings });
    const fields = validateListingInput(body.listing);
    if (!fields.ok) throw fail(fields.error);
    const requestId = /^[a-zA-Z0-9._:-]{8,128}$/.test(String(body.requestId || "")) ? body.requestId : randomUUID();
    const api = await sessionApi();
    const note = String(body.note || "").trim().slice(0, TEMPLATE_LIMITS.note);
    const creatorName = String(body.creatorName || "").trim().slice(0, 60) || undefined;
    let result;
    if (body.listingId) {
      if (!LISTING_ID.test(String(body.listingId)) || !Number.isInteger(body.baseVersion)) throw fail("Say which version this update replaces.");
      result = await api.withIdentity(`/v1/marketplace/agents/${body.listingId}`, { method: "PUT", idempotencyKey: requestId, body: { baseVersion: body.baseVersion, listing: fields.listing, document: built.document, note, ...(creatorName ? { creatorName } : {}) } });
    } else {
      const owner = body.owner?.kind === "team" && typeof body.owner.id === "string" ? { kind: "team", id: body.owner.id } : { kind: "user" };
      result = await api.withIdentity("/v1/marketplace/agents", { method: "POST", idempotencyKey: requestId, body: { owner, listing: fields.listing, document: built.document, note, ...(creatorName ? { creatorName } : {}) } });
    }
    ctx.logEvent?.(ctx.SEVERITY?.INFO, `marketplace agent published: ${result.agent.id} v${result.agent.version}`, { "event.name": "marketplace.published", "autohand.marketplace.listing": result.agent.id });
    return { ...result, requestId };
  }

  async function mine() {
    return (await sessionApi()).withIdentity("/v1/marketplace/mine");
  }
  async function unpublish(id) {
    if (!LISTING_ID.test(String(id || ""))) throw fail("That is not a marketplace agent.", 404);
    return (await sessionApi()).withIdentity(`/v1/marketplace/agents/${id}`, { method: "DELETE" });
  }
  async function report(id, { reason, details = "" } = {}) {
    if (!LISTING_ID.test(String(id || ""))) throw fail("That is not a marketplace agent.", 404);
    return publicApi.request(`/v1/marketplace/agents/${id}/reports`, { method: "POST", body: { reason: String(reason || ""), details: String(details || "").slice(0, 1000) } });
  }

  /** New skills from an update are saved switched off, like any import. */
  async function saveSkills(skills = []) {
    const clean = (Array.isArray(skills) ? skills : []).slice(0, TEMPLATE_LIMITS.skills).map(skillExportRecord).filter((skill) => skill && !secretFindings(skill).length);
    return writeImportedSkills(ctx, clean);
  }

  return { list, categories, home, reportInstall, detail, fetchTemplate, imports, recordImport, grokPreview, publishContext, preview, publish, mine, unpublish, report, saveSkills };
}
