// The reading voice's worker (ADR-0276). Served by the bridge at
// /voice-engine/squad-worker.mjs next to the vendored kale-tts-1 files, so the
// relative imports below resolve to /voice-engine/js/kale-tts.mjs and
// /voice-engine/ort/. The model loads once, on the CPU (onnxruntime-web wasm,
// one thread: no SharedArrayBuffer or cross-origin isolation needed), and each
// request is spoken sentence by sentence; a newer request or a stop ends the
// one before between sentences.
//
// Messages in:  { type: "speak", id, text, voice } · { type: "stop" } · { type: "warm", voice }
// Messages out: { type: "ready", model } · { type: "chunk", id, audio: Float32Array, sampleRate }
//               { type: "end", id } · { type: "error", id, message }

import { KaleTTS } from "./js/kale-tts.mjs";

const MODEL = new URL(self.location.href).searchParams.get("model") || "kale-tts-1-tiny";
let engine = null;
let current = 0;
let chain = Promise.resolve();

function load() {
  engine ??= (async () => {
    const ort = await import("./ort/ort.wasm.min.mjs");
    ort.env.wasm.wasmPaths = new URL("./ort/", self.location.href).href;
    ort.env.wasm.numThreads = 1;
    ort.env.logLevel = "error";
    const tts = await KaleTTS.load(new URL(`./models/${MODEL}/`, self.location.href).href, { ort, graph: "int8", executionProviders: ["wasm"] });
    postMessage({ type: "ready", model: MODEL });
    return tts;
  })().catch((error) => { engine = null; throw error; });
  return engine;
}

self.onmessage = ({ data }) => {
  if (data?.type === "stop") { current += 1; return; }
  if (data?.type === "warm") { load().then((tts) => tts.preload([tts.resolveVoice(data.voice || "d03")])).catch(() => {}); return; }
  if (data?.type !== "speak") return;
  const mine = ++current;
  const { id, text, voice } = data;
  chain = chain.then(async () => {
    try {
      if (mine !== current) return;
      const tts = await load();
      for await (const piece of tts.stream(String(text || ""), { voice: tts.resolveVoice(voice || "d03") })) {
        if (mine !== current) break;
        postMessage({ type: "chunk", id, audio: piece.audio, sampleRate: tts.sampleRate }, [piece.audio.buffer]);
      }
    } catch (error) {
      postMessage({ type: "error", id, message: error?.message || String(error) });
    } finally {
      postMessage({ type: "end", id });
    }
  });
};
