// Canvas helpers shared by the composer and the Canvas tab (ADR-0023). Pure:
// no React, no DOM, importable from scripts/check-canvases.mjs.
//
// A canvas is mentioned in the composer as `@canvas:<slug>` where the slug is
// derived from the title (`Test plan` → `test-plan`). The token fits the
// existing `composerTrigger` character set (`[A-Za-z0-9._/-]` after the `@`),
// so the mention picker and keyboard insertion in App.jsx work unchanged.

export const CANVAS_MENTION_PREFIX = "canvas:";

const MENTION_PATTERN = /(^|\s)@canvas:([A-Za-z0-9][A-Za-z0-9._-]*)/g;
const MAX_ATTACH_CHARS = 60 * 1024;

export function canvasSlug(title) {
  return String(title || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "untitled";
}

/** The `@canvas:slug` token to insert for a canvas. */
export function canvasMentionToken(canvas) {
  return `${CANVAS_MENTION_PREFIX}${canvasSlug(canvas?.title)}`;
}

/** Slugs mentioned in a prompt, deduplicated, in order. */
export function canvasMentions(text) {
  const seen = new Set();
  for (const match of String(text || "").matchAll(MENTION_PATTERN)) seen.add(match[2].toLowerCase());
  return Array.from(seen);
}

/** True when the mention query under the caret is asking for a canvas. */
export function isCanvasMentionQuery(query) {
  const value = String(query || "").toLowerCase();
  return value.startsWith(CANVAS_MENTION_PREFIX) || (value.length > 0 && CANVAS_MENTION_PREFIX.startsWith(value));
}

/** Picker rows for the composer: `{ id, token, label, detail, canvas }`, filtered by the query. */
export function canvasMentionItems(canvases = [], query = "", limit = 6) {
  const raw = String(query || "").toLowerCase();
  const needle = raw.startsWith(CANVAS_MENTION_PREFIX) ? raw.slice(CANVAS_MENTION_PREFIX.length) : "";
  const filtered = canvases.filter((canvas) => {
    if (!needle) return true;
    const slug = canvasSlug(canvas.title);
    return slug.includes(needle) || String(canvas.title || "").toLowerCase().includes(needle);
  });
  return filtered.slice(0, limit).map((canvas) => ({
    id: `canvas:${canvas.id}`,
    token: canvasMentionToken(canvas),
    label: canvas.title || "Untitled canvas",
    detail: canvas.ownerType === "channel" ? "Channel canvas" : "Canvas",
    canvas,
  }));
}

/** Canvases whose slug is mentioned in the prompt; the first match wins for duplicate titles. */
export function mentionedCanvases(text, canvases = []) {
  const slugs = canvasMentions(text);
  if (!slugs.length) return [];
  const found = [];
  for (const slug of slugs) {
    const canvas = canvases.find((item) => canvasSlug(item.title) === slug);
    if (canvas && !found.includes(canvas)) found.push(canvas);
  }
  return found;
}

/** Remove `@canvas:slug` tokens, keeping the surrounding spacing tidy. */
export function stripCanvasMentions(text) {
  return String(text || "").replace(MENTION_PATTERN, "$1").replace(/[ \t]{2,}/g, " ").trim();
}

/**
 * The text attached to a prompt for one canvas. When `path` is present (the
 * canvas was materialized for this run) the member is told to edit the file;
 * otherwise the body is inlined as read-only context.
 */
export function canvasAttachmentText(canvas, { path = "" } = {}) {
  const title = canvas?.title || "Untitled canvas";
  const body = String(canvas?.body || "");
  const clipped = body.length > MAX_ATTACH_CHARS ? `${body.slice(0, MAX_ATTACH_CHARS)}\n…` : body;
  if (path) {
    return [
      `Canvas "${title}" is the file ${path}.`,
      "Edit that file in place to change the canvas; the bridge records your edit as a revision attributed to you.",
    ].join(" ");
  }
  return [`Canvas "${title}":`, "", "```markdown", clipped, "```"].join("\n");
}

/**
 * Expand canvas mentions into an attached context block. Returns the prompt
 * with tokens removed plus the canvases matched, so the caller can also pass
 * `canvasId` on the run payload for the first one.
 */
export function expandCanvasMentions(text, canvases = [], { paths = {} } = {}) {
  const matched = mentionedCanvases(text, canvases);
  if (!matched.length) return { prompt: String(text || ""), canvases: [] };
  const cleaned = stripCanvasMentions(text);
  const attachments = matched.map((canvas) => canvasAttachmentText(canvas, { path: paths[canvas.id] || "" }));
  return { prompt: `${cleaned}\n\n${attachments.join("\n\n")}`.trim(), canvases: matched };
}

/** Sentence for the revision rail: who and what. */
export function revisionAuthorName(revision, members = [], userLabel = "You") {
  const authorId = String(revision?.authorId || "");
  if (!authorId || authorId === "user") return userLabel;
  const member = members.find((item) => item.id === authorId);
  return member?.name || authorId;
}

/** True when a revision was written by a squad member rather than the user. */
export function isMemberRevision(revision) {
  const authorId = String(revision?.authorId || "");
  return Boolean(authorId) && authorId !== "user";
}
