// The page's side of the reading voice (ADR-0276): one worker running
// kale-tts-1 (served by the bridge at /voice-engine/squad-worker.mjs) and one
// AudioContext that plays each sentence as it arrives, back to back, so a long
// reply starts speaking after its first sentence.
//
// createKaleVoice({ createWorker, AudioContextClass })
//   speak({ text, voice, onStart, onEnd, onError }) → a request; a new speak stops the one before
//   stop()
//   warm(voice)   load the model and the voice before the first click
// Pure factory with injectable worker and audio, so scripts/check-voice.mjs can drive it.

export const KALE_WORKER_URL = "/voice-engine/squad-worker.mjs";

export function createKaleVoice({ createWorker = null, AudioContextClass = null } = {}) {
  let worker = null;
  let context = null;
  let request = 0;
  let active = null; // { id, onStart, onEnd, onError, sources:Set, nextAt, started, finished }

  function ensureWorker() {
    if (worker || !createWorker) return worker;
    worker = createWorker();
    worker.onmessage = ({ data }) => receive(data);
    worker.onerror = (event) => {
      const message = event?.message || "The reading voice could not start.";
      if (active) fail(active, message);
      worker = null;
    };
    return worker;
  }

  function ensureContext() {
    if (!context && AudioContextClass) context = new AudioContextClass();
    if (context?.state === "suspended") context.resume?.().catch?.(() => {});
    return context;
  }

  function settle(job) {
    if (!job.finished || job.sources.size) return;
    if (active === job) active = null;
    job.onEnd?.();
  }

  function fail(job, message) {
    for (const source of job.sources) { try { source.stop(); } catch { /* ended */ } }
    job.sources.clear();
    if (active === job) active = null;
    job.onError?.(message);
  }

  function play(job, samples, sampleRate) {
    const audio = ensureContext();
    if (!audio) return fail(job, "This browser cannot play audio.");
    const buffer = audio.createBuffer(1, samples.length, sampleRate);
    buffer.getChannelData(0).set(samples);
    const source = audio.createBufferSource();
    source.buffer = buffer;
    source.connect(audio.destination);
    const at = Math.max(audio.currentTime + 0.02, job.nextAt || 0);
    job.nextAt = at + buffer.duration + 0.12; // a short breath between sentences
    job.sources.add(source);
    source.onended = () => { job.sources.delete(source); settle(job); };
    source.start(at);
    if (!job.started) { job.started = true; job.onStart?.(); }
  }

  function receive(data) {
    const job = active;
    if (!job || data?.id !== job.id) return;
    if (data.type === "chunk") play(job, data.audio, data.sampleRate || 24000);
    else if (data.type === "error") fail(job, data.message || "The reading voice stopped.");
    else if (data.type === "end") { job.finished = true; settle(job); }
  }

  function stop() {
    request += 1;
    worker?.postMessage({ type: "stop" });
    if (active) {
      const job = active;
      active = null;
      for (const source of job.sources) { try { source.stop(); } catch { /* ended */ } }
      job.sources.clear();
    }
  }

  function speak({ text = "", voice = "", onStart, onEnd, onError } = {}) {
    stop();
    const target = ensureWorker();
    if (!target) { onError?.("The reading voice is not available here."); return null; }
    ensureContext();
    const id = `read-${++request}`;
    active = { id, onStart, onEnd, onError, sources: new Set(), nextAt: 0, started: false, finished: false };
    target.postMessage({ type: "speak", id, text, voice });
    return id;
  }

  return {
    speak,
    stop,
    warm(voice) { ensureWorker()?.postMessage({ type: "warm", voice }); },
    get supported() { return Boolean(createWorker && AudioContextClass); },
  };
}

let pageVoice = null;

/** The one reading voice for this page. */
export function getKaleVoice() {
  if (pageVoice) return pageVoice;
  const scope = globalThis.window;
  pageVoice = createKaleVoice({
    createWorker: typeof scope?.Worker === "function" ? () => new scope.Worker(KALE_WORKER_URL, { type: "module" }) : null,
    AudioContextClass: scope?.AudioContext || scope?.webkitAudioContext || null,
  });
  return pageVoice;
}
