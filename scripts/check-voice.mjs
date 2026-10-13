#!/usr/bin/env node
// Checks for voice (ADR-0101): the spoken-register rewrite, the dictation
// state machine driven by a fake recogniser, the read-aloud reader driven by a
// fake synthesiser and audio element, and the bridge voice route with an
// injected fetch so no ElevenLabs call is made.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { spokenText, spokenUtterances, spokenUrl } from "../src/lib/spoken-text.js";
import { DESKTOP_DICTATION_HINT, composeDictation, createDictation, dictationSupport } from "../src/lib/voice-input.js";
import { bridgeVoiceSettings, createReader, pickVoice, resetBridgeVoiceSettings } from "../src/lib/read-aloud.js";
import { createVoicePlugin } from "../server/routes/voice.route.mjs";
import { normalizeVoiceConfig, publicVoiceConfig } from "../server/voice/elevenlabs.mjs";

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
await check("bridge voice plays the fetched clip and falls back to the built-in voice when the bridge fails", async () => {
  const { synthesis, Utterance, spoken } = fakeSynthesis();
  const audios = [];
  let fail = false;
  const reader = createReader({
    synthesis,
    Utterance,
    fetchAudio: async (text) => { if (fail) throw new Error("ElevenLabs says this account is out of credit"); return { url: `blob:${text.length}`, revoke() { audios.at(-1).revoked = true; } }; },
    createAudio: (url) => { const audio = { url, played: 0, async play() { this.played += 1; } }; audios.push(audio); return audio; },
  });
  const seen = [];
  reader.subscribe((state) => seen.push(state.status));
  await reader.speak({ id: "m2", text: "Hello **there**.", provider: "bridge" });
  assert.equal(audios.length, 1);
  assert.equal(audios[0].played, 1);
  assert.equal(reader.snapshot().provider, "bridge");
  audios[0].onended();
  assert.equal(reader.snapshot().status, "idle");
  assert.equal(audios[0].revoked, true);
  assert.deepEqual(seen, ["idle", "loading", "speaking", "idle"]);
  fail = true;
  await reader.speak({ id: "m3", text: "Fallback please.", provider: "bridge" });
  assert.equal(spoken.length, 1, "the built-in voice took over");
  assert.equal(reader.snapshot().provider, "browser");
  assert.equal(reader.snapshot().error, "ElevenLabs says this account is out of credit. The built-in voice is reading instead.");
});
await check("bridge settings are cached for a minute and a failure counts as not configured", async () => {
  resetBridgeVoiceSettings();
  let calls = 0;
  const api = async () => { calls += 1; return { configured: true }; };
  let now = 1000;
  assert.deepEqual(await bridgeVoiceSettings(api, { now: () => now }), { configured: true });
  await bridgeVoiceSettings(api, { now: () => now + 30_000 });
  assert.equal(calls, 1);
  await bridgeVoiceSettings(api, { now: () => now + 61_000 });
  assert.equal(calls, 2);
  resetBridgeVoiceSettings();
  assert.equal(await bridgeVoiceSettings(async () => { throw new Error("offline"); }), null);
  assert.equal(await bridgeVoiceSettings(undefined), null);
  resetBridgeVoiceSettings();
});

// --- bridge route ---------------------------------------------------------------
function fakeResponse() {
  const res = { status: 0, headers: null, body: null, writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } };
  return res;
}
function fakeCtx(stateDir) {
  return {
    squadStateDir: stateDir,
    json(res, status, payload) { res.status = status; res.payload = payload; },
    readBody: async (req) => req.body || {},
  };
}
async function call(plugin, ctx, method, pathname, body) {
  const res = fakeResponse();
  const handled = await plugin.handle({ method, body }, res, new URL(`http://127.0.0.1:19821${pathname}`), ctx);
  return { handled, res };
}

const stateDir = await mkdtemp(join(tmpdir(), "squad-voice-"));
try {
  const requests = [];
  const fetchFn = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    const key = init.headers?.["xi-api-key"];
    if (key !== "good-key-1234") return { ok: false, status: 401, json: async () => ({ detail: { message: "invalid key" } }) };
    if (String(url).endsWith("/voices")) return { ok: true, status: 200, json: async () => ({ voices: [{ voice_id: "v1", name: "Ada", labels: { accent: "british" } }, { voice_id: "v2", name: "Lee" }] }) };
    if (String(url).includes("/text-to-speech/")) return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([73, 68, 51, 4]).buffer, json: async () => null };
    return { ok: false, status: 404, json: async () => null };
  };
  const plugin = createVoicePlugin({ fetchFn });
  const ctx = fakeCtx(stateDir);
  await plugin.init(ctx);

  await check("settings start unconfigured and other routes are not ours", async () => {
    const { handled, res } = await call(plugin, ctx, "GET", "/api/voice/settings");
    assert.equal(handled, true);
    assert.deepEqual(res.payload, { success: true, data: { provider: "elevenlabs", configured: false, ready: false, keyHint: "", voiceId: "", voiceName: "" } });
    assert.equal((await call(plugin, ctx, "GET", "/api/members")).handled, false);
  });
  await check("a rejected key is not stored and the error is ElevenLabs' own", async () => {
    const { res } = await call(plugin, ctx, "PUT", "/api/voice/settings", { key: "bad-key" });
    assert.equal(res.status, 400);
    assert.match(res.payload.error, /rejected that key/);
    assert.equal(plugin.current().configured, false);
    await assert.rejects(stat(join(stateDir, "voice.json")), { code: "ENOENT" });
  });
  await check("a verified key is stored 0600, masked to the browser, and the voices come back with it", async () => {
    const { res } = await call(plugin, ctx, "PUT", "/api/voice/settings", { key: "good-key-1234" });
    assert.equal(res.status, 200);
    assert.deepEqual(res.payload.data.voices, [{ id: "v1", name: "Ada", description: "british" }, { id: "v2", name: "Lee", description: "" }]);
    assert.equal(res.payload.data.configured, true);
    assert.equal(res.payload.data.ready, false);
    assert.equal(res.payload.data.keyHint, "…1234");
    assert.ok(!JSON.stringify(res.payload).includes("good-key-1234"), "the key never appears in a response");
    const info = await stat(join(stateDir, "voice.json"));
    assert.equal(info.mode & 0o777, 0o600);
    assert.equal(JSON.parse(await readFile(join(stateDir, "voice.json"), "utf8")).key, "good-key-1234");
  });
  await check("speaking without a voice is a 409, choosing one makes the route ready", async () => {
    const refused = await call(plugin, ctx, "POST", "/api/voice/speak", { text: "Hello" });
    assert.equal(refused.res.status, 409);
    const chosen = await call(plugin, ctx, "PUT", "/api/voice/settings", { voiceId: "v2", voiceName: "Lee" });
    assert.equal(chosen.res.payload.data.ready, true);
    assert.equal(chosen.res.payload.data.voiceName, "Lee");
    assert.equal(requests.filter((request) => request.url.endsWith("/voices")).length, 2, "an unchanged key is not re-verified");
  });
  await check("speak returns audio bytes with the stored key and voice, and bounds the text", async () => {
    const { res } = await call(plugin, ctx, "POST", "/api/voice/speak", { text: "Read this." });
    assert.equal(res.status, 200);
    assert.equal(res.headers["content-type"], "audio/mpeg");
    assert.deepEqual([...res.body], [73, 68, 51, 4]);
    const request = requests.at(-1);
    assert.match(request.url, /\/text-to-speech\/v2\?output_format=mp3_44100_64$/);
    assert.equal(request.init.headers["xi-api-key"], "good-key-1234");
    assert.deepEqual(JSON.parse(request.init.body), { text: "Read this.", model_id: "eleven_flash_v2_5" });
    const empty = await call(plugin, ctx, "POST", "/api/voice/speak", { text: "  " });
    assert.equal(empty.res.status, 400);
    const huge = await call(plugin, ctx, "POST", "/api/voice/speak", { text: "x".repeat(5001) });
    assert.equal(huge.res.status, 413);
  });
  await check("the voices route uses the stored key; GET never leaks it", async () => {
    const { res } = await call(plugin, ctx, "GET", "/api/voice/voices");
    assert.equal(res.payload.data.voices.length, 2);
    const settings = await call(plugin, ctx, "GET", "/api/voice/settings");
    assert.ok(!JSON.stringify(settings.res.payload).includes("good-key"));
  });
  await check("a new key drops a voice it does not have; key null forgets everything; DELETE too", async () => {
    const fetchOther = async (url, init) => (init.headers["xi-api-key"] === "other-key-9999" ? { ok: true, status: 200, json: async () => ({ voices: [{ voice_id: "z9", name: "Zed" }] }) } : fetchFn(url, init));
    const other = createVoicePlugin({ fetchFn: fetchOther });
    await other.init(ctx);
    assert.equal(other.current().voiceId, "v2", "a fresh plug-in reads the stored file");
    const swapped = await call(other, ctx, "PUT", "/api/voice/settings", { key: "other-key-9999" });
    assert.equal(swapped.res.payload.data.voiceId, "");
    assert.equal(swapped.res.payload.data.keyHint, "…9999");
    const cleared = await call(other, ctx, "PUT", "/api/voice/settings", { key: null });
    assert.deepEqual(cleared.res.payload.data, publicVoiceConfig(normalizeVoiceConfig({})));
    assert.equal(JSON.parse(await readFile(join(stateDir, "voice.json"), "utf8")).key, "");
    const voices = await call(other, ctx, "GET", "/api/voice/voices");
    assert.equal(voices.res.status, 409);
    await call(other, ctx, "PUT", "/api/voice/settings", { key: "good-key-1234", voiceId: "v1" });
    const removed = await call(other, ctx, "DELETE", "/api/voice/settings");
    assert.equal(removed.res.payload.data.configured, false);
  });
} finally {
  await rm(stateDir, { recursive: true, force: true });
}

await tick();
console.log(`voice checks passed: ${passed}`);
