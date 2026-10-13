// Markdown → something a voice can read (ADR-0087).
//
// Members write for a screen: fenced code, file paths, tables, link soup,
// list scaffolding. Read verbatim, a diff is minutes of punctuation and
// `src/lib/foo.js` is "src slash lib slash foo dot j s". The rule here is:
// say the prose, name the artifacts, drop the syntax.
//
// Pure and synchronous on purpose: it is the piece most likely to need tuning
// against real replies, so scripts/check-voice.mjs runs it in node.

const SPOKEN_LANGUAGES = {
  ts: "TypeScript", tsx: "TypeScript", js: "JavaScript", jsx: "JavaScript", mjs: "JavaScript",
  py: "Python", sh: "shell", bash: "shell", zsh: "shell", json: "JSON", yml: "YAML", yaml: "YAML",
  sql: "SQL", rs: "Rust", go: "Go", swift: "Swift", diff: "diff", css: "CSS", html: "HTML", md: "Markdown",
};

/** A fenced block becomes a mention of itself, with its language if known. */
function describeCodeBlock(fence) {
  const lang = String(fence || "").trim().split(/\s+/)[0]?.replace(/[^a-z0-9+#]/gi, "") || "";
  const name = SPOKEN_LANGUAGES[lang.toLowerCase()];
  return name ? `. (a ${name} code block) ` : ". (a code block) ";
}

/**
 * The last meaningful segment of a URL: the final path segment that contains
 * a letter, plus a trailing number when there is one ("pull 12"); the host
 * when the path is empty.
 */
export function spokenUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { return "a link"; }
  const segments = url.pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
  const host = url.hostname.replace(/^www\./, "");
  if (!segments.length) return host;
  const last = segments[segments.length - 1];
  const numericTail = /^\d+$/.test(last) ? last : "";
  const named = [...segments].reverse().find((segment) => /[a-z]/i.test(segment));
  if (!named) return host;
  const words = named.replace(/\.[a-z0-9]{1,6}$/i, "").replace(/[-_]+/g, " ");
  return numericTail && named !== last ? `${words} ${numericTail}` : words;
}

/** `a/b/c/file.ts` → `file.ts`. A path's directories are for the eye. */
function shortenPaths(text) {
  return text.replace(/(?:~\/|\.{1,2}\/|\/)?(?:[\w.@-]+\/){1,}([\w.-]+\.\w{1,6})\b/g, "$1");
}

const ENDS_SENTENCE = /[.!?:;,]\s*$/;

function sentence(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed) return "";
  return ENDS_SENTENCE.test(trimmed) ? trimmed : `${trimmed}.`;
}

function splitCells(row) {
  return row.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((cell) => cell.trim());
}

function isSeparatorRow(row) {
  return /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(row);
}

/** A markdown table becomes one "header: value, header: value." line per row. */
function spokenTables(text) {
  const lines = text.split("\n");
  const out = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const next = lines[index + 1];
    if (line.includes("|") && next !== undefined && isSeparatorRow(next)) {
      const headers = splitCells(line);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        rows.push(splitCells(lines[index]));
        index += 1;
      }
      index -= 1;
      if (!rows.length) {
        out.push(sentence(headers.filter(Boolean).join(", ")));
        continue;
      }
      for (const row of rows) {
        const pairs = row
          .map((value, column) => (value ? (headers[column] ? `${headers[column]}: ${value}` : value) : ""))
          .filter(Boolean);
        out.push(sentence(pairs.join(", ")));
      }
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

/**
 * Markdown (or any member output) → a text a voice can read.
 *
 * Not a markdown parser: a sequence of narrow, ordered replacements, which is
 * both fast enough to run on every reply and easy to reason about when one of
 * them misfires on a real transcript.
 */
export function spokenText(input) {
  if (!input) return "";
  let text = String(input).replace(/\r\n?/g, "\n");

  // Fenced code first: everything inside must survive none of the rules below.
  text = text.replace(/```([^\n]*)\n[\s\S]*?(?:```|$)/g, (_match, fence) => describeCodeBlock(fence));
  text = text.replace(/~~~([^\n]*)\n[\s\S]*?(?:~~~|$)/g, (_match, fence) => describeCodeBlock(fence));

  // Images before links: the syntax differs by one character.
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_match, alt) => (alt ? `. (image: ${alt}) ` : ". (an image) "));
  // [label](url) → label; a bare URL becomes its last meaningful segment.
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  text = text.replace(/<(https?:\/\/[^>\s]+)>/g, (_match, url) => ` ${spokenUrl(url)} `);
  text = text.replace(/\bhttps?:\/\/[^\s)<>"']+/g, (match) => ` ${spokenUrl(match.replace(/[.,;:!?]+$/, ""))} `);

  text = spokenTables(text);

  // Inline code keeps its text: identifiers carry meaning. Long snippets do not.
  text = text.replace(/`([^`\n]+)`/g, (_match, code) => (code.length <= 48 ? code : " that snippet "));

  // Headings become sentences so the voice pauses instead of running on.
  text = text.replace(/^\s{0,3}#{1,6}\s+(.*)$/gm, (_match, head) => sentence(head.replace(/\s#+\s*$/, "")));

  // Lists: the marker is visual, the pause is what matters, so each item is a sentence.
  text = text.replace(/^\s*[-*+]\s+\[[ xX]\]\s*(.*)$/gm, (_match, item) => sentence(item));
  text = text.replace(/^\s*[-*+]\s+(.*)$/gm, (_match, item) => sentence(item));
  text = text.replace(/^\s*\d+[.)]\s+(.*)$/gm, (_match, item) => sentence(item));
  text = text.replace(/^\s*>\s?/gm, "");
  text = text.replace(/^\s*(?:[-*_]\s*){3,}$/gm, "");

  // Emphasis and strikethrough markers.
  text = text.replace(/(\*\*|__)(.*?)\1/g, "$2");
  text = text.replace(/(\*|_)(?=\S)(.*?)(?<=\S)\1/g, "$2");
  text = text.replace(/~~(.*?)~~/g, "$1");

  text = shortenPaths(text);

  // Emoji and pictographs: a voice either ignores them or announces them by name.
  text = text.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu, "");

  // A blank line is a paragraph break; make it an audible one.
  text = text.replace(/\n{2,}/g, ". ");
  text = text.replace(/\n/g, ". ");

  // Tidy the punctuation the substitutions above pile up.
  text = text.replace(/\s+/g, " ");
  text = text.replace(/\s+([.,!?;:])/g, "$1");
  text = text.replace(/(?:\.\s*){2,}/g, ". ");
  text = text.replace(/([,:;])\s*\./g, "$1");
  text = text.replace(/([!?])\./g, "$1");
  text = text.replace(/^[\s.,;:]+/, "").trim();

  // Whitespace-only input would become a lone full stop, which a synthesiser
  // renders as a click. Nothing to say means nothing to send.
  return /[\p{L}\p{N}]/u.test(text) ? text : "";
}

const BOUNDARY = /(?<!\b(?:e\.g|i\.e|etc|vs|Dr|Mr|Mrs|Ms|No|approx))(?<![.\d])([.!?])(["')\]]*)\s+/g;

/**
 * Split spoken text into utterances a synthesiser can start on. Built-in
 * voices cut long utterances short in some browsers, and very short fragments
 * produce flat prosody, so sentences are the unit and tiny ones are glued to
 * their neighbour.
 */
export function spokenUtterances(input, { minChars = 12, maxChars = 320 } = {}) {
  const text = spokenText(input);
  if (!text) return [];
  const MARK = "\u0000";
  const rough = text.replace(BOUNDARY, `$1$2${MARK}`).split(MARK).map((piece) => piece.trim()).filter(Boolean);
  const out = [];
  for (const piece of rough) {
    const parts = piece.length <= maxChars ? [piece] : splitLong(piece, maxChars);
    for (const part of parts) {
      const previous = out[out.length - 1];
      if (previous && (previous.length < minChars || part.length < minChars)) out[out.length - 1] = `${previous} ${part}`;
      else out.push(part);
    }
  }
  return out;
}

function splitLong(text, maxChars) {
  const out = [];
  let rest = text;
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars);
    const clause = Math.max(window.lastIndexOf(", "), window.lastIndexOf("; "));
    const cut = clause > maxChars / 2 ? clause + 1 : window.lastIndexOf(" ");
    if (cut <= 0) break;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}
