#!/usr/bin/env node
// Checks for voice (ADR-0101, ADR-0276): the spoken-register rewrite, the
// dictation state machine driven by a fake recogniser, the read-aloud reader
// driven by a fake kale-tts worker, fake audio and a fake synthesiser, each
// member's voice, and the bridge route that serves the engine.
import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { spokenText, spokenUtterances, spokenUrl } from "../src/lib/spoken-text.js";
import { DESKTOP_DICTATION_HINT, composeDictation, createDictation, dictationSupport } from "../src/lib/voice-input.js";
import { createReader, pickVoice } from "../src/lib/read-aloud.js";
import { createKaleVoice } from "../src/lib/kale-voice.js";
import { KALE_VOICES, defaultVoiceFor, memberVoices, nameGender, voiceById, voiceForMember } from "../src/lib/member-voice.js";
import { createVoicePlugin, engineFile, kaleRoot } from "../server/routes/voice.route.mjs";

let passed = 0;
async function check(name, run) { await run(); console.log(`ok ${++passed} - ${name}`); }
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// --- spoken register --------------------------------------------------------
await check("code fences become a short spoken placeholder and their contents vanish", () => {
  const text = spokenText("Here is the fix:\n\n```js\nconst secret = 42;\nthrow new Error('boom');\n```\n\nDone.");
  assert.equal(text, "Here is the fix: (a JavaScript code block). Done.");
  assert.ok(!text.includes("secret") && !text.includes("boom"));
  assert.equal(spokenText("```\nraw\n```"), "(a code block)");
});
await check("file paths read as their last segment", () => {
  assert.equal(spokenText("Edit src/components/chat/PromptTextarea.jsx and ~/Documents/notes/todo.md."), "Edit PromptTextarea.jsx and todo.md.");
  assert.equal(spokenText("See `server/routes/voice.route.mjs`."), "See voice.route.mjs.");
});
await check("URLs read as their last meaningful segment", () => {
  assert.equal(spokenUrl("https://github.com/acme/widgets/pull/12"), "pull 12");
  assert.equal(spokenUrl("https://www.example.com/"), "example.com");
  assert.equal(spokenUrl("https://docs.example.com/guides/getting-started.html"), "getting started");
  assert.equal(spokenText("Open https://github.com/acme/widgets/pull/12 now."), "Open pull 12 now.");
  assert.equal(spokenText("Read [the guide](https://example.com/guide) first."), "Read the guide first.");
});
await check("tables become header: value lines", () => {
  const text = spokenText("| Name | Status |\n| --- | --- |\n| Build | passing |\n| Tests | 3 failed |");
  assert.equal(text, "Name: Build, Status: passing. Name: Tests, Status: 3 failed.");
});
await check("lists stay as sentences and headings pause", () => {
  assert.equal(spokenText("## Plan\n- first step\n- second step.\n1. then this\n- [ ] todo item"), "Plan. first step. second step. then this. todo item.");
});
await check("emphasis, images, quotes and emoji are dropped; inline code keeps its text", () => {
  assert.equal(spokenText("**Bold** and _soft_ with `npm test` 🚀\n> quoted\n![a diagram](x.png)"), "Bold and soft with npm test. quoted. (image: a diagram)");
  assert.equal(spokenText("   \n\n"), "");
  assert.equal(spokenText(""), "");
});
await check("utterances split on sentences and glue tiny fragments", () => {
  const parts = spokenUtterances("One sentence here. Two! Three sentences in total, e.g. this one stays whole? Yes.");
  assert.deepEqual(parts, ["One sentence here. Two!", "Three sentences in total, e.g. this one stays whole? Yes."]);
  const long = spokenUtterances(`${"word ".repeat(120)}end, ${"more ".repeat(100)}stop.`, { maxChars: 200 });
  assert.ok(long.every((part) => part.length <= 200), "no utterance over the cap");
  assert.ok(long.length >= 5 && long.every((part) => /\S\s\S/.test(part)), "long text is cut at spaces, never mid-word");
});

// --- dictation ---------------------------------------------------------------
class FakeRecognition {
  static instances = [];
  constructor() { FakeRecognition.instances.push(this); this.started = false; this.stopped = false; this.aborted = false; }
  start() { this.started = true; this.onstart?.(); }
  stop() { this.stopped = true; this.onend?.(); }
  abort() { this.aborted = true; this.onend?.(); }
  hear(final, interim) {
    const results = [...final.map((text) => ({ isFinal: true, 0: { transcript: text } })), ...interim.map((text) => ({ isFinal: false, 0: { transcript: text } }))];
    this.onresult?.({ resultIndex: 0, results });
  }
}
class LocalRecognition extends FakeRecognition {
  static calls = [];
  static async available(options) { LocalRecognition.calls.push(["available", options]); return "available"; }
}
class DownloadableRecognition extends FakeRecognition {
  static installed = [];
  static async available() { return "downloadable"; }
  static async install(options) { DownloadableRecognition.installed.push(options); return true; }
}

await check("support detection: desktop shell is its own case, browser needs a constructor", () => {
  assert.equal(dictationSupport({ userAgent: "AutohandSquadDesktop/0.1.6 (macos; aarch64)", scope: { webkitSpeechRecognition: FakeRecognition } }), "desktop");
  assert.equal(dictationSupport({ userAgent: "AutohandSquadQuickChat/0.1.6 (macos)", scope: {} }), "desktop");
  assert.equal(dictationSupport({ userAgent: "Mozilla/5.0", scope: { SpeechRecognition: FakeRecognition } }), "browser");
  assert.equal(dictationSupport({ userAgent: "Mozilla/5.0", scope: { webkitSpeechRecognition: FakeRecognition } }), "browser");
  assert.equal(dictationSupport({ userAgent: "Mozilla/5.0", scope: {} }), "none");
  assert.match(DESKTOP_DICTATION_HINT, /Fn twice/);
});
await check("no recogniser means unsupported and start is a no-op", async () => {
  const states = [];
  const dictation = createDictation({ Recognition: null, onState: (state) => states.push(state) });
  assert.equal(dictation.state, "unsupported");
  assert.equal(await dictation.start(), false);
  assert.deepEqual(states, []);
});
await check("start → starting → listening; text lands as final + interim; end returns to idle", async () => {
  const states = [];
  const heard = [];
  const problems = [];
  const dictation = createDictation({ Recognition: FakeRecognition, lang: "en-NZ", onState: (state) => states.push(state), onText: (final, interim) => heard.push([final, interim]), onProblem: (message) => problems.push(message) });
  assert.equal(await dictation.start(), true);
  const instance = FakeRecognition.instances.at(-1);
  assert.equal(instance.lang, "en-NZ");
  assert.equal(instance.continuous, true);
  assert.equal(instance.interimResults, true);
  assert.equal(instance.processLocally, undefined, "no on-device flag when the browser cannot say it is available");
  assert.equal(dictation.state, "listening");
  instance.hear([], ["hel"]);
  instance.hear(["hello "], ["wor"]);
  instance.hear(["hello ", "world"], []);
  assert.deepEqual(heard, [["", "hel"], ["hello ", "wor"], ["hello world", ""]]);
  dictation.stop();
  assert.equal(dictation.state, "idle");
  assert.deepEqual(states, ["starting", "listening", "idle"]);
  assert.deepEqual(heard.at(-1), ["hello world", ""]);
  assert.deepEqual(problems, []);
});
await check("on-device recognition is asked for when the browser offers it", async () => {
  const dictation = createDictation({ Recognition: LocalRecognition });
  await dictation.start();
  assert.deepEqual(LocalRecognition.calls, [["available", { langs: ["en-US"], processLocally: true }]]);
  assert.equal(LocalRecognition.instances.at(-1).processLocally, true);
  assert.equal(dictation.local, true);
  dictation.abort();
  assert.equal(dictation.state, "idle");
});
await check("a downloadable on-device pack starts installing and the session runs without it", async () => {
  const dictation = createDictation({ Recognition: DownloadableRecognition });
  await dictation.start();
  assert.equal(dictation.local, false);
  assert.deepEqual(DownloadableRecognition.installed, [{ langs: ["en-US"], processLocally: true }]);
  dictation.abort();
});
await check("errors are one sentence; no-speech and aborted are not problems; a second start while listening is ignored", async () => {
  const problems = [];
  const dictation = createDictation({ Recognition: FakeRecognition, onProblem: (message) => problems.push(message) });
  await dictation.start();
  assert.equal(await dictation.start(), false);
  const instance = FakeRecognition.instances.at(-1);
  instance.onerror({ error: "no-speech" });
  instance.onerror({ error: "aborted" });
  instance.onerror({ error: "not-allowed" });
  instance.onerror({ error: "something-else" });
  assert.deepEqual(problems, ["Microphone access is blocked for Autohand Squad in this browser.", "Dictation stopped: something-else."]);
  dictation.abort();
});
await check("a recogniser that throws on start reports and returns to idle", async () => {
  class Broken extends FakeRecognition { start() { throw new Error("already started"); } }
  const problems = [];
  const dictation = createDictation({ Recognition: Broken, onProblem: (message) => problems.push(message) });
  assert.equal(await dictation.start(), false);
  assert.equal(dictation.state, "idle");
  assert.deepEqual(problems, ["Dictation could not start: already started."]);
});
await check("the draft keeps what was typed and appends what was heard", () => {
  assert.equal(composeDictation("", "hello", " world"), "hello world");
  assert.equal(composeDictation("Fix the", " build", ""), "Fix the build");
  assert.equal(composeDictation("Fix the ", "build", ""), "Fix the build");
  assert.equal(composeDictation("typed", "", ""), "typed");
  assert.equal(composeDictation("typed", "", "interim"), "typed interim");
});

// --- read aloud ---------------------------------------------------------------
function fakeSynthesis(voices = []) {
  const spoken = [];
  const synthesis = {
    cancelled: 0,
    getVoices: () => voices,
    speak(utterance) { spoken.push(utterance); },
    cancel() { this.cancelled += 1; },
  };
  class Utterance { constructor(text) { this.text = text; } }
  return { synthesis, Utterance, spoken };
}

await check("pickVoice prefers an exact local voice, then the language, then the default", () => {
  const voices = [
    { name: "Daniel", lang: "en-GB", localService: true },
    { name: "Karen", lang: "en-AU", localService: true, default: true },
    { name: "Cloud NZ", lang: "en-NZ", localService: false },
    { name: "Thomas", lang: "fr-FR", localService: true },
  ];
  assert.equal(pickVoice(voices, "en-NZ").name, "Cloud NZ");
  assert.equal(pickVoice(voices, "en-US").name, "Karen");
  assert.equal(pickVoice(voices, "fr-CA").name, "Thomas");
  assert.equal(pickVoice([], "en-US"), null);
});
await check("built-in reading: markdown is rewritten, utterances queue, and the last end goes idle", async () => {
  const { synthesis, Utterance, spoken } = fakeSynthesis([{ name: "Karen", lang: "en-AU", localService: true }]);
  const seen = [];
  const reader = createReader({ synthesis, Utterance, lang: "en-AU" });
  reader.subscribe((state) => seen.push(`${state.status}:${state.id}`));
  await reader.speak({ id: "m1", text: "First point.\n\n```sh\nrm -rf /\n```\n\n- second point" });
  assert.deepEqual(spoken.map((utterance) => utterance.text), ["First point.", "(a shell code block).", "second point."]);
  assert.ok(spoken.every((utterance) => utterance.voice?.name === "Karen" && utterance.lang === "en-AU"));
  assert.equal(reader.snapshot().status, "speaking");
  spoken[0].onend();
  spoken[1].onend();
  assert.equal(reader.snapshot().status, "speaking", "still speaking until the last utterance ends");
  spoken[2].onend();
  assert.equal(reader.snapshot().status, "idle");
  assert.deepEqual(seen, ["idle:", "speaking:m1", "idle:"]);
});
await check("starting another reply cancels the current one; stop cancels; interrupted is not an error", async () => {
  const { synthesis, Utterance, spoken } = fakeSynthesis();
  const reader = createReader({ synthesis, Utterance });
  await reader.speak({ id: "a", text: "Alpha reply." });
  await reader.speak({ id: "b", text: "Beta reply." });
  assert.equal(synthesis.cancelled, 2);
  assert.equal(reader.snapshot().id, "b");
  spoken[0].onend(); // the stale utterance from "a" must not flip the state
  assert.equal(reader.snapshot().id, "b");
  spoken[1].onerror({ error: "interrupted" });
  assert.equal(reader.snapshot().status, "speaking");
  reader.stop();
  assert.equal(reader.snapshot().status, "idle");
  assert.equal(reader.snapshot().error, "");
});
await check("nothing readable says so and no voice is unsupported", async () => {
  const { synthesis, Utterance, spoken } = fakeSynthesis();
  const reader = createReader({ synthesis, Utterance });
  await reader.speak({ id: "x", text: "```\nonly code\n```" });
  assert.equal(spoken.length, 1, "a lone code block is still announced");
  await reader.speak({ id: "y", text: "   " });
  assert.equal(reader.snapshot().error, "There is nothing to read in this reply.");
  assert.equal(createReader({}).supported, false);
  assert.equal(createReader({ synthesis, Utterance }).supported, true);
});
// --- kale-tts-1 (ADR-0276) -----------------------------------------------------
function fakeWorker() {
  const posted = [];
  const worker = { posted, onmessage: null, postMessage(message) { posted.push(message); }, send(data) { this.onmessage?.({ data }); } };
  return worker;
}
function fakeAudio() {
  const started = [];
  class Context {
    constructor() { this.currentTime = 0; this.state = "running"; this.destination = {}; }
    createBuffer(channels, length, rate) { const data = new Float32Array(length); return { duration: length / rate, getChannelData: () => data }; }
    createBufferSource() { const source = { connect() {}, start(at) { source.at = at; started.push(source); }, stop() { source.stopped = true; source.onended?.(); } }; return source; }
  }
  return { Context, started };
}

await check("kale reads in the member's voice, sentence by sentence, and goes idle after the last sentence", async () => {
  const worker = fakeWorker();
  const { Context, started } = fakeAudio();
  const kale = createKaleVoice({ createWorker: () => worker, AudioContextClass: Context });
  const reader = createReader({ kale, lang: "en-NZ" });
  const seen = [];
  reader.subscribe((state) => seen.push(`${state.status}:${state.provider}`));
  await reader.speak({ id: "m1", text: "Hello **there**. Second sentence.", voice: "d03" });
  const request = worker.posted.at(-1);
  assert.equal(request.type, "speak");
  assert.equal(request.voice, "d03");
  assert.equal(request.text, "Hello there. Second sentence.", "markdown is rewritten before it is read");
  assert.equal(reader.snapshot().status, "loading");
  worker.send({ type: "chunk", id: request.id, audio: new Float32Array(2400), sampleRate: 24000 });
  worker.send({ type: "chunk", id: request.id, audio: new Float32Array(4800), sampleRate: 24000 });
  assert.equal(reader.snapshot().status, "speaking");
  assert.equal(started.length, 2);
  assert.ok(started[1].at >= started[0].at + 0.1, "the second sentence is queued after the first, with a breath between");
  worker.send({ type: "end", id: request.id });
  assert.equal(reader.snapshot().status, "speaking", "still speaking until the queued audio ends");
  started[0].onended(); started[1].onended();
  assert.equal(reader.snapshot().status, "idle");
  assert.deepEqual(seen, ["idle:", "loading:kale", "speaking:kale", "idle:"]);
});
await check("a new reply stops the one playing and late chunks from it are ignored", async () => {
  const worker = fakeWorker();
  const { Context, started } = fakeAudio();
  const reader = createReader({ kale: createKaleVoice({ createWorker: () => worker, AudioContextClass: Context }) });
  await reader.speak({ id: "a", text: "Alpha reply.", voice: "m3" });
  const first = worker.posted.at(-1);
  worker.send({ type: "chunk", id: first.id, audio: new Float32Array(240), sampleRate: 24000 });
  await reader.speak({ id: "b", text: "Beta reply.", voice: "f06" });
  assert.ok(worker.posted.some((message) => message.type === "stop"), "the worker is told to stop");
  assert.equal(started[0].stopped, true, "the playing sentence is cut");
  worker.send({ type: "chunk", id: first.id, audio: new Float32Array(240), sampleRate: 24000 });
  assert.equal(started.length, 1, "a late sentence from the old reply never plays");
  assert.equal(reader.snapshot().id, "b");
  reader.stop();
  assert.equal(reader.snapshot().status, "idle");
});
await check("when the engine fails the built-in voice reads and says why", async () => {
  const worker = fakeWorker();
  const { Context } = fakeAudio();
  const { synthesis, Utterance, spoken } = fakeSynthesis();
  const reader = createReader({ kale: createKaleVoice({ createWorker: () => worker, AudioContextClass: Context }), synthesis, Utterance });
  await reader.speak({ id: "m3", text: "Fallback please.", voice: "d13" });
  worker.send({ type: "error", id: worker.posted.at(-1).id, message: "model.onnx: 404" });
  assert.equal(spoken.length, 1, "the built-in voice took over");
  assert.equal(reader.snapshot().provider, "browser");
  assert.equal(reader.snapshot().error, "The Squad voice could not read this: model.onnx: 404. The built-in voice is reading instead.");
  assert.equal(createReader({ kale: createKaleVoice({}) }).supported, false, "no worker and no audio is unsupported");
});

// --- each member's voice ----------------------------------------------------------
await check("ten voices, five women and five men, found by id or name", () => {
  assert.equal(KALE_VOICES.length, 10);
  assert.equal(KALE_VOICES.filter((voice) => voice.gender === "female").length, 5);
  assert.equal(voiceById("AMY").id, "d03");
  assert.equal(voiceById("h013f").name, "Magnus");
  assert.equal(voiceById("Siri"), null);
});
await check("names give the gender: records, the international list, then endings", () => {
  assert.equal(nameGender("Tatiana"), "female");
  assert.equal(nameGender("Daniel"), "male");
  assert.equal(nameGender("Thiago"), "male");
  assert.equal(nameGender("João Silva"), "male");
  assert.equal(nameGender("Igor"), "male");
  assert.equal(nameGender("Aroha"), "female");
  assert.equal(nameGender("Chief of Staff"), "");
});
await check("a member gets a voice of its gender that fits its role, and a stated gender wins", () => {
  const woman = voiceById(defaultVoiceFor({ id: "1", name: "Eva", role: "Research analyst" }));
  assert.equal(woman.gender, "female"); assert.equal(woman.name, "Amy");
  const man = voiceById(defaultVoiceFor({ id: "2", name: "Thiago", role: "Growth marketer" }));
  assert.equal(man.gender, "male"); assert.equal(man.name, "Owen");
  assert.equal(voiceById(defaultVoiceFor({ id: "3", name: "Sam", role: "Engineer", personality: "She is calm and direct." })).gender, "female");
});
await check("voices are unique while any are left, saved voices win, and joining never changes an earlier voice", () => {
  const team = ["Ana", "Bia", "Carla", "Dora", "Elena"].map((name, index) => ({ id: `w${index}`, name, role: "Designer", createdAt: `2026-01-0${index + 1}` }));
  const voices = memberVoices(team);
  assert.equal(new Set(voices.values()).size, 5, "five women, five different voices");
  assert.ok([...voices.values()].every((id) => voiceById(id).gender === "female"));
  const later = memberVoices([...team, { id: "w5", name: "Fernanda", role: "Designer", createdAt: "2026-02-01" }]);
  for (const member of team) assert.equal(later.get(member.id), voices.get(member.id), `${member.name} keeps its voice`);
  assert.equal(memberVoices([{ id: "x", name: "Max", voice: "Amy" }]).get("x"), "d03", "a saved voice is kept, even across gender");
  assert.equal(voiceForMember({ id: "y", name: "Jack", role: "Analyst" }, []), "d13");
});

// --- bridge route -------------------------------------------------------------------
function fakeResponse() {
  return { status: 0, headers: null, body: null, payload: null, writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } };
}
function fakeCtx(stateDir) {
  return { squadStateDir: stateDir, json(res, status, payload) { res.status = status; res.payload = payload; }, readBody: async () => ({}) };
}
async function call(plugin, ctx, method, pathname) {
  const res = fakeResponse();
  const handled = await plugin.handle({ method }, res, new URL(`http://127.0.0.1:19821${pathname}`), ctx);
  return { handled, res };
}

const stateDir = await mkdtemp(join(tmpdir(), "squad-voice-"));
try {
  await writeFile(join(stateDir, "voice.json"), JSON.stringify({ key: "xi-old-elevenlabs-key" }));
  const plugin = createVoicePlugin();
  const ctx = fakeCtx(stateDir);
  await check("the settings name the engine and the ten voices, and an old ElevenLabs key is deleted", async () => {
    const { handled, res } = await call(plugin, ctx, "GET", "/api/voice/settings");
    assert.equal(handled, true);
    assert.equal(res.payload.data.engine, "kale-tts-1");
    assert.equal(res.payload.data.model, "kale-tts-1-tiny");
    assert.equal(res.payload.data.voices.length, 10);
    assert.equal(JSON.stringify(res.payload).includes("xi-"), false);
    assert.equal(await stat(join(stateDir, "voice.json")).catch(() => null), null, "the stored key is gone");
    assert.equal((await call(plugin, ctx, "POST", "/api/voice/speak")).res.status, 404, "the ElevenLabs endpoints are gone");
  });
  await check("the engine files are served from the vendored folder, the worker beside them, and nothing outside", async () => {
    assert.ok(engineFile("/voice-engine/squad-worker.mjs").endsWith(join("server", "voice", "kale-worker.mjs")));
    assert.equal(engineFile("/voice-engine/../../package.json"), "");
    assert.equal(engineFile("/voice-engine/%2e%2e/%2e%2e/package.json"), "");
    assert.equal(engineFile("/voice-engine/%E0%A4%A"), "");
    const worker = await call(plugin, ctx, "GET", "/voice-engine/squad-worker.mjs");
    assert.equal(worker.res.status, 200); assert.match(worker.res.headers["content-type"], /javascript/);
    assert.equal((await call(plugin, ctx, "GET", "/voice-engine/../server.mjs")).handled, false, "a dot-dot path is resolved away before the route");
    assert.equal((await call(plugin, ctx, "GET", "/voice-engine/no-such-file.bin")).res.status, 404);
    if (await stat(join(kaleRoot(), "models", "kale-tts-1-tiny", "model.onnx")).catch(() => null)) {
      const model = await call(plugin, ctx, "HEAD", "/voice-engine/models/kale-tts-1-tiny/voices.json");
      assert.equal(model.res.status, 200); assert.match(model.res.headers["content-type"], /json/);
      const wasm = await call(plugin, ctx, "HEAD", "/voice-engine/ort/ort-wasm-simd-threaded.wasm");
      assert.equal(wasm.res.headers["content-type"], "application/wasm");
    }
  });
} finally {
  await rm(stateDir, { recursive: true, force: true });
}

console.log(`voice checks passed: ${passed}`);
