#!/usr/bin/env node
// Checks for media attachments (server/routes/attachments.route.mjs) and
// frame anchors (src/lib/anchors.js). Mounts the route plug-in on a loopback
// http server with a scratch state dir, uploads a 1×1 PNG and a tiny MP4,
// then verifies the size cap, sidecar metadata, Range responses, frame
// extraction (asserted only when ffmpeg is on PATH) and the ffmpeg-missing
// 404 message. Finishes with the pure anchor helpers. No network beyond
// loopback.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { deflateSync } from "node:zlib";

import { ATTACHMENT_LIMIT_BYTES, handle, resetToolCache } from "../server/routes/attachments.route.mjs";
import {
  anchorContextText,
  anchorLabel,
  anchorToken,
  anchorsFromDraft,
  appendAnchorToken,
  formatTimestamp,
  frameKey,
  frameUrl,
  messageMediaContext,
  normalizeAnchor,
  normalizeAnchors,
  normalizeAttachment,
  normalizeBox,
  parseAnchorTokens,
  removeAnchorToken,
  stripAnchorTokens,
} from "../src/lib/anchors.js";

const run = promisify(execFile);

// ---- fixtures -------------------------------------------------------------

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

// A valid 1×1 opaque red PNG, written from bytes.
function tinyPng() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const raw = Buffer.from([0, 255, 0, 0]); // filter byte + RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function mp4Box(type, payload) {
  const size = Buffer.alloc(4);
  size.writeUInt32BE(8 + payload.length);
  return Buffer.concat([size, Buffer.from(type, "ascii"), payload]);
}

// A structurally valid but empty MP4 (ftyp + free + mdat) written from bytes;
// enough for the upload, sidecar and Range checks when ffmpeg is unavailable.
function stubMp4() {
  const ftyp = mp4Box("ftyp", Buffer.concat([Buffer.from("isom", "ascii"), Buffer.from([0, 0, 2, 0]), Buffer.from("isomiso2mp41", "ascii")]));
  const free = mp4Box("free", Buffer.alloc(16, 0));
  const mdat = mp4Box("mdat", Buffer.from("squad-check-attachments-stub-payload-0123456789", "ascii"));
  return Buffer.concat([ftyp, free, mdat]);
}

async function hasTool(tool) {
  if (String(process.env.AUTOHAND_FFMPEG || "").toLowerCase() === "off") return false;
  try {
    await run(tool, ["-version"], { timeout: 4000 });
    return true;
  } catch {
    return false;
  }
}

// A real 1-second 32×32 video when ffmpeg exists, else the byte stub.
async function tinyMp4(dir) {
  if (!(await hasTool("ffmpeg"))) return { bytes: stubMp4(), real: false };
  const out = join(dir, "fixture.mp4");
  try {
    await run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=red:s=32x32:r=10:d=1", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], { timeout: 20000 });
    return { bytes: await readFile(out), real: true };
  } catch {
    return { bytes: stubMp4(), real: false };
  }
}

// ---- bridge stand-in ------------------------------------------------------

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "content-length": Buffer.byteLength(body), connection: "close" });
  res.end(body);
}

function makeContext(squadStateDir) {
  const logs = [];
  return {
    squadStateDir,
    json,
    logEvent: (severity, message, attributes) => logs.push({ severity, message, attributes }),
    SEVERITY: { DEBUG: 5, INFO: 9, WARN: 13, ERROR: 17 },
    readOptionalJsonFile: async (path) => {
      try {
        return JSON.parse(await readFile(path, "utf8"));
      } catch {
        return null;
      }
    },
    writeJsonFile: async (path, data) => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    },
    logs,
  };
}

async function listen(ctx) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    try {
      const handled = await handle(req, res, url, ctx);
      if (!handled) json(res, 404, { success: false, error: "no route" });
    } catch (error) {
      json(res, 500, { success: false, error: String(error?.stack || error) });
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function upload(base, name, type, bytes) {
  const response = await fetch(`${base}/api/attachments`, { method: "POST", headers: { "x-file-name": name, "content-type": type }, body: bytes });
  return { status: response.status, body: await response.json() };
}

// ---- route checks ---------------------------------------------------------

const root = await mkdtemp(join(tmpdir(), "squad-attachments-"));
const ctx = makeContext(join(root, "state"));
const { server, base } = await listen(ctx);
try {
  const ffmpeg = await hasTool("ffmpeg");
  const ffprobe = await hasTool("ffprobe");
  console.log(`ffmpeg: ${ffmpeg ? "found" : "not on PATH"} · ffprobe: ${ffprobe ? "found" : "not on PATH"}`);

  // Upload a PNG: kind, size, probed dimensions, sidecar on disk.
  const png = tinyPng();
  const image = await upload(base, "dot.png", "image/png", png);
  assert.equal(image.status, 200, JSON.stringify(image.body));
  assert.equal(image.body.success, true);
  const imageMeta = image.body.data;
  assert.match(imageMeta.id, /^[a-z0-9]{12,32}$/);
  assert.equal(imageMeta.kind, "image");
  assert.equal(imageMeta.name, "dot.png");
  assert.equal(imageMeta.mime, "image/png");
  assert.equal(imageMeta.size, png.length);
  assert.equal(imageMeta.url, `/api/attachments/${imageMeta.id}`);
  assert.equal(imageMeta.path, join(ctx.squadStateDir, "attachments", `${imageMeta.id}.png`));
  assert.equal(imageMeta.durationMs, null, "images have no duration");
  if (ffprobe) {
    assert.equal(imageMeta.width, 1, "probed width");
    assert.equal(imageMeta.height, 1, "probed height");
  } else {
    assert.equal(imageMeta.width, null);
    assert.equal(imageMeta.height, null);
  }
  assert.ok(Date.parse(imageMeta.createdAt) > 0, "createdAt is ISO");
  const sidecar = JSON.parse(await readFile(join(ctx.squadStateDir, "attachments", `${imageMeta.id}.json`), "utf8"));
  for (const key of ["id", "kind", "name", "mime", "size", "width", "height", "durationMs", "createdAt"]) {
    assert.ok(key in sidecar, `sidecar has ${key}`);
    assert.deepEqual(sidecar[key], imageMeta[key], `sidecar ${key} matches the response`);
  }
  assert.equal((await stat(imageMeta.path)).size, png.length, "bytes on disk");

  // Serve it back whole.
  const served = await fetch(`${base}/api/attachments/${imageMeta.id}`);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("content-type"), "image/png");
  assert.equal(served.headers.get("accept-ranges"), "bytes");
  assert.ok(Buffer.from(await served.arrayBuffer()).equals(png), "served bytes match");
  const meta = await (await fetch(`${base}/api/attachments/${imageMeta.id}/meta`)).json();
  assert.equal(meta.data.id, imageMeta.id);

  // A frame from an image is refused with a clear message.
  const imageFrame = await fetch(`${base}/api/attachments/${imageMeta.id}/frame?t=0`);
  assert.equal(imageFrame.status, 400);
  assert.match((await imageFrame.json()).error, /video/i);

  // Upload a video: kind, duration when probed, Range responses.
  const { bytes: mp4, real } = await tinyMp4(root);
  const video = await upload(base, "clip.mp4", "video/mp4", mp4);
  assert.equal(video.status, 200, JSON.stringify(video.body));
  const videoMeta = video.body.data;
  assert.equal(videoMeta.kind, "video");
  assert.equal(videoMeta.size, mp4.length);
  if (real && ffprobe) {
    assert.equal(videoMeta.width, 32);
    assert.equal(videoMeta.height, 32);
    assert.ok(videoMeta.durationMs >= 900 && videoMeta.durationMs <= 1100, `durationMs ≈ 1000, got ${videoMeta.durationMs}`);
  }

  const head = await fetch(`${base}/api/attachments/${videoMeta.id}`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get("content-length")), mp4.length);

  const first = await fetch(`${base}/api/attachments/${videoMeta.id}`, { headers: { range: "bytes=0-3" } });
  assert.equal(first.status, 206);
  assert.equal(first.headers.get("content-range"), `bytes 0-3/${mp4.length}`);
  assert.equal(first.headers.get("content-length"), "4");
  assert.ok(Buffer.from(await first.arrayBuffer()).equals(mp4.subarray(0, 4)), "first range bytes");

  const tail = await fetch(`${base}/api/attachments/${videoMeta.id}`, { headers: { range: `bytes=${mp4.length - 5}-` } });
  assert.equal(tail.status, 206);
  assert.equal(tail.headers.get("content-range"), `bytes ${mp4.length - 5}-${mp4.length - 1}/${mp4.length}`);
  assert.ok(Buffer.from(await tail.arrayBuffer()).equals(mp4.subarray(mp4.length - 5)), "tail range bytes");

  const suffix = await fetch(`${base}/api/attachments/${videoMeta.id}`, { headers: { range: "bytes=-3" } });
  assert.equal(suffix.status, 206);
  assert.ok(Buffer.from(await suffix.arrayBuffer()).equals(mp4.subarray(mp4.length - 3)), "suffix range bytes");

  const open = await fetch(`${base}/api/attachments/${videoMeta.id}`, { headers: { range: "bytes=4-1" } });
  assert.equal(open.status, 416);
  assert.equal(open.headers.get("content-range"), `bytes */${mp4.length}`);
  const beyond = await fetch(`${base}/api/attachments/${videoMeta.id}`, { headers: { range: `bytes=${mp4.length + 10}-` } });
  assert.equal(beyond.status, 416);

  // Frame extraction: asserted when ffmpeg exists, cached on the second call.
  const badT = await fetch(`${base}/api/attachments/${videoMeta.id}/frame?t=abc`);
  assert.equal(badT.status, 400);
  if (ffmpeg && real) {
    const frame = await fetch(`${base}/api/attachments/${videoMeta.id}/frame?t=0.5`);
    if (frame.status !== 200) assert.fail(`frame extraction failed: ${frame.status} ${await frame.text()}`);
    assert.equal(frame.headers.get("content-type"), "image/jpeg");
    const jpeg = Buffer.from(await frame.arrayBuffer());
    assert.deepEqual([...jpeg.subarray(0, 3)], [0xff, 0xd8, 0xff], "JPEG magic");
    const asJson = await (await fetch(`${base}/api/attachments/${videoMeta.id}/frame?t=0.5&as=json`)).json();
    assert.equal(asJson.success, true);
    assert.equal(asJson.data.t, 0.5);
    assert.equal(asJson.data.cached, true, "second request hits the cache");
    assert.equal(asJson.data.path, join(ctx.squadStateDir, "attachments", "frames", `${videoMeta.id}-500.jpg`));
    assert.equal(asJson.data.url, `/api/attachments/${videoMeta.id}/frame?t=0.5`);
    assert.ok((await stat(asJson.data.path)).size > 0, "frame cached on disk");
  } else {
    console.log("ffmpeg unavailable: skipping frame extraction assertions");
  }

  // Without ffmpeg the frame endpoint says so, with the agreed message.
  process.env.AUTOHAND_FFMPEG = "off";
  resetToolCache();
  const missing = await fetch(`${base}/api/attachments/${videoMeta.id}/frame?t=0.2`);
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { success: false, error: "ffmpeg not available" });
  delete process.env.AUTOHAND_FFMPEG;
  resetToolCache();

  // Size cap: one byte over the limit is rejected with a clear message, both
  // when content-length says so and when the body simply keeps coming.
  const oversized = Buffer.alloc(ATTACHMENT_LIMIT_BYTES + 1, 1);
  const rejected = await upload(base, "big.bin", "application/octet-stream", oversized);
  assert.equal(rejected.status, 413);
  assert.equal(rejected.body.success, false);
  assert.match(rejected.body.error, /25 MB/);
  const chunked = await fetch(`${base}/api/attachments`, {
    method: "POST",
    headers: { "x-file-name": "big.bin", "content-type": "application/octet-stream" },
    body: new ReadableStream({
      start(controller) {
        const chunk = Buffer.alloc(1024 * 1024, 2);
        for (let index = 0; index < 26; index += 1) controller.enqueue(chunk);
        controller.close();
      },
    }),
    duplex: "half",
  });
  assert.equal(chunked.status, 413);
  assert.match((await chunked.json()).error, /25 MB/);
  const exact = await upload(base, "edge.bin", "application/octet-stream", Buffer.alloc(ATTACHMENT_LIMIT_BYTES, 3));
  assert.equal(exact.status, 200, "exactly the limit is accepted");
  assert.equal(exact.body.data.kind, "file");

  // Validation and unknown ids.
  const unnamed = await fetch(`${base}/api/attachments`, { method: "POST", headers: { "content-type": "image/png" }, body: png });
  assert.equal(unnamed.status, 400);
  assert.match((await unnamed.json()).error, /x-file-name/);
  const empty = await upload(base, "empty.png", "image/png", Buffer.alloc(0));
  assert.equal(empty.status, 400);
  assert.equal((await fetch(`${base}/api/attachments/nope`)).status, 404);
  assert.equal((await fetch(`${base}/api/attachments/..%2F..%2Fconfig.json`)).status, 404);
  assert.equal((await fetch(`${base}/api/attachments/zzzzzzzzzzzzzzzz`)).status, 404);
  const traversal = await upload(base, "../../escape.png", "image/png", png);
  assert.equal(traversal.status, 200);
  assert.equal(traversal.body.data.name, "escape.png", "path segments are stripped from the name");

  // Delete removes the file, sidecar and cached frames.
  const deleted = await fetch(`${base}/api/attachments/${videoMeta.id}`, { method: "DELETE" });
  assert.equal(deleted.status, 200);
  assert.deepEqual((await deleted.json()).data, { id: videoMeta.id, deleted: true });
  assert.equal((await fetch(`${base}/api/attachments/${videoMeta.id}`)).status, 404);
  await assert.rejects(stat(videoMeta.path), "video file removed");
  await assert.rejects(stat(join(ctx.squadStateDir, "attachments", `${videoMeta.id}.json`)), "sidecar removed");
  await assert.rejects(stat(join(ctx.squadStateDir, "attachments", "frames", `${videoMeta.id}-500.jpg`)), "frames removed");
  assert.ok(ctx.logs.some((entry) => entry.message === "attachment stored"), "upload is logged");
  console.log("attachments route: ok");
} finally {
  server.close();
  await rm(root, { recursive: true, force: true });
}

// ---- pure anchor helpers --------------------------------------------------

assert.equal(formatTimestamp(0), "0:00");
assert.equal(formatTimestamp(12.4), "0:12");
assert.equal(formatTimestamp(65), "1:05");
assert.equal(formatTimestamp(3723), "1:02:03");

assert.equal(anchorLabel({ t: 12.4 }), "0:12");
assert.equal(anchorLabel({ t: 12.4, box: [0.1, 0.2, 0.3, 0.4] }), "0:12 · region");
assert.equal(anchorLabel({ box: [0.1, 0.2, 0.3, 0.4] }), "region");
assert.equal(anchorLabel({}), "");
assert.equal(anchorLabel({ t: 5, box: [0, 0, 1, 1] }, "área"), "0:05 · área");

assert.deepEqual(normalizeBox([0.1, 0.2, 0.3, 0.4]), [0.1, 0.2, 0.3, 0.4]);
assert.deepEqual(normalizeBox("0.5,0.5,0.9,0.9"), [0.5, 0.5, 0.5, 0.5], "clamped to the frame");
assert.deepEqual(normalizeBox([0.6, 0.6, -0.2, -0.2]), [0.4, 0.4, 0.2, 0.2], "negative sizes flip");
assert.equal(normalizeBox([0.1, 0.2, 0, 0.4]), null, "zero width is no region");
assert.equal(normalizeBox([1, 2, 3]), null);
assert.equal(normalizeBox("x,y,w,h"), null);

assert.deepEqual(normalizeAnchor({ attachmentId: "abc123def456", t: "12.4", box: "0.1,0.2,0.3,0.4" }), { attachmentId: "abc123def456", t: 12.4, box: [0.1, 0.2, 0.3, 0.4] });
assert.deepEqual(normalizeAnchor({ attachmentId: "abc123def456", t: 7 }), { attachmentId: "abc123def456", t: 7, box: null });
assert.equal(normalizeAnchor({ attachmentId: "abc123def456" }), null, "no t and no box is not an anchor");
assert.equal(normalizeAnchor({ attachmentId: "", t: 1 }), null);
assert.equal(normalizeAnchor({ attachmentId: "abc123def456", t: -1 }), null);
assert.deepEqual(normalizeAnchors([{ attachmentId: "abc123def456", t: 1 }, null, { attachmentId: "x" }]), [{ attachmentId: "abc123def456", t: 1, box: null }]);

const file = normalizeAttachment({ id: "abc123def456", name: "clip.mp4", mime: "video/mp4", size: "1024", width: 1280, height: 720, durationMs: 32000, path: "/state/attachments/abc123def456.mp4" });
assert.equal(file.kind, "video", "kind derived from mime");
assert.equal(file.size, 1024);
assert.equal(file.url, "/api/attachments/abc123def456");
assert.equal(normalizeAttachment({ id: "abc123def456", mime: "image/png", width: "0" }).width, null);
assert.equal(normalizeAttachment({ name: "no-id.png" }), null);
assert.equal(normalizeAttachment({ id: "abc123def456", mime: "application/pdf" }).kind, "file");

const token = anchorToken({ attachmentId: "abc123def456", t: 12.4, box: [0.1, 0.2, 0.3, 0.4] });
assert.equal(token, "[[anchor:abc123def456:t=12.4:box=0.1,0.2,0.3,0.4]]");
assert.equal(anchorToken({ attachmentId: "abc123def456", t: 3 }), "[[anchor:abc123def456:t=3]]");
assert.equal(anchorToken({ attachmentId: "abc123def456", box: [0, 0, 0.5, 0.5] }), "[[anchor:abc123def456:box=0,0,0.5,0.5]]");
assert.equal(anchorToken({ attachmentId: "abc123def456" }), "");

const draft = `Noah, the button at 0:12 is misaligned ${token} and the logo [[anchor:img000000001:box=0.5,0.5,0.25,0.25]] too`;
const parsed = parseAnchorTokens(draft);
assert.equal(parsed.length, 2);
assert.deepEqual({ attachmentId: parsed[0].attachmentId, t: parsed[0].t, box: parsed[0].box }, { attachmentId: "abc123def456", t: 12.4, box: [0.1, 0.2, 0.3, 0.4] });
assert.equal(parsed[0].raw, token);
assert.equal(parsed[0].index, draft.indexOf(token));
assert.deepEqual(parsed[1].box, [0.5, 0.5, 0.25, 0.25]);
assert.equal(parsed[1].t, null);
assert.equal(stripAnchorTokens(draft), "Noah, the button at 0:12 is misaligned and the logo too");
assert.equal(parseAnchorTokens("[[anchor:abc123def456]] [[anchor:abc123def456:t=x]]").length, 0, "tokens without a usable t or box are ignored");
assert.deepEqual(anchorsFromDraft(draft), {
  prompt: "Noah, the button at 0:12 is misaligned and the logo too",
  anchors: [
    { attachmentId: "abc123def456", t: 12.4, box: [0.1, 0.2, 0.3, 0.4] },
    { attachmentId: "img000000001", t: null, box: [0.5, 0.5, 0.25, 0.25] },
  ],
});
assert.equal(removeAnchorToken(draft, token), "Noah, the button at 0:12 is misaligned and the logo [[anchor:img000000001:box=0.5,0.5,0.25,0.25]] too");
assert.equal(removeAnchorToken("hello", "[[anchor:nope]]"), "hello");
assert.equal(appendAnchorToken("look here", { attachmentId: "abc123def456", t: 2 }), "look here [[anchor:abc123def456:t=2]]");
assert.equal(appendAnchorToken("", { attachmentId: "abc123def456", t: 2 }), "[[anchor:abc123def456:t=2]]");
assert.equal(appendAnchorToken("a [[anchor:abc123def456:t=2]]", { attachmentId: "abc123def456", t: 2 }), "a [[anchor:abc123def456:t=2]]", "no duplicate tokens");

const context = anchorContextText(file, { attachmentId: "abc123def456", t: 12.4, box: [0.1, 0.2, 0.3, 0.4] }, { framePath: "/state/attachments/frames/abc123def456-12400.jpg" });
assert.equal(
  context,
  [
    '<anchor attachment="abc123def456">',
    "file: clip.mp4 (video, 1280×720, 0:32)",
    "path: /state/attachments/abc123def456.mp4",
    "timestamp: 0:12 (12.4s)",
    "region: x=0.1 y=0.2 w=0.3 h=0.4 (fractions of width/height, top-left origin)",
    "region_px: x=128 y=144 w=384 h=288",
    "frame: /state/attachments/frames/abc123def456-12400.jpg",
    "</anchor>",
  ].join("\n")
);
assert.equal(anchorContextText(file, { attachmentId: "abc123def456", t: 3 }).includes("region"), false);
assert.equal(anchorContextText(file, { attachmentId: "abc123def456", t: 3 }).includes("frame:"), false, "no frame line without a frame");
assert.equal(anchorContextText(file, { attachmentId: "abc123def456" }), "");
assert.equal(anchorContextText(null, { attachmentId: "abc123def456", t: 1 }), "");

const image = { id: "img000000001", kind: "image", name: "shot.png", mime: "image/png", size: 10, path: "/state/attachments/img000000001.png", width: 200, height: 100 };
const combined = messageMediaContext([file, image, { id: "doc000000001", kind: "file", name: "notes.pdf", mime: "application/pdf", path: "/state/attachments/doc000000001.pdf" }], [{ attachmentId: "abc123def456", t: 12.4 }], {
  framePaths: { "abc123def456@12.4": "/frames/a.jpg" },
});
assert.ok(combined.startsWith('<anchor attachment="abc123def456">'), "anchored files come first");
assert.ok(combined.includes("frame: /frames/a.jpg"), "frame path keyed by id@t");
assert.ok(combined.includes('<attachment id="img000000001" kind="image" name="shot.png" path="/state/attachments/img000000001.png" />'), "unanchored files are listed");
assert.ok(combined.includes('<attachment id="doc000000001" kind="file" name="notes.pdf"'), "non-media files are listed too");
assert.equal(messageMediaContext([], [{ attachmentId: "abc123def456", t: 1 }]), "");
assert.equal(frameKey({ attachmentId: "abc123def456", t: 12.4 }), "abc123def456@12.4");
assert.equal(frameKey({ attachmentId: "abc123def456", box: [0, 0, 1, 1] }), "");
assert.equal(frameUrl({ attachmentId: "abc123def456", t: 12.4 }), "/api/attachments/abc123def456/frame?t=12.4");
assert.equal(frameUrl({ attachmentId: "abc123def456", t: 12.4 }, { asJson: true }), "/api/attachments/abc123def456/frame?t=12.4&as=json");
assert.equal(frameUrl({ attachmentId: "abc123def456", box: [0, 0, 1, 1] }), "");

console.log("anchors: ok");
