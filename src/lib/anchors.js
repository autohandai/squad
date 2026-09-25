// Media attachments and frame anchors (issue #32). Pure: no React, no DOM,
// importable from Node checks.
//
// A message carries `attachments` (files stored by POST /api/attachments)
// and `anchors` (a timestamp and/or a normalized rectangle on one of them).
// While the user is still typing, a pending anchor lives inside the draft as
// a token — `[[anchor:<attachmentId>:t=12.4:box=0.1,0.2,0.3,0.4]]` — so the
// composer needs no extra state; the chip row is derived from the draft and
// removing a chip strips its token. On send the tokens become `anchors` and
// `anchorContextText` turns each anchor into structured prompt context.

export const ATTACHMENT_KINDS = ["image", "video", "file"];
export const ATTACHMENT_LIMIT_BYTES = 25 * 1024 * 1024;

const ID_RE = /^[A-Za-z0-9_-]{4,64}$/;
const TOKEN_RE = /\[\[anchor:([A-Za-z0-9_-]{4,64})((?::[a-z]+=[^\]:\s]*)*)\]\]/g;

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Attachment kind from a MIME type: image, video, or file. */
export function attachmentKind(mime = "") {
  const type = String(mime || "").toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  return "file";
}

/** Normalize one attachment record; null when it has no usable id. */
export function normalizeAttachment(input) {
  if (!input || typeof input !== "object") return null;
  const id = String(input.id || "").trim();
  if (!ID_RE.test(id)) return null;
  const mime = String(input.mime || input.type || "").trim().toLowerCase();
  const kind = ATTACHMENT_KINDS.includes(input.kind) ? input.kind : attachmentKind(mime);
  const width = finiteOrNull(input.width);
  const height = finiteOrNull(input.height);
  const durationMs = finiteOrNull(input.durationMs);
  return {
    id,
    kind,
    name: String(input.name || id).trim() || id,
    mime,
    size: Math.max(0, Math.round(finiteOrNull(input.size) ?? 0)),
    path: String(input.path || "").trim(),
    url: String(input.url || "").trim() || `/api/attachments/${id}`,
    width: width && width > 0 ? Math.round(width) : null,
    height: height && height > 0 ? Math.round(height) : null,
    durationMs: durationMs && durationMs > 0 ? Math.round(durationMs) : null,
    createdAt: String(input.createdAt || "").trim() || null,
  };
}

/** Normalize a message's attachments list (drops invalid entries). */
export function normalizeAttachments(list) {
  if (!Array.isArray(list)) return [];
  return list.map(normalizeAttachment).filter(Boolean);
}

/** Normalize a box to four clamped 0–1 numbers, or null when unusable. */
export function normalizeBox(box) {
  if (!box) return null;
  const parts = Array.isArray(box) ? box : String(box).split(",");
  if (parts.length !== 4) return null;
  const numbers = parts.map(finiteOrNull);
  if (numbers.some((value) => value === null)) return null;
  let [x, y, w, h] = numbers;
  if (w < 0) {
    x += w;
    w = -w;
  }
  if (h < 0) {
    y += h;
    h = -h;
  }
  x = clamp01(x);
  y = clamp01(y);
  w = clamp01(Math.min(w, 1 - x));
  h = clamp01(Math.min(h, 1 - y));
  if (w <= 0 || h <= 0) return null;
  return [round(x), round(y), round(w), round(h)];
}

/** Normalize one anchor; null when it points nowhere (no id, or no t and no box). */
export function normalizeAnchor(input) {
  if (!input || typeof input !== "object") return null;
  const attachmentId = String(input.attachmentId || input.id || "").trim();
  if (!ID_RE.test(attachmentId)) return null;
  const rawT = finiteOrNull(input.t);
  const t = rawT === null || rawT < 0 ? null : round(rawT, 2);
  const box = normalizeBox(input.box);
  if (t === null && !box) return null;
  return { attachmentId, t, box };
}

/** Normalize a message's anchors list (drops invalid entries). */
export function normalizeAnchors(list) {
  if (!Array.isArray(list)) return [];
  return list.map(normalizeAnchor).filter(Boolean);
}

/** "0:12", "1:05", "1:02:03" from seconds. */
export function formatTimestamp(seconds) {
  const total = Math.max(0, Math.floor(finiteOrNull(seconds) ?? 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/** Short human label: "0:12", "0:12 · region", or "region". */
export function anchorLabel({ t, box } = {}, regionWord = "region") {
  const parts = [];
  const seconds = finiteOrNull(t);
  if (seconds !== null && seconds >= 0) parts.push(formatTimestamp(seconds));
  if (normalizeBox(box)) parts.push(regionWord);
  return parts.join(" · ");
}

/** Composer token for a pending anchor. */
export function anchorToken(anchor) {
  const normalized = normalizeAnchor(anchor);
  if (!normalized) return "";
  const parts = [`anchor:${normalized.attachmentId}`];
  if (normalized.t !== null) parts.push(`t=${normalized.t}`);
  if (normalized.box) parts.push(`box=${normalized.box.join(",")}`);
  return `[[${parts.join(":")}]]`;
}

/** Every anchor token in a draft, in order, with its raw text and offset. */
export function parseAnchorTokens(text) {
  const value = String(text || "");
  const found = [];
  for (const match of value.matchAll(TOKEN_RE)) {
    const fields = {};
    for (const part of match[2].split(":").filter(Boolean)) {
      const eq = part.indexOf("=");
      if (eq > 0) fields[part.slice(0, eq)] = part.slice(eq + 1);
    }
    const anchor = normalizeAnchor({ attachmentId: match[1], t: fields.t, box: fields.box });
    if (anchor) found.push({ ...anchor, raw: match[0], index: match.index });
  }
  return found;
}

/** The draft without anchor tokens (surrounding whitespace collapsed). */
export function stripAnchorTokens(text) {
  return String(text || "")
    .replace(TOKEN_RE, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^[ \t]+|[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Remove one specific token (by raw text) from a draft. */
export function removeAnchorToken(text, raw) {
  const value = String(text || "");
  if (!raw) return value;
  const index = value.indexOf(raw);
  if (index < 0) return value;
  const before = value.slice(0, index).replace(/[ \t]+$/, "");
  const after = value.slice(index + raw.length).replace(/^[ \t]+/, "");
  return before && after && !/\s$/.test(before) && !/^\s/.test(after) ? `${before} ${after}` : `${before}${after}`;
}

/** Append a token to a draft with one separating space. */
export function appendAnchorToken(text, anchor) {
  const token = anchorToken(anchor);
  if (!token) return String(text || "");
  const value = String(text || "");
  if (value.includes(token)) return value;
  return value && !/\s$/.test(value) ? `${value} ${token}` : `${value}${token}`;
}

/** Split a draft into the prompt text and its anchors. */
export function anchorsFromDraft(text) {
  return { prompt: stripAnchorTokens(text), anchors: parseAnchorTokens(text).map(({ attachmentId, t, box }) => ({ attachmentId, t, box })) };
}

function describeMedia(attachment) {
  const bits = [attachment.kind];
  if (attachment.width && attachment.height) bits.push(`${attachment.width}×${attachment.height}`);
  if (attachment.durationMs) bits.push(formatTimestamp(attachment.durationMs / 1000));
  return bits.join(", ");
}

/**
 * Structured context appended to a member prompt for one anchor:
 * the file, its path on disk, the timestamp, the region (normalized,
 * top-left origin), and the extracted frame when ffmpeg produced one.
 */
export function anchorContextText(attachment, anchor, { framePath = "" } = {}) {
  const file = normalizeAttachment(attachment);
  const target = normalizeAnchor(anchor);
  if (!file || !target) return "";
  const lines = [`<anchor attachment="${file.id}">`, `file: ${file.name} (${describeMedia(file)})`];
  if (file.path) lines.push(`path: ${file.path}`);
  if (target.t !== null) lines.push(`timestamp: ${formatTimestamp(target.t)} (${target.t}s)`);
  if (target.box) {
    const [x, y, w, h] = target.box;
    lines.push(`region: x=${x} y=${y} w=${w} h=${h} (fractions of width/height, top-left origin)`);
    if (file.width && file.height) {
      lines.push(`region_px: x=${Math.round(x * file.width)} y=${Math.round(y * file.height)} w=${Math.round(w * file.width)} h=${Math.round(h * file.height)}`);
    }
  }
  if (framePath) lines.push(`frame: ${framePath}`);
  lines.push("</anchor>");
  return lines.join("\n");
}

/**
 * Context for a whole message: one block per anchor, then one line per
 * attachment nobody anchored so the member still knows it exists.
 * `framePaths` maps `${attachmentId}@${t}` → extracted frame path.
 */
export function messageMediaContext(attachments, anchors, { framePaths = {} } = {}) {
  const files = normalizeAttachments(attachments);
  const targets = normalizeAnchors(anchors);
  if (!files.length) return "";
  const byId = new Map(files.map((file) => [file.id, file]));
  const blocks = [];
  const anchored = new Set();
  for (const anchor of targets) {
    const file = byId.get(anchor.attachmentId);
    if (!file) continue;
    anchored.add(file.id);
    blocks.push(anchorContextText(file, anchor, { framePath: framePaths[frameKey(anchor)] || "" }));
  }
  for (const file of files) {
    if (anchored.has(file.id)) continue;
    blocks.push(`<attachment id="${file.id}" kind="${file.kind}" name="${file.name}"${file.path ? ` path="${file.path}"` : ""} />`);
  }
  return blocks.join("\n\n");
}

/** Cache key for an extracted frame: attachment id plus timestamp. */
export function frameKey(anchor) {
  const target = normalizeAnchor(anchor);
  if (!target || target.t === null) return "";
  return `${target.attachmentId}@${target.t}`;
}

/** Frame endpoint for an anchor with a timestamp; "" for boxes-only anchors. */
export function frameUrl(anchor, { asJson = false } = {}) {
  const target = normalizeAnchor(anchor);
  if (!target || target.t === null) return "";
  return `/api/attachments/${target.attachmentId}/frame?t=${target.t}${asJson ? "&as=json" : ""}`;
}
