// Things that look like secrets, and how to take them out of text that is
// about to leave the machine.
//
// A team file carries instructions, brain cards, skill text and notes that a
// person typed. People paste keys into notes. The file format has no field
// for a credential, but a credential inside a paragraph is still a
// credential, so every text part of an export passes through here before it
// is written, and again when a file is imported. The rule is deliberately
// broad: a commit hash in a note is replaced too, and the dialog lists what
// changed so the person can decide whether that mattered.
//
// Pure: no React, no DOM, no Node, so the bridge (server/teams) and the
// browser share one detector and scripts/check-teams.mjs can prove it from
// Node. See docs/adrs/ADR-0106-team-sharing-presets-and-member-menus.md.

export const SECRET_MARKER = "[removed: looked like a secret]";

// Each rule names what it matched, so a report can say "a key" rather than
// "something". Order matters only for the kind reported when two overlap;
// every rule runs over the whole text.
const RULES = Object.freeze([
  // Private key blocks, whole.
  { kind: "private key", pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g },
  // Known vendor prefixes.
  { kind: "API key", pattern: /\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{8,}\b/g },
  { kind: "API key", pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g },
  { kind: "API key", pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { kind: "API key", pattern: /\bglpat-[A-Za-z0-9_-]{16,}\b/g },
  { kind: "API key", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { kind: "API key", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: "API key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: "API key", pattern: /\bnpm_[A-Za-z0-9]{36}\b/g },
  // Bearer tokens and JWTs.
  { kind: "token", pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/g },
  { kind: "token", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  // Credentials inside a URL: https://user:pass@host.
  { kind: "URL credential", pattern: /(https?:\/\/)[^/\s:@]+:[^@\s/]+@/g, replace: (_match, scheme) => `${scheme}${SECRET_MARKER}@` },
  // "password: hunter2", "api_key = abc…", "token=…". The label stays so the
  // person can see what was there; only the value goes.
  {
    kind: "password or key line",
    pattern: /\b(password|passwd|passphrase|pwd|secret|token|api[_ -]?key|apikey|access[_ -]?key|private[_ -]?key|client[_ -]?secret|auth(?:orization)?)\b(\s*[:=]\s*)(["']?)(?!\[removed)([^\s"'`]{4,})\3/gi,
    replace: (_match, label, separator, quote) => `${label}${separator}${quote}${SECRET_MARKER}${quote}`,
  },
  // Long opaque strings: 32 or more letters, digits, - or _ that mix letters
  // and digits. Catches tokens with no known prefix; also catches a long
  // commit hash, which is why the report names every change.
  { kind: "opaque string", pattern: /\b(?=[A-Za-z0-9_-]{32,}\b)(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*[0-9])[A-Za-z0-9_-]{32,}\b/g },
]);

/** Every match in `text`, as `{ kind, index, length }`, without changing it. */
export function scanSecrets(text) {
  const source = typeof text === "string" ? text : "";
  const found = [];
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    for (const match of source.matchAll(rule.pattern)) {
      found.push({ kind: rule.kind, index: match.index, length: match[0].length });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

export function containsSecret(text) {
  return scanSecrets(text).length > 0;
}

/**
 * `text` with every secret-looking part replaced by the marker.
 * Returns `{ text, count, kinds }`; `count` is 0 when nothing changed.
 */
export function redactSecrets(text) {
  let output = typeof text === "string" ? text : "";
  let count = 0;
  const kinds = new Set();
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    output = output.replace(rule.pattern, (...args) => {
      // The marker itself must never match a later rule.
      if (args[0].includes(SECRET_MARKER)) return args[0];
      count += 1;
      kinds.add(rule.kind);
      return rule.replace ? rule.replace(...args) : SECRET_MARKER;
    });
  }
  return { text: output, count, kinds: [...kinds] };
}

/**
 * Redact every string inside a plain object or array, in place of a copy.
 * `report` collects `{ path, count, kinds }` for each string that changed.
 */
export function redactDeep(value, report = [], path = "") {
  if (typeof value === "string") {
    const result = redactSecrets(value);
    if (result.count) report.push({ path: path || "text", count: result.count, kinds: result.kinds });
    return result.text;
  }
  if (Array.isArray(value)) return value.map((item, index) => redactDeep(item, report, `${path}[${index}]`));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = redactDeep(item, report, path ? `${path}.${key}` : key);
    return out;
  }
  return value;
}
