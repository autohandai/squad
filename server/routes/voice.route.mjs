// Voice route plug-in (ADR-0276; replaces ADR-0101's ElevenLabs route).
//
//   GET /voice-engine/<file>     the vendored kale-tts-1 files (vendor/kale-tts) and
//                                /voice-engine/squad-worker.mjs, the page's reading worker
//   GET /api/voice/settings      { engine, model, available, voices: [{ id, name, gender, accent, description }] }
//
// Speech is made on this computer, in the page, from the bundled model; no text
// leaves the machine and there is no key to keep. An ElevenLabs key saved by an
// earlier version (<squadStateDir>/voice.json) is deleted on start.

import { readFile, rm, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { KALE_VOICES } from "../../src/lib/member-voice.js";

export const name = "voice";

const here = fileURLToPath(new URL(".", import.meta.url));
export const KALE_MODEL = "kale-tts-1-tiny";
const TYPES = { ".mjs": "text/javascript; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".wasm": "application/wasm", ".onnx": "application/octet-stream", ".bin": "application/octet-stream", ".tsv": "text/tab-separated-values; charset=utf-8", ".md": "text/markdown; charset=utf-8" };

export function kaleRoot() {
  return process.env.AUTOHAND_SQUAD_KALE_DIR ? resolve(process.env.AUTOHAND_SQUAD_KALE_DIR) : resolve(here, "..", "..", "vendor", "kale-tts");
}

/** The file a /voice-engine/ path names, never outside the engine folder. */
export function engineFile(pathname, root = kaleRoot()) {
  let relative = "";
  try { relative = decodeURIComponent(pathname.slice("/voice-engine/".length)); } catch { return ""; }
  if (relative === "squad-worker.mjs") return resolve(here, "..", "voice", "kale-worker.mjs");
  if (!relative || relative.includes("\0")) return "";
  const file = normalize(join(root, relative));
  return file.startsWith(root + sep) ? file : "";
}

/** GET/HEAD /voice-engine/<file>; false for any other method (server.mjs calls it before /api). */
export async function serveVoiceEngine(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const file = engineFile(url.pathname);
  const info = file ? await stat(file).catch(() => null) : null;
  if (!info?.isFile()) { res.writeHead(404, { "content-type": "text/plain" }); res.end("Not found"); return true; }
  res.writeHead(200, {
    "content-type": TYPES[extname(file)] || "application/octet-stream",
    "content-length": info.size,
    // Pinned files (kale-tts.lock.json): safe to keep for a day.
    "cache-control": "private, max-age=86400",
    "x-content-type-options": "nosniff",
  });
  if (req.method === "HEAD") { res.end(); return true; }
  res.end(await readFile(file));
  return true;
}

export function createVoicePlugin() {
  let cleared = false;

  async function forgetElevenLabs(ctx) {
    if (cleared || !ctx?.squadStateDir) return;
    cleared = true;
    await rm(join(ctx.squadStateDir, "voice.json"), { force: true }).catch(() => {});
  }

  async function handle(req, res, url, ctx) {
    if (url.pathname.startsWith("/voice-engine/")) return serveVoiceEngine(req, res, url);
    if (!url.pathname.startsWith("/api/voice/")) return false;
    await forgetElevenLabs(ctx);
    if (url.pathname === "/api/voice/settings" && req.method === "GET") {
      const available = Boolean(await stat(join(kaleRoot(), "models", KALE_MODEL, "model.onnx")).catch(() => null));
      ctx.json(res, 200, { success: true, data: { engine: "kale-tts-1", model: KALE_MODEL, available,
        voices: KALE_VOICES.map(({ id, name, gender, accent, description }) => ({ id, name, gender, accent, description })) } });
      return true;
    }
    ctx.json(res, 404, { success: false, error: "Read aloud now uses the voice built into Squad; there is nothing else to configure." });
    return true;
  }

  return { name, init: forgetElevenLabs, handle };
}

const plugin = createVoicePlugin();
export const init = plugin.init;
export const handle = plugin.handle;
