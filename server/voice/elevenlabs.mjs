// ElevenLabs on the bridge (ADR-0087). The key lives in
// <squadStateDir>/voice.json (mode 0600) and never reaches the browser: the
// settings route reports configured-or-not plus a four-character hint, and
// the speak route returns audio bytes. `fetchFn` is injectable so
// scripts/check-voice.mjs can run the whole surface without the network.

export const ELEVENLABS_API = "https://api.elevenlabs.io/v1";
export const ELEVENLABS_MODEL = "eleven_flash_v2_5";
// 64 kbps mono is indistinguishable for speech and a third of the bytes.
export const ELEVENLABS_FORMAT = "mp3_44100_64";
export const MAX_SPEAK_CHARS = 5000;

export function normalizeVoiceConfig(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    version: 1,
    provider: "elevenlabs",
    key: typeof source.key === "string" ? source.key.trim() : "",
    voiceId: typeof source.voiceId === "string" ? source.voiceId.trim() : "",
    voiceName: typeof source.voiceName === "string" ? source.voiceName.trim() : "",
  };
}

/** What the browser is allowed to see. */
export function publicVoiceConfig(config) {
  const normalized = normalizeVoiceConfig(config);
  return {
    provider: normalized.provider,
    configured: Boolean(normalized.key),
    ready: Boolean(normalized.key && normalized.voiceId),
    keyHint: normalized.key ? `…${normalized.key.slice(-4)}` : "",
    voiceId: normalized.voiceId,
    voiceName: normalized.voiceName,
  };
}

async function safeJson(response) {
  try { return await response.json(); } catch { return null; }
}

/** Prefer ElevenLabs' own words; it knows the plan, the quota and the model. */
function describe(status, what, body) {
  const theirs =
    (typeof body?.detail === "string" && body.detail.trim()) ||
    (typeof body?.detail?.message === "string" && body.detail.message.trim()) ||
    (typeof body?.message === "string" && body.message.trim()) ||
    "";
  if (status === 401 || status === 403) return "ElevenLabs rejected that key. A restricted key needs the Voices and Text to Speech permissions.";
  if (status === 429) return theirs || "ElevenLabs is rate-limiting this account. Wait a moment and try again.";
  if (status === 402) return theirs || "ElevenLabs says this account is out of credit.";
  return theirs ? `${what} failed: ${theirs}` : `${what} failed (${status}).`;
}

export async function listVoices(key, { fetchFn = globalThis.fetch, api = ELEVENLABS_API } = {}) {
  if (!key) throw new Error("No ElevenLabs key is stored.");
  let response;
  try {
    response = await fetchFn(`${api}/voices`, { headers: { "xi-api-key": key }, signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new Error("Could not reach ElevenLabs. Check the connection and try again.");
  }
  const body = await safeJson(response);
  if (!response.ok) throw new Error(describe(response.status, "Listing voices", body));
  return (Array.isArray(body?.voices) ? body.voices : [])
    .map((voice) => ({
      id: String(voice?.voice_id || ""),
      name: String(voice?.name || "Voice"),
      description: [voice?.labels?.accent, voice?.labels?.description].filter(Boolean).join(" · "),
    }))
    .filter((voice) => voice.id);
}

/** A key is checked against /voices before it is stored: that is the capability the feature uses. */
export async function verifyKey(key, options) {
  const voices = await listVoices(key, options);
  return { ok: true, voices };
}

export async function synthesize(text, config, { fetchFn = globalThis.fetch, api = ELEVENLABS_API } = {}) {
  const normalized = normalizeVoiceConfig(config);
  const spoken = String(text || "").trim();
  if (!normalized.key) throw Object.assign(new Error("No ElevenLabs key is stored. Add one in Settings → Voice."), { status: 409 });
  if (!normalized.voiceId) throw Object.assign(new Error("Choose an ElevenLabs voice in Settings → Voice first."), { status: 409 });
  if (!spoken) throw Object.assign(new Error("There is nothing to read."), { status: 400 });
  if (spoken.length > MAX_SPEAK_CHARS) throw Object.assign(new Error(`A clip is limited to ${MAX_SPEAK_CHARS} characters.`), { status: 413 });
  let response;
  try {
    response = await fetchFn(`${api}/text-to-speech/${encodeURIComponent(normalized.voiceId)}?output_format=${ELEVENLABS_FORMAT}`, {
      method: "POST",
      headers: { "xi-api-key": normalized.key, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text: spoken, model_id: ELEVENLABS_MODEL }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw Object.assign(new Error("Could not reach ElevenLabs. Check the connection and try again."), { status: 502 });
  }
  if (!response.ok) throw Object.assign(new Error(describe(response.status, "Speaking", await safeJson(response))), { status: 502 });
  return { bytes: Buffer.from(await response.arrayBuffer()), mime: "audio/mpeg" };
}
