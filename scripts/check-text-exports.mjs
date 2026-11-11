import assert from "node:assert/strict";
import { saveTextExport } from "../src/lib/text-exports.js";
const calls = [];
let browserClicks = 0;
globalThis.document = { body: { append() {} }, createElement() { return { click() { browserClicks++; }, remove() {} }; } };
const result = await saveTextExport("conversation.md", "# Exact café\n", {
  userAgent: "AutohandSquadDesktop/0.1.22 (macos; aarch64)",
  invoke: async (command, args) => { calls.push({ command, args }); return { saved: true, filename: "conversation (1).md", bytes: 14 }; },
});
assert.equal(calls.length, 1, "desktop exports must reach the native save path rather than a hidden blob anchor");
assert.equal(browserClicks, 0);
assert.deepEqual(calls[0], { command: "squad_save_text_export", args: { filename: "conversation.md", content: "# Exact café\n" } });
assert.equal(result.filename, "conversation (1).md");
console.log("Desktop text export uses the native save path.");
const { saveTextExports } = await import("../src/lib/text-exports.js");
const desktop = { userAgent: "AutohandSquadDesktop/0.1.22 (windows; x86_64)" };
await assert.rejects(saveTextExport("log.md", "text", { ...desktop, invoke: async () => { throw "Downloads permission denied"; } }), /permission denied/);
for (const receipt of [{ saved: false }, { saved: true, filename: "log.md", bytes: 0 }, { saved: true, filename: "../escape.md", bytes: 4 }]) {
  await assert.rejects(saveTextExport("log.md", "text", { ...desktop, invoke: async () => receipt }), /did not confirm/);
}
assert.equal(browserClicks, 0, "native refusal must not silently fall back to unsupported blob downloads");
const partial = await saveTextExports([{ filename: "log.md", content: "markdown" }, { filename: "log.json", content: "{}" }], {
  ...desktop, invoke: async (_command, args) => {
    if (args.filename.endsWith(".json")) throw new Error("disk full");
    return { saved: true, filename: "log.md", bytes: 8 };
  },
});
assert.deepEqual(partial.succeeded, [{ saved: true, filename: "log.md" }]);
assert.match(partial.message, /Saved in Downloads: log.md/);
assert.match(partial.message, /Could not export log.json: disk full/);
let cleanup;
let revoked = false;
let actualBlob;
let clicked = false;
const browser = await saveTextExport("data.json", '{"exact":"café 🐦"}\n', {
  userAgent: "ordinary browser",
  document: { body: { append() {} }, createElement() { return { click() { clicked = true; assert.equal(revoked, false); }, remove() {} }; } },
  url: { createObjectURL(blob) { actualBlob = blob; return "blob:fixture"; }, revokeObjectURL(href) { assert.equal(href, "blob:fixture"); revoked = true; } },
  scheduleCleanup(callback) { cleanup = callback; },
});
assert.ok(clicked);
assert.equal(browser.requested, true);
assert.equal(browser.saved, undefined);
assert.equal(actualBlob.type, "application/json;charset=utf-8");
assert.equal(await actualBlob.text(), '{"exact":"café 🐦"}\n');
assert.equal(revoked, false, "the URL must survive the asynchronous browser click");
cleanup(); assert.ok(revoked);
for (const name of ["../bad.md", "a/b.json", "a\\b.md", "C:bad.md", "bad.txt", "bad.md\n"]) {
  await assert.rejects(saveTextExport(name, "text", { ...desktop, invoke() { assert.fail("invalid names must not reach native IPC"); } }), /valid filename/);
}
await assert.rejects(saveTextExport("big.md", "x".repeat(32 * 1024 * 1024 + 1), desktop), /32 MB/);
console.log("Native acknowledgement/refusal, partial saves, exact browser bytes, cleanup and boundary checks passed; IPC is mocked here.");
