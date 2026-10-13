// Telegram formatting for member replies (ADR-0102). Members answer in
// Markdown; Telegram renders a small HTML subset and caps a message at 4096
// characters. Pure functions, no I/O; scripts/check-remote-access.mjs covers
// the conversions.

export const TELEGRAM_MESSAGE_LIMIT = 4096;
const SPLIT_LIMIT = 3500;

export function escapeHtml(text) {
  return String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(text) {
  return escapeHtml(text).replace(/"/g, "&quot;");
}

function cells(row) {
  return String(row).trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
}

/**
 * Telegram has no tables and pipes are unreadable on a phone: the header row
 * becomes an italic line and each row a bullet led by its first cell.
 */
export function tablesToLines(markdown) {
  const lines = String(markdown ?? "").split("\n");
  const out = [];
  for (let index = 0; index < lines.length; index += 1) {
    const header = lines[index];
    const rule = lines[index + 1];
    if (/^\s*\|.*\|\s*$/.test(header) && rule && /^\s*\|?\s*:?-{3,}[-:|\s]*$/.test(rule)) {
      out.push(`*${cells(header).filter(Boolean).join(" · ")}*`);
      index += 2;
      while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index])) {
        const [first, ...rest] = cells(lines[index]);
        out.push(`- **${first}**${rest.length ? ` · ${rest.join(" · ")}` : ""}`);
        index += 1;
      }
      index -= 1;
      continue;
    }
    out.push(header);
  }
  return out.join("\n");
}

/** Convert the common Markdown constructs to Telegram HTML; escape the rest. */
export function markdownToTelegramHtml(markdown) {
  const stash = [];
  const keep = (html) => `\u0000${stash.push(html) - 1}\u0000`;
  let text = String(markdown ?? "").replace(/\r\n/g, "\n");

  // Fenced code first so nothing inside is formatted.
  text = text.replace(/```([\w+-]*)\n?([\s\S]*?)```/g, (_, lang, code) =>
    keep(lang
      ? `<pre><code class="language-${escapeAttribute(lang)}">${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`
      : `<pre>${escapeHtml(code.replace(/\n$/, ""))}</pre>`));
  text = text.replace(/`([^`\n]+)`/g, (_, code) => keep(`<code>${escapeHtml(code)}</code>`));

  text = tablesToLines(text);

  // Links before escaping so their URLs stay intact.
  text = text.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) =>
    keep(`<a href="${escapeAttribute(url)}">${escapeHtml(label)}</a>`));

  text = escapeHtml(text);
  text = text
    .replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/__([^_\n]+)__/g, "<b>$1</b>")
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<i>$2</i>")
    .replace(/~~([^~\n]+)~~/g, "<s>$1</s>")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/^&gt;\s?(.*)$/gm, "<blockquote>$1</blockquote>")
    .replace(/<\/blockquote>\n<blockquote>/g, "\n")
    .replace(/^-{3,}$/gm, "———");

  return text.replace(/\u0000(\d+)\u0000/g, (_, index) => stash[Number(index)]);
}

/**
 * Split Markdown on blank lines (never inside a code fence) so each piece
 * converts cleanly and stays under Telegram's limit.
 */
export function splitMarkdown(markdown, limit = SPLIT_LIMIT) {
  const text = String(markdown ?? "");
  if (text.length <= limit) return [text];
  const blocks = [];
  let current = "";
  let inFence = false;
  for (const line of text.split("\n")) {
    if (line.trim().startsWith("```")) inFence = !inFence;
    const next = current ? `${current}\n${line}` : line;
    if (next.length > limit && !inFence && current) {
      blocks.push(current);
      current = line;
    } else if (next.length > limit * 1.15) {
      // One enormous block (usually code): cut it hard.
      blocks.push(next.slice(0, limit));
      current = next.slice(limit);
    } else {
      current = next;
    }
  }
  if (current.trim()) blocks.push(current);
  return blocks;
}

/** A plain-text fallback when Telegram rejects the HTML. */
export function plainText(markdown) {
  return String(markdown ?? "").replace(/```[\w+-]*\n?/g, "").replace(/\*\*|__|`/g, "");
}

/** One short line describing a harness step, for the live status message. */
export function describeStep(event = {}) {
  const name = String(event.toolName || event.name || "").trim();
  const args = event.args && typeof event.args === "object" ? event.args : {};
  const first = Object.values(args).find((value) => typeof value === "string" && value.trim());
  const detail = first ? ` ${String(first).replace(/\s+/g, " ").trim()}` : "";
  return `${name || "step"}${detail}`.slice(0, 90);
}

/** The live status message: a header line and the last few steps, as HTML. */
export function renderStatus({ memberName, steps = [], done = false, elapsedMs = 0, checklist = null }) {
  const count = steps.length;
  const seconds = (elapsedMs / 1000).toFixed(1);
  const header = done
    ? `✓ ${escapeHtml(memberName)} · ${count} step${count === 1 ? "" : "s"} · ${seconds}s`
    : `⋯ ${escapeHtml(memberName)} is working · ${count} step${count === 1 ? "" : "s"}`;
  const lines = [`<code>${header}</code>`];
  if (checklist && checklist.total) lines.push(`<code>${checklist.done}/${checklist.total} checklist items done</code>`);
  for (const step of steps.slice(-6)) lines.push(`<code>${escapeHtml(step)}</code>`);
  return lines.join("\n");
}
