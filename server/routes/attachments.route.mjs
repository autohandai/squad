// Media attachments (issue #32): raw-binary upload with a size cap, byte-range
// serving for video, and JPEG frame extraction through ffmpeg when it is on
// PATH. Files live under `<squadStateDir>/attachments/<id>.<ext>` beside a
// sidecar `<id>.json` with the probed metadata. No multipart dependency: the
// client PUTs the bytes as the body with `x-file-name` and `content-type`.
//
//   POST   /api/attachments                → { id, kind, name, mime, size, width, height, durationMs, createdAt, path, url }
//   GET    /api/attachments/:id            → the bytes (Range aware)
//   GET    /api/attachments/:id/meta       → the sidecar
//   GET    /api/attachments/:id/frame?t=   → image/jpeg (cached); `&as=json` → { id, t, path, url }
//   DELETE /api/attachments/:id            → { id, deleted: true }

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { promisify } from "node:util";

export const name = "attachments";

export const ATTACHMENT_LIMIT_BYTES = 25 * 1024 * 1024;
const LIMIT_LABEL = "25 MB";
const ID_RE = /^[a-z0-9]{12,32}$/;
const PROBE_TIMEOUT_MS = 8000;
const FRAME_TIMEOUT_MS = 20000;

const run = promisify(execFile);

const MIME_EXTENSIONS = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/x-matroska": "mkv",
  "text/plain": "txt",
  "application/pdf": "pdf",
  "application/json": "json",
};

// ffmpeg / ffprobe availability is probed once per process. Set
// AUTOHAND_FFMPEG=off to pretend neither exists (used by the check script).
const tools = { ffmpeg: undefined, ffprobe: undefined };

export function resetToolCache() {
  tools.ffmpeg = undefined;
  tools.ffprobe = undefined;
}

async function toolAvailable(tool) {
  if (tools[tool] !== undefined) return tools[tool];
  if (String(process.env.AUTOHAND_FFMPEG || "").toLowerCase() === "off") {
    tools[tool] = false;
    return false;
  }
  try {
    await run(tool, ["-version"], { timeout: 4000, windowsHide: true });
    tools[tool] = true;
  } catch {
    tools[tool] = false;
  }
  return tools[tool];
}

function attachmentsDir(ctx) {
  return join(ctx.squadStateDir, "attachments");
}

function framesDir(ctx) {
  return join(attachmentsDir(ctx), "frames");
}

function kindOf(mime) {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "file";
}

function safeName(raw) {
  let value = "";
  try {
    value = decodeURIComponent(String(raw || ""));
  } catch {
    value = String(raw || "");
  }
  value = basename(value.replace(/\\/g, "/")).replace(/[\u0000-\u001f\u007f"]/g, "").trim();
  return value.slice(0, 180);
}

function extensionFor(fileName, mime) {
  const fromName = extname(fileName).slice(1).toLowerCase();
  if (/^[a-z0-9]{1,8}$/.test(fromName)) return fromName;
  return MIME_EXTENSIONS[mime] || "bin";
}

function newId() {
  return `${Date.now().toString(36)}${randomBytes(6).toString("hex")}`;
}

function sendJson(res, status, payload, extra = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    ...extra,
  });
  res.end(body);
}

function notFound(ctx, res, error = "Attachment not found") {
  ctx.json(res, 404, { success: false, error });
  return true;
}

// Read the raw body up to the cap. On overflow the 413 goes out immediately
// while the rest of the upload is drained (without `connection: close`), so
// the client sees the message instead of a reset socket.
function readBinaryBody(req, res, limit) {
  return new Promise((resolve) => {
    const declared = Number(req.headers["content-length"] || 0);
    const tooLarge = () => {
      sendJson(res, 413, { success: false, error: `Attachment is larger than ${LIMIT_LABEL}. Trim it or pick a smaller file.` });
      req.resume();
      resolve(null);
    };
    if (declared > limit) {
      tooLarge();
      return;
    }
    const chunks = [];
    let bytes = 0;
    let overflow = false;
    req.on("data", (chunk) => {
      if (overflow) return;
      bytes += chunk.length;
      if (bytes > limit) {
        overflow = true;
        chunks.length = 0;
        tooLarge();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!overflow) resolve(Buffer.concat(chunks));
    });
    req.on("error", () => {
      if (!overflow) resolve(null);
    });
  });
}

async function probe(filePath, kind) {
  const empty = { width: null, height: null, durationMs: null };
  if (kind === "file" || !(await toolAvailable("ffprobe"))) return empty;
  try {
    const { stdout } = await run(
      "ffprobe",
      ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", filePath],
      { timeout: PROBE_TIMEOUT_MS, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }
    );
    const info = JSON.parse(stdout || "{}");
    const stream = (info.streams || []).find((item) => item.codec_type === "video") || (info.streams || [])[0] || {};
    const width = Number(stream.width);
    const height = Number(stream.height);
    const seconds = Number(info.format?.duration ?? stream.duration);
    return {
      width: Number.isFinite(width) && width > 0 ? width : null,
      height: Number.isFinite(height) && height > 0 ? height : null,
      durationMs: kind === "video" && Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null,
    };
  } catch {
    return empty;
  }
}

async function readSidecar(ctx, id) {
  if (!ID_RE.test(id)) return null;
  return ctx.readOptionalJsonFile(join(attachmentsDir(ctx), `${id}.json`));
}

function publicRecord(ctx, meta) {
  return { ...meta, path: join(attachmentsDir(ctx), `${meta.id}.${meta.ext}`), url: `/api/attachments/${meta.id}` };
}

async function handleUpload(req, res, ctx) {
  const fileName = safeName(req.headers["x-file-name"]);
  if (!fileName) {
    ctx.json(res, 400, { success: false, error: "Send the file name in the x-file-name header." });
    return true;
  }
  const mime = String(req.headers["content-type"] || "application/octet-stream").split(";")[0].trim().toLowerCase() || "application/octet-stream";
  const body = await readBinaryBody(req, res, ATTACHMENT_LIMIT_BYTES);
  if (!body) return true;
  if (!body.length) {
    ctx.json(res, 400, { success: false, error: "The attachment is empty." });
    return true;
  }
  const id = newId();
  const ext = extensionFor(fileName, mime);
  const kind = kindOf(mime);
  const dir = attachmentsDir(ctx);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${id}.${ext}`);
  await writeFile(filePath, body);
  const probed = await probe(filePath, kind);
  const meta = { id, kind, name: fileName, mime, ext, size: body.length, ...probed, createdAt: new Date().toISOString() };
  await ctx.writeJsonFile(join(dir, `${id}.json`), meta);
  ctx.logEvent?.(ctx.SEVERITY?.INFO, "attachment stored", { id, kind, mime, size: body.length });
  ctx.json(res, 200, { success: true, data: publicRecord(ctx, meta) });
  return true;
}

function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header || "").trim());
  if (!match) return null;
  const [, startRaw, endRaw] = match;
  if (!startRaw && !endRaw) return { invalid: true };
  let start;
  let end;
  if (!startRaw) {
    const suffix = Number(endRaw);
    if (!suffix) return { invalid: true };
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startRaw);
    end = endRaw ? Math.min(Number(endRaw), size - 1) : size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return { invalid: true };
  return { start, end };
}

async function serveFile(req, res, { filePath, mime, fileName, cacheControl }) {
  let info;
  try {
    info = await stat(filePath);
  } catch {
    return false;
  }
  const size = info.size;
  const headers = {
    "content-type": mime,
    "accept-ranges": "bytes",
    "cache-control": cacheControl,
    "last-modified": info.mtime.toUTCString(),
    "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  };
  const range = req.headers.range ? parseRange(req.headers.range, size) : null;
  if (range?.invalid) {
    res.writeHead(416, { ...headers, "content-range": `bytes */${size}` });
    res.end();
    return true;
  }
  if (req.method === "HEAD") {
    res.writeHead(200, { ...headers, "content-length": size });
    res.end();
    return true;
  }
  if (range) {
    const length = range.end - range.start + 1;
    res.writeHead(206, { ...headers, "content-length": length, "content-range": `bytes ${range.start}-${range.end}/${size}` });
    createReadStream(filePath, { start: range.start, end: range.end }).pipe(res);
    return true;
  }
  res.writeHead(200, { ...headers, "content-length": size });
  createReadStream(filePath).pipe(res);
  return true;
}

async function handleFrame(req, res, url, ctx, meta) {
  if (meta.kind !== "video") {
    ctx.json(res, 400, { success: false, error: "Frames can only be extracted from a video." });
    return true;
  }
  const t = Number(url.searchParams.get("t"));
  if (!Number.isFinite(t) || t < 0) {
    ctx.json(res, 400, { success: false, error: "Pass the timestamp in seconds as ?t=" });
    return true;
  }
  if (!(await toolAvailable("ffmpeg"))) {
    ctx.json(res, 404, { success: false, error: "ffmpeg not available" });
    return true;
  }
  const seconds = Math.round(t * 100) / 100;
  const framePath = join(framesDir(ctx), `${meta.id}-${Math.round(seconds * 1000)}.jpg`);
  let cached = false;
  try {
    cached = (await stat(framePath)).size > 0;
  } catch {
    cached = false;
  }
  if (!cached) {
    await mkdir(framesDir(ctx), { recursive: true });
    const source = join(attachmentsDir(ctx), `${meta.id}.${meta.ext}`);
    try {
      await run(
        "ffmpeg",
        ["-y", "-v", "error", "-ss", String(seconds), "-i", source, "-frames:v", "1", "-q:v", "3", "-f", "image2", framePath],
        { timeout: FRAME_TIMEOUT_MS, windowsHide: true }
      );
      await stat(framePath);
    } catch (error) {
      await rm(framePath, { force: true }).catch(() => {});
      ctx.logEvent?.(ctx.SEVERITY?.WARN, "frame extraction failed", { id: meta.id, t: seconds, error: String(error?.message || error) });
      ctx.json(res, 422, { success: false, error: `Could not extract a frame at ${seconds}s.` });
      return true;
    }
  }
  const frameUrl = `/api/attachments/${meta.id}/frame?t=${seconds}`;
  if (url.searchParams.get("as") === "json") {
    ctx.json(res, 200, { success: true, data: { id: meta.id, t: seconds, path: framePath, url: frameUrl, cached } });
    return true;
  }
  return serveFile(req, res, {
    filePath: framePath,
    mime: "image/jpeg",
    fileName: `${meta.name.replace(/\.[^.]+$/, "")}-${Math.round(seconds * 1000)}ms.jpg`,
    cacheControl: "private, max-age=31536000, immutable",
  });
}

async function handleDelete(res, ctx, meta) {
  const dir = attachmentsDir(ctx);
  await rm(join(dir, `${meta.id}.${meta.ext}`), { force: true });
  await rm(join(dir, `${meta.id}.json`), { force: true });
  try {
    const frames = (await readdir(framesDir(ctx))).filter((entry) => entry.startsWith(`${meta.id}-`));
    await Promise.all(frames.map((entry) => rm(join(framesDir(ctx), entry), { force: true })));
  } catch {
    // no frames directory yet
  }
  ctx.json(res, 200, { success: true, data: { id: meta.id, deleted: true } });
  return true;
}

export async function handle(req, res, url, ctx) {
  if (!url.pathname.startsWith("/api/attachments")) return false;

  if (url.pathname === "/api/attachments" && (req.method === "POST" || req.method === "PUT")) {
    return handleUpload(req, res, ctx);
  }

  const match = /^\/api\/attachments\/([^/]+)(?:\/(meta|frame))?$/.exec(url.pathname);
  if (!match) return false;
  const [, id, sub] = match;
  if (!ID_RE.test(id)) return notFound(ctx, res);
  const meta = await readSidecar(ctx, id);
  if (!meta) return notFound(ctx, res);

  if (sub === "meta" && req.method === "GET") {
    ctx.json(res, 200, { success: true, data: publicRecord(ctx, meta) });
    return true;
  }
  if (sub === "frame" && req.method === "GET") {
    return handleFrame(req, res, url, ctx, meta);
  }
  if (!sub && (req.method === "GET" || req.method === "HEAD")) {
    const served = await serveFile(req, res, {
      filePath: join(attachmentsDir(ctx), `${meta.id}.${meta.ext}`),
      mime: meta.mime || "application/octet-stream",
      fileName: meta.name,
      cacheControl: "private, max-age=31536000, immutable",
    });
    return served || notFound(ctx, res);
  }
  if (!sub && req.method === "DELETE") {
    return handleDelete(res, ctx, meta);
  }
  return false;
}
