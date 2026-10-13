// Dictation into a composer draft (ADR-0087).
//
// Pure: it takes the recogniser class, the user agent and the clock as
// arguments so scripts/check-voice.mjs can drive it with fakes. The browser's
// own SpeechRecognition does the listening; on-device processing is asked for
// when the browser can offer it, so audio never leaves the computer where that
// is possible. Nothing here sends a message: text lands in the draft and the
// person reviews it.

export const DICTATION_STATES = ["unsupported", "desktop", "idle", "starting", "listening"];

const DESKTOP_SHELL = /^AutohandSquad(?:Desktop|QuickChat)\/[^\s]+ \(macos(?:; [^)]*)?\)/;

/** One-sentence explanations for recognition errors; the rest fall back to a generic line. */
export const DICTATION_PROBLEMS = {
  "not-allowed": "Microphone access is blocked for Autohand Squad in this browser.",
  "service-not-allowed": "This browser does not allow dictation here.",
  "audio-capture": "No microphone was found.",
  network: "The browser's speech service could not be reached.",
  "language-not-supported": "Dictation does not support this language yet.",
};

export const DESKTOP_DICTATION_HINT = "Use the Mac's dictation here: press the Dictation key, or Fn twice, and speak into the field.";

/**
 * How dictation can work on this page.
 *   browser  → SpeechRecognition is usable
 *   desktop  → the macOS shell: WKWebView exposes the constructor but recognition
 *              never starts without the app's speech usage description, so the
 *              Mac's built-in dictation is the way in (ADR-0087)
 *   none     → no recogniser at all
 */
export function dictationSupport({ userAgent = globalThis.navigator?.userAgent || "", scope = globalThis.window } = {}) {
  if (DESKTOP_SHELL.test(userAgent)) return "desktop";
  return recognitionClass(scope) ? "browser" : "none";
}

export function recognitionClass(scope = globalThis.window) {
  if (!scope) return null;
  return scope.SpeechRecognition || scope.webkitSpeechRecognition || null;
}

/**
 * The draft while dictation runs: what was typed before the mic started, then
 * everything heard so far. A space separates typed text from spoken text; the
 * interim tail is included so the person sees words as they are recognised.
 */
export function composeDictation(base, final, interim = "") {
  const typed = String(base || "");
  const heard = `${String(final || "")}${String(interim || "")}`.replace(/^\s+/, "");
  if (!heard) return typed;
  if (!typed) return heard;
  return /\s$/.test(typed) ? `${typed}${heard}` : `${typed} ${heard}`;
}

/** Whether the browser can recognise this language on the device right now. */
async function onDeviceReady(Recognition, lang, { timeoutMs = 120, setTimeoutFn = setTimeout } = {}) {
  if (typeof Recognition.available !== "function") return false;
  try {
    const status = await Promise.race([
      Recognition.available({ langs: [lang], processLocally: true }),
      new Promise((resolve) => setTimeoutFn(() => resolve("timeout"), timeoutMs)),
    ]);
    if (status === "downloadable" && typeof Recognition.install === "function") {
      // The download needs the click that started dictation; it is used from next time.
      Recognition.install({ langs: [lang], processLocally: true }).catch(() => {});
    }
    return status === "available";
  } catch {
    return false;
  }
}

/**
 * The dictation state machine behind the mic button.
 *
 *   createDictation({ Recognition, lang, onText, onProblem, onState })
 *     .start()  idle → starting → listening (onstart) → idle (onend)
 *     .stop()   asks the recogniser to finish; the final text arrives through onText
 *     .abort()  drops the session without a final result
 *
 * `onText(final, interim)` is everything recognised in this session so far plus
 * the words still being heard; `onProblem(message)` is one sentence; `onState`
 * reports each transition. `no-speech` and `aborted` are not problems.
 */
export function createDictation({ Recognition, lang = "en-US", onText, onProblem, onState, availabilityTimeoutMs = 120, setTimeoutFn = setTimeout } = {}) {
  let state = Recognition ? "idle" : "unsupported";
  let instance = null;
  let local = false;
  let session = 0;

  function setState(next) {
    if (state === next) return;
    state = next;
    onState?.(next);
  }

  async function start() {
    if (!Recognition || instance || state === "starting") return false;
    const id = ++session;
    setState("starting");
    const recogniser = new Recognition();
    recogniser.lang = lang;
    recogniser.continuous = true;
    recogniser.interimResults = true;
    local = await onDeviceReady(Recognition, lang, { timeoutMs: availabilityTimeoutMs, setTimeoutFn });
    if (id !== session) return false; // aborted while the availability check ran
    if (local) recogniser.processLocally = true;

    let final = "";
    recogniser.onstart = () => setState("listening");
    // `results` is the whole session; rebuilding from index 0 each time means a
    // repeated final result is never appended twice, whatever resultIndex says.
    recogniser.onresult = (event) => {
      let heard = "";
      let interim = "";
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) heard += result[0].transcript;
        else interim += result[0].transcript;
      }
      final = heard;
      onText?.(final, interim);
    };
    recogniser.onerror = (event) => {
      const code = String(event?.error || "");
      if (code === "no-speech" || code === "aborted") return;
      onProblem?.(DICTATION_PROBLEMS[code] || `Dictation stopped: ${code || "unknown error"}.`);
    };
    recogniser.onend = () => {
      if (instance === recogniser) instance = null;
      setState("idle");
      onText?.(final, "");
    };
    instance = recogniser;
    try {
      recogniser.start();
      return true;
    } catch (error) {
      instance = null;
      setState("idle");
      onProblem?.(`Dictation could not start: ${error?.message || "unknown error"}.`);
      return false;
    }
  }

  function stop() {
    if (!instance) {
      if (state === "starting") { session += 1; setState("idle"); }
      return;
    }
    try { instance.stop(); } catch { /* the recogniser is already gone */ }
  }

  function abort() {
    session += 1;
    const current = instance;
    instance = null;
    if (current) {
      try { current.abort(); } catch { /* already gone */ }
    }
    setState(Recognition ? "idle" : "unsupported");
  }

  return {
    start,
    stop,
    abort,
    get state() { return state; },
    get local() { return local; },
  };
}
