// Auto responder pick (ADR-0094): one bounded chat-completion call to the
// bridge's resolved provider that answers "who should reply?" as JSON. It
// never does the work; the chosen member still runs its own turn. It only
// runs against providers the bridge can call directly with an API key and an
// OpenAI-compatible base URL; anything else reports why Auto is unavailable
// and the caller falls back to the lead or everyone (src/lib/channel-responders.js).

import {
  RESPONDER_PICK_TIMEOUT_MS,
  RESPONDER_SEVERAL,
  decideFromPick,
  fallbackDecision,
  needsResponderPick,
  resolveMentions,
  resolveResponderRecipients,
} from "../../src/lib/channel-responders.js";

// Providers whose base URL speaks /chat/completions. Bedrock (SigV4) and
// LLM Gateway (no fixed shape) are not direct; Autohand AI is direct only with
// an API key, since the account token belongs to the CLI.
const DIRECT_PROVIDERS = new Set(["openai", "openrouter", "deepseek", "zai", "nvidia", "cerebras", "ollama", "autohandai"]);
const NO_KEY_PROVIDERS = new Set(["ollama"]);
const MAX_TOKENS = 80;
const MAX_LINES = 6;
const MAX_LINE_CHARS = 240;

export function chatCompletionsUrl(baseUrl, providerId = "") {
  let url = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!url) return "";
  if (url.endsWith("/chat/completions")) return url;
  if (providerId === "ollama" && !/\/v\d+$/.test(url)) url += "/v1";
  return `${url}/chat/completions`;
}

/**
 * Can Auto call this resolved provider directly? Returns { ok: true, endpoint }
 * or { ok: false, reason } with a sentence the settings row can show.
 */
export function directEndpoint(resolved, { autohandBaseUrl = "" } = {}) {
  if (!resolved || !resolved.provider) return { ok: false, reason: "Auto is unavailable: no provider is configured." };
  const label = resolved.label || resolved.provider;
  if (!DIRECT_PROVIDERS.has(resolved.provider)) return { ok: false, reason: `Auto is unavailable with ${label}; it needs a provider the bridge can call directly with an API key.` };
  const apiKey = String(resolved.apiKey || "").trim();
  if (!apiKey && !NO_KEY_PROVIDERS.has(resolved.provider)) {
    return { ok: false, reason: resolved.provider === "autohandai" ? `Auto is unavailable with ${label} signed in by account; add an Autohand AI API key in Settings.` : `Auto is unavailable with ${label}; its API key is missing in Settings.` };
  }
  const baseUrl = String(resolved.baseUrl || (resolved.provider === "autohandai" ? autohandBaseUrl : "") || "").trim();
  const url = chatCompletionsUrl(baseUrl, resolved.provider);
  if (!url) return { ok: false, reason: `Auto is unavailable with ${label}; it has no base URL.` };
  if (!resolved.model) return { ok: false, reason: `Auto is unavailable with ${label}; choose a default model first.` };
  return { ok: true, endpoint: { url, apiKey, model: resolved.model, provider: resolved.provider, label } };
}

function clip(value, max) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function buildPickMessages({ channelName, roster, lines = [], message }) {
  const choices = [...roster.map((member) => member.id), RESPONDER_SEVERAL];
  const rosterText = roster
    .map((member) => `- ${member.id}: ${clip(member.name, 60)}${member.role ? `, ${clip(member.role, 60)}` : ""}${member.purpose ? ` — ${clip(member.purpose, 160)}` : ""}`)
    .join("\n");
  const recent = lines.slice(-MAX_LINES).map((line) => `  ${clip(line, MAX_LINE_CHARS)}`).join("\n");
  return [
    {
      role: "system",
      content: "You route messages in a team chat room. Decide which member should answer the new message, or \"several\" when more than one member is clearly needed. Reply with JSON only, no prose: {\"choice\":\"<member id or several>\",\"probability\":<0 to 1>} where probability is how sure you are.",
    },
    {
      role: "user",
      content: [
        `Channel: #${clip(channelName, 80)}`,
        "Members:",
        rosterText || "- (none)",
        recent ? `Recent lines:\n${recent}` : "",
        `New message: ${clip(message, 600)}`,
        `Choices: ${choices.join(", ")}`,
      ].filter(Boolean).join("\n"),
    },
  ];
}

export function parsePickAnswer(text) {
  const raw = String(text || "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return parsed && typeof parsed === "object" ? { choice: parsed.choice, probability: Number(parsed.probability) } : null;
  } catch {
    return null;
  }
}

/**
 * The call itself. Resolves to { ok: true, answer, latencyMs } or
 * { ok: false, reason, latencyMs }; it never throws and never exceeds timeoutMs.
 */
export async function callPick({ endpoint, channelName, roster, lines, message, timeoutMs = RESPONDER_PICK_TIMEOUT_MS, fetchImpl = globalThis.fetch }) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpoint.url, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", ...(endpoint.apiKey ? { authorization: `Bearer ${endpoint.apiKey}` } : {}) },
      body: JSON.stringify({ model: endpoint.model, temperature: 0, max_tokens: MAX_TOKENS, messages: buildPickMessages({ channelName, roster, lines, message }) }),
    });
    const latencyMs = Date.now() - startedAt;
    if (!response.ok) return { ok: false, reason: `http ${response.status}`, latencyMs };
    const body = await response.json().catch(() => null);
    const answer = parsePickAnswer(body?.choices?.[0]?.message?.content);
    if (!answer) return { ok: false, reason: "invalid answer", latencyMs };
    return { ok: true, answer, latencyMs };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    if (error?.name === "AbortError") return { ok: false, reason: `timeout after ${timeoutMs} ms`, latencyMs };
    return { ok: false, reason: `network: ${error?.message || "failed"}`, latencyMs };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The bridge-owned picker. `resolveProvider` returns the bridge's resolved
 * default provider (with secrets) or throws when none is usable.
 */
export function createResponderPicker({ resolveProvider, autohandBaseUrl = "", timeoutMs = RESPONDER_PICK_TIMEOUT_MS, fetchImpl = globalThis.fetch, log = () => {} }) {
  async function availability() {
    let resolved;
    try {
      resolved = await resolveProvider();
    } catch (error) {
      return { available: false, reason: `Auto is unavailable: ${error.message}`, provider: null };
    }
    const direct = directEndpoint(resolved, { autohandBaseUrl });
    const provider = { id: resolved.provider, label: resolved.label, model: resolved.model };
    return direct.ok ? { available: true, reason: "", provider } : { available: false, reason: direct.reason, provider };
  }

  /**
   * Decide the recipients of one message in `channel`. Mentions never reach the
   * model; an Auto channel costs exactly one request per un-mentioned message.
   * `roster` is [{ id, name, role, purpose }] limited to channel members.
   */
  async function pick({ channel, roster, message, lines = [] }) {
    const mentions = resolveMentions(message, roster);
    const base = { channelId: channel.id, mentions, requests: 0, latencyMs: 0 };
    if (!needsResponderPick(mentions, channel)) {
      const resolution = resolveResponderRecipients({ mentions, channel, pick: null });
      return { ...base, ...resolution, available: null, reason: mentions.hasMentions ? "mentions win" : "mode is not auto" };
    }
    const ready = await availability();
    const leadMemberId = String(channel?.responder?.leadMemberId || "");
    const memberIds = roster.map((member) => member.id);
    if (!ready.available) {
      const decision = fallbackDecision(ready.reason, { memberIds, leadMemberId });
      const resolution = resolveResponderRecipients({ mentions, channel, pick: decision });
      return { ...base, ...resolution, available: false, reason: ready.reason, provider: ready.provider };
    }
    const resolved = await resolveProvider();
    const { endpoint } = directEndpoint(resolved, { autohandBaseUrl });
    const result = await callPick({ endpoint, channelName: channel.name, roster, lines, message, timeoutMs, fetchImpl });
    const decision = result.ok ? decideFromPick(result.answer, { memberIds, leadMemberId }) : fallbackDecision(result.reason, { memberIds, leadMemberId });
    const resolution = resolveResponderRecipients({ mentions, channel, pick: decision });
    log({ channelId: channel.id, ok: result.ok, rule: resolution.rule, choice: decision.choice || "", probability: decision.probability, latencyMs: result.latencyMs, reason: result.ok ? "" : result.reason });
    return { ...base, ...resolution, available: true, reason: result.ok ? "" : result.reason, provider: ready.provider, requests: 1, latencyMs: result.latencyMs };
  }

  return { availability, pick };
}
