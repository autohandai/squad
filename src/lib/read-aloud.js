// Reading a member reply aloud (ADR-0101, ADR-0276).
//
// One reader per page: starting a reply stops the one playing. Replies are
// read by kale-tts-1 on this computer, in the member's own voice; only when
// that engine cannot start does the reader fall back to the browser's built-in
// voice, saying why. (ElevenLabs is gone, ADR-0276.) Pure factory, so
// scripts/check-voice.mjs drives it with a fake engine and a fake synthesiser.

import { spokenText, spokenUtterances } from "./spoken-text.js";
import { getKaleVoice } from "./kale-voice.js";

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
 * createReader({ kale, synthesis, Utterance, lang })
 *   speak({ id, text, voice, lang })   kale reads in `voice` (a kale-tts-1 voice id); the built-in voice is the fallback
 *   stop()
 *   subscribe(listener)                listener({ id, status, error, provider }); returns unsubscribe
 *   snapshot()                         the same shape, now
 *   supported                          true when kale or a built-in voice exists
 */
export function createReader({ kale = null, synthesis = null, Utterance = null, lang = "en-US", utterances = spokenUtterances } = {}) {
  const listeners = new Set();
  let current = { id: "", status: "idle", error: "", provider: "" };
  let token = 0;

  function emit(next) {
    current = { ...current, ...next };
    for (const listener of listeners) listener(current);
  }

  function stop() {
    token += 1;
    kale?.stop();
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

  async function speak({ id = "", text = "", voice = "", lang: voiceLang = lang } = {}) {
    stop();
    const myToken = token;
    const spoken = spokenText(text);
    if (!spoken) {
      emit({ id: "", status: "idle", error: "There is nothing to read in this reply.", provider: "" });
      return;
    }
    if (kale?.supported) {
      emit({ id, status: "loading", error: "", provider: "kale" });
      kale.speak({
        text: spoken,
        voice,
        onStart: () => { if (myToken === token) emit({ id, status: "speaking", error: "", provider: "kale" }); },
        onEnd: () => { if (myToken === token) emit({ id: "", status: "idle", provider: "" }); },
        onError: (message) => {
          if (myToken !== token) return;
          speakBuiltIn(id, spoken, voiceLang, myToken, `${errorSentence(`The Squad voice could not read this: ${message}`)} The built-in voice is reading instead.`);
        },
      });
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
    get supported() { return Boolean(kale?.supported || (synthesis && Utterance)); },
  };
}

let pageReader = null;

/** The one reader for this page: kale-tts-1, with the browser's own voice as the fallback. */
export function getPageReader() {
  if (pageReader) return pageReader;
  const scope = globalThis.window;
  pageReader = createReader({
    kale: getKaleVoice(),
    synthesis: scope?.speechSynthesis || null,
    Utterance: scope?.SpeechSynthesisUtterance || null,
    lang: scope?.navigator?.language || "en-US",
  });
  return pageReader;
}
