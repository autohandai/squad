// Reading a member reply aloud (ADR-0101).
//
// One reader per page: starting a reply stops the one playing. Built-in voices
// come from window.speechSynthesis; when the bridge holds an ElevenLabs key
// the reader asks it for audio instead and falls back to the built-in voice
// if that fails, saying why. Pure factory, so scripts/check-voice.mjs drives
// it with a fake synthesiser and a fake audio element.

import { spokenText, spokenUtterances } from "./spoken-text.js";

/** Prefer a local voice for the page language: exact tag, then language prefix, then the default. */
export function pickVoice(voices = [], lang = "en-US") {
  const list = Array.isArray(voices) ? voices : [];
  if (!list.length) return null;
  const wanted = String(lang || "").toLowerCase();
  const prefix = wanted.split("-")[0];
  const byLang = (voice) => String(voice.lang || "").toLowerCase().replace("_", "-");
  const score = (voice) => {
    let value = 0;
    if (byLang(voice) === wanted) value += 4;
    else if (byLang(voice).startsWith(`${prefix}-`) || byLang(voice) === prefix) value += 2;
    if (voice.localService) value += 1;
    if (voice.default) value += 0.5;
    return value;
  };
  return [...list].sort((a, b) => score(b) - score(a))[0] || null;
}

function errorSentence(error) {
  const message = String(error?.message || error || "").trim();
  return message ? (/[.!?]$/.test(message) ? message : `${message}.`) : "The voice could not be reached.";
}

/**
 * createReader({ synthesis, Utterance, fetchAudio, createAudio, lang })
 *   speak({ id, text, provider, lang })  provider "bridge" uses fetchAudio(text) → { url, revoke }
 *   stop()
 *   subscribe(listener)                  listener({ id, status, error, provider }); returns unsubscribe
 *   snapshot()                           the same shape, now
 *   supported                            true when a built-in voice or a bridge voice exists
 */
export function createReader({ synthesis = null, Utterance = null, fetchAudio = null, createAudio = null, lang = "en-US", utterances = spokenUtterances } = {}) {
  const listeners = new Set();
  let current = { id: "", status: "idle", error: "", provider: "" };
  let token = 0;
  let audio = null;
  let revoke = null;

  function emit(next) {
    current = { ...current, ...next };
    for (const listener of listeners) listener(current);
  }

  function clearAudio() {
    if (audio) {
      try { audio.pause(); } catch { /* already stopped */ }
      audio.onended = null;
      audio.onerror = null;
      audio = null;
    }
    if (revoke) {
      try { revoke(); } catch { /* nothing to release */ }
      revoke = null;
    }
  }

  function stop() {
    token += 1;
    clearAudio();
    if (synthesis) {
      try { synthesis.cancel(); } catch { /* nothing playing */ }
    }
    emit({ id: "", status: "idle", provider: "" });
  }

  function speakBuiltIn(id, text, voiceLang, myToken, error = "") {
    if (!synthesis || !Utterance) {
      emit({ id: "", status: "idle", error: error || "This browser has no built-in voices.", provider: "" });
      return;
    }
    const parts = utterances(text);
    if (!parts.length) {
      emit({ id: "", status: "idle", error: "There is nothing to read in this reply.", provider: "" });
      return;
    }
    const voice = pickVoice(typeof synthesis.getVoices === "function" ? synthesis.getVoices() : [], voiceLang);
    emit({ id, status: "speaking", error, provider: "browser" });
    let remaining = parts.length;
    for (const part of parts) {
      const utterance = new Utterance(part);
      utterance.lang = voice?.lang || voiceLang;
      if (voice) utterance.voice = voice;
      utterance.onend = () => {
        if (myToken !== token) return;
        remaining -= 1;
        if (remaining === 0) emit({ id: "", status: "idle", provider: "" });
      };
      utterance.onerror = (event) => {
        if (myToken !== token) return;
        const code = String(event?.error || "");
        if (code === "interrupted" || code === "canceled") return;
        emit({ id: "", status: "idle", error: `The built-in voice stopped: ${code || "unknown error"}.`, provider: "" });
      };
      synthesis.speak(utterance);
    }
  }

  async function speak({ id = "", text = "", provider = "browser", lang: voiceLang = lang } = {}) {
    stop();
    const myToken = token;
    const spoken = spokenText(text);
    if (!spoken) {
      emit({ id: "", status: "idle", error: "There is nothing to read in this reply.", provider: "" });
      return;
    }
    if (provider === "bridge" && fetchAudio && createAudio) {
      emit({ id, status: "loading", error: "", provider: "bridge" });
      try {
        const clip = await fetchAudio(spoken);
        if (myToken !== token) { clip?.revoke?.(); return; }
        audio = createAudio(clip.url);
        revoke = clip.revoke || null;
        audio.onended = () => { if (myToken === token) { clearAudio(); emit({ id: "", status: "idle", provider: "" }); } };
        audio.onerror = () => { if (myToken === token) { clearAudio(); speakBuiltIn(id, spoken, voiceLang, myToken, "The ElevenLabs clip could not play, so the built-in voice is reading instead."); } };
        emit({ id, status: "speaking", error: "", provider: "bridge" });
        await audio.play();
      } catch (error) {
        if (myToken !== token) return;
        clearAudio();
        speakBuiltIn(id, spoken, voiceLang, myToken, `${errorSentence(error)} The built-in voice is reading instead.`);
      }
      return;
    }
    speakBuiltIn(id, spoken, voiceLang, myToken);
  }

  return {
    speak,
    stop,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot: () => current,
    get supported() { return Boolean((synthesis && Utterance) || (fetchAudio && createAudio)); },
  };
}

/** Fetch an ElevenLabs clip from the bridge; the key never reaches the browser. */
export async function fetchBridgeAudio(text, { fetchFn = globalThis.fetch } = {}) {
  const response = await fetchFn("/api/voice/speak", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) {
    let message = `The bridge voice failed (${response.status})`;
    try {
      const payload = await response.json();
      if (payload?.error) message = payload.error;
    } catch { /* not JSON */ }
    throw new Error(message);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  return { url, revoke: () => URL.revokeObjectURL(url) };
}

let pageReader = null;

/** The one reader for this page, built from the browser's own voices and the bridge. */
export function getPageReader() {
  if (pageReader) return pageReader;
  const scope = globalThis.window;
  pageReader = createReader({
    synthesis: scope?.speechSynthesis || null,
    Utterance: scope?.SpeechSynthesisUtterance || null,
    fetchAudio: typeof globalThis.fetch === "function" ? fetchBridgeAudio : null,
    createAudio: typeof globalThis.Audio === "function" ? (url) => new Audio(url) : null,
    lang: scope?.navigator?.language || "en-US",
  });
  return pageReader;
}

const SETTINGS_TTL_MS = 60_000;
let settingsCache = { at: 0, promise: null };

/**
 * Whether the bridge holds an ElevenLabs key, cached for a minute so a click
 * on the speaker does not wait on a round trip every time. `api` is the app's
 * JSON helper; a failure counts as "not configured".
 */
export function bridgeVoiceSettings(api, { now = Date.now } = {}) {
  if (typeof api !== "function") return Promise.resolve(null);
  const time = now();
  if (settingsCache.promise && time - settingsCache.at < SETTINGS_TTL_MS) return settingsCache.promise;
  settingsCache = {
    at: time,
    promise: Promise.resolve()
      .then(() => api("/api/voice/settings"))
      .catch(() => null),
  };
  return settingsCache.promise;
}

export function resetBridgeVoiceSettings() {
  settingsCache = { at: 0, promise: null };
}
