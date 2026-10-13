// Voice route plug-in (docs/integration/voice.md, ADR-0087).
//
//   GET    /api/voice/settings   { provider, configured, ready, keyHint, voiceId, voiceName }
//   PUT    /api/voice/settings   body: { key?, voiceId?, voiceName? }
//                                 (missing key keeps the stored one; null clears it; a new key is verified first)
//   DELETE /api/voice/settings   forgets the key and the voice
//   GET    /api/voice/voices     { voices: [{ id, name, description }] } using the stored key
//   POST   /api/voice/speak      body: { text } → audio/mpeg bytes
//
// The key lives in <squadStateDir>/voice.json with mode 0600 and is never
// written to a response. `fetchFn` is injectable for scripts/check-voice.mjs.

import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { listVoices, normalizeVoiceConfig, publicVoiceConfig, synthesize, verifyKey } from "../voice/elevenlabs.mjs";

export const name = "voice";

export function createVoicePlugin({ fetchFn = (...args) => globalThis.fetch(...args), api } = {}) {
  let ctx = null;
  let configPath = "";
  let stored = normalizeVoiceConfig({});
  const options = () => (api ? { fetchFn, api } : { fetchFn });

  async function readConfig() {
    try {
      return normalizeVoiceConfig(JSON.parse(await readFile(configPath, "utf8")));
    } catch {
      return normalizeVoiceConfig({});
    }
  }

  async function writeConfig(config) {
    await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(configPath, 0o600).catch(() => {});
  }

  async function init(context) {
    ctx = context;
    configPath = join(ctx.squadStateDir, "voice.json");
    stored = await readConfig();
  }

  async function handle(req, res, url, context) {
    if (!url.pathname.startsWith("/api/voice/")) return false;
    if (!ctx) await init(context);
    const json = context.json;
    const path = url.pathname;
    const method = req.method;

    if (path === "/api/voice/settings" && method === "GET") {
      json(res, 200, { success: true, data: publicVoiceConfig(stored) });
      return true;
    }

    if (path === "/api/voice/settings" && (method === "PUT" || method === "POST")) {
      try {
        const payload = await context.readBody(req);
        const clearing = payload.key === null;
        const incomingKey = clearing ? "" : String(payload.key || "").trim();
        const next = normalizeVoiceConfig({
          key: clearing ? "" : incomingKey || stored.key,
          voiceId: payload.voiceId !== undefined ? payload.voiceId : clearing ? "" : stored.voiceId,
          voiceName: payload.voiceName !== undefined ? payload.voiceName : clearing ? "" : stored.voiceName,
        });
        let voices = null;
        if (incomingKey && incomingKey !== stored.key) {
          ({ voices } = await verifyKey(incomingKey, options()));
          // A new key starts from its own voice list; a stale voice id would speak with nothing.
          if (next.voiceId && !voices.some((voice) => voice.id === next.voiceId)) {
            next.voiceId = "";
            next.voiceName = "";
          }
        }
        if (next.voiceId && !next.key) throw new Error("Add an ElevenLabs key before choosing a voice.");
        stored = next;
        await writeConfig(stored);
        json(res, 200, { success: true, data: { ...publicVoiceConfig(stored), ...(voices ? { voices } : {}) } });
      } catch (error) {
        json(res, 400, { success: false, error: error.message });
      }
      return true;
    }

    if (path === "/api/voice/settings" && method === "DELETE") {
      stored = normalizeVoiceConfig({});
      await writeConfig(stored);
      json(res, 200, { success: true, data: publicVoiceConfig(stored) });
      return true;
    }

    if (path === "/api/voice/voices" && method === "GET") {
      try {
        json(res, 200, { success: true, data: { voices: await listVoices(stored.key, options()) } });
      } catch (error) {
        json(res, stored.key ? 502 : 409, { success: false, error: error.message });
      }
      return true;
    }

    if (path === "/api/voice/speak" && method === "POST") {
      try {
        const payload = await context.readBody(req);
        const clip = await synthesize(payload.text, stored, options());
        res.writeHead(200, { "content-type": clip.mime, "content-length": clip.bytes.length, "cache-control": "no-store" });
        res.end(clip.bytes);
      } catch (error) {
        json(res, Number(error.status) || 500, { success: false, error: error.message });
      }
      return true;
    }

    return false;
  }

  return { init, handle, current: () => publicVoiceConfig(stored) };
}

const plugin = createVoicePlugin();
export const init = plugin.init;
export const handle = plugin.handle;
