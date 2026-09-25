#!/usr/bin/env node
// Checks for canvases (server/canvases/store.mjs, src/lib/diff.js,
// src/lib/canvases.js) against a temp state dir: one revision per changed
// edit, revert restores the body, materialize/absorb round trip, the route
// plug-in's absorb-on-run.finished hook, diff correctness, and mention parsing.

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as store from "../server/canvases/store.mjs";
import * as route from "../server/routes/canvases.route.mjs";
import { applyDiff, diffLines, diffStats } from "../src/lib/diff.js";
import {
  canvasAttachmentText,
  canvasMentionItems,
  canvasMentionToken,
  canvasMentions,
  canvasSlug,
  expandCanvasMentions,
  isCanvasMentionQuery,
  isMemberRevision,
  mentionedCanvases,
  revisionAuthorName,
  stripCanvasMentions,
} from "../src/lib/canvases.js";

const stateDir = await mkdtemp(join(tmpdir(), "squad-canvases-"));
try {
  // --- store: create, list, update -----------------------------------------
  const created = await store.create(stateDir, { ownerType: "channel", ownerId: "ch-1", title: "Test plan", body: "# Plan\n\n- one\n" });
  assert.equal(created.revisions.length, 1, "create records the initial revision");
  assert.equal(created.revisions[0].summary, "Created");
  assert.equal(created.body, "# Plan\n\n- one\n");

  await store.create(stateDir, { ownerType: "member", ownerId: "eva", title: "Notes" });
  assert.equal((await store.list(stateDir, { ownerType: "channel", ownerId: "ch-1" })).length, 1, "list filters by owner");
  assert.equal((await store.list(stateDir, { ownerType: "member", ownerId: "eva" })).length, 1);
  assert.equal((await store.list(stateDir)).length, 2, "list without filter returns all");

  await assert.rejects(() => store.create(stateDir, { ownerType: "team", ownerId: "x", title: "bad" }), /ownerType/);
  await assert.rejects(() => store.get(stateDir, "missing-id"), /not found/);

  const unchanged = await store.update(stateDir, created.id, { body: created.body, authorId: "eva" });
  assert.equal(unchanged.changed, false, "identical body is not a change");
  assert.equal(unchanged.revision, null);
  assert.equal(unchanged.canvas.revisions.length, 1, "identical body records no revision");

  const titleOnly = await store.update(stateDir, created.id, { title: "Release test plan" });
  assert.equal(titleOnly.changed, true);
  assert.equal(titleOnly.canvas.title, "Release test plan");
  assert.equal(titleOnly.canvas.revisions.length, 1, "title change records no revision");

  const edited = await store.update(stateDir, created.id, { body: "# Plan\n\n- one\n- two\n", authorId: "eva", summary: "Added step two" });
  assert.equal(edited.changed, true);
  assert.equal(edited.canvas.revisions.length, 2, "exactly one revision per changed edit");
  assert.equal(edited.revision.authorId, "eva", "revision carries attribution");
  assert.equal(edited.revision.summary, "Added step two");
  assert.equal(edited.canvas.revisions[1].id, edited.revision.id);
  assert.ok(edited.canvas.updatedAt >= created.updatedAt);

  const crlf = await store.update(stateDir, created.id, { body: "# Plan\r\n\r\n- one\r\n- two\r\n", authorId: "user" });
  assert.equal(crlf.changed, false, "CRLF-only differences are normalized away");

  // --- revert ----------------------------------------------------------------
  const reverted = await store.revert(stateDir, created.id, created.revisions[0].id, "user");
  assert.equal(reverted.canvas.body, "# Plan\n\n- one\n", "revert restores the prior body");
  assert.equal(reverted.canvas.revisions.length, 3, "revert is recorded as one revision");
  assert.equal(reverted.canvas.revisions[2].authorId, "user");
  assert.match(reverted.canvas.revisions[2].summary, /^Reverted to /);
  const revertAgain = await store.revert(stateDir, created.id, created.revisions[0].id, "user");
  assert.equal(revertAgain.changed, false, "reverting to the current body records nothing");
  await assert.rejects(() => store.revert(stateDir, created.id, "nope", "user"), /revision not found/);

  // --- materialize / absorb round trip ------------------------------------
  const materialized = await store.materialize(stateDir, created.id);
  assert.equal(materialized.dir, join(stateDir, "canvas"), "materialize returns the canvas dir for --add-dir");
  assert.equal(materialized.path, join(stateDir, "canvas", `${created.id}.md`));
  assert.equal(await readFile(materialized.path, "utf8"), "# Plan\n\n- one\n", "file holds the body");

  const untouched = await store.absorb(stateDir, created.id, "eva");
  assert.equal(untouched.changed, false, "absorbing an untouched file is not a change");
  assert.equal(untouched.revision, null);

  await writeFile(materialized.path, "# Plan\n\n- one\n- two\n- three\n", "utf8");
  const absorbed = await store.absorb(stateDir, created.id, "eva");
  assert.equal(absorbed.changed, true, "absorb sees the member's edit");
  assert.equal(absorbed.revision.authorId, "eva", "absorbed revision is attributed to the member");
  assert.equal(absorbed.canvas.body, "# Plan\n\n- one\n- two\n- three\n");
  assert.equal(absorbed.canvas.revisions.length, 4, "absorb records exactly one revision");
  const absorbedTwice = await store.absorb(stateDir, created.id, "eva");
  assert.equal(absorbedTwice.changed, false, "absorbing the same file again records nothing");
  assert.equal((await store.get(stateDir, created.id)).revisions.length, 4);

  const [notes] = await store.list(stateDir, { ownerType: "member", ownerId: "eva" });
  const missingFile = await store.absorb(stateDir, notes.id, "eva");
  assert.equal(missingFile.changed, false, "a canvas that was never materialized absorbs as unchanged");

  // --- route plug-in: absorb on run.finished --------------------------------
  const events = new EventEmitter();
  const emitted = [];
  const runs = new Map([["run-1", { id: "run-1", agentId: "eva", title: "Write the test plan", canvasId: created.id }]]);
  await route.init({ squadStateDir: stateDir, events, runs, emit: (name, payload) => emitted.push({ name, ...payload }), logEvent() {}, SEVERITY: {} });
  await writeFile(materialized.path, "# Plan\n\n- one\n- two\n- three\n- four\n", "utf8");
  events.emit("run.finished", { runId: "run-1", memberId: "eva", status: "completed" });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const afterRun = await store.get(stateDir, created.id);
  assert.equal(afterRun.revisions.length, 5, "run.finished with a canvasId absorbs exactly one revision");
  assert.equal(afterRun.revisions[4].authorId, "eva");
  assert.equal(afterRun.revisions[4].summary, "Run: Write the test plan");
  assert.equal(emitted.length, 1, "absorb emits canvas.updated for the search index");
  assert.equal(emitted[0].name, "canvas.updated");
  assert.equal(emitted[0].id, created.id);
  assert.equal(emitted[0].title, "Release test plan");
  assert.ok(emitted[0].body.includes("- four"));

  // --- route plug-in: HTTP surface ------------------------------------------
  const responses = [];
  const ctx = {
    squadStateDir: stateDir,
    events,
    runs,
    emit: (name, payload) => emitted.push({ name, ...payload }),
    json: (res, status, payload) => responses.push({ status, payload }),
    readBody: async (req) => req.body || {},
  };
  const call = (method, pathname, body, search = "") => route.handle({ method, body }, {}, new URL(`http://x${pathname}${search}`), ctx);

  assert.equal(await call("GET", "/api/canvases", null, "?ownerType=channel&ownerId=ch-1"), true);
  assert.equal(responses.at(-1).payload.data.canvases.length, 1);
  assert.equal(await call("POST", "/api/canvases", { ownerType: "member", ownerId: "noah", title: "Spec" }), true);
  assert.equal(responses.at(-1).status, 201);
  const specId = responses.at(-1).payload.data.canvas.id;
  assert.equal(await call("PUT", `/api/canvases/${specId}`, { body: "hello", authorId: "user" }), true);
  assert.equal(responses.at(-1).payload.data.revision.authorId, "user");
  assert.equal(await call("POST", `/api/canvases/${specId}/materialize`, {}), true);
  assert.equal(responses.at(-1).payload.data.dir, join(stateDir, "canvas"));
  assert.equal(await call("POST", `/api/canvases/${specId}/absorb`, { authorId: "noah" }), true);
  assert.equal(responses.at(-1).payload.data.changed, false);
  assert.equal(await call("POST", `/api/canvases/${specId}/revert`, { revisionId: "nope" }), true);
  assert.equal(responses.at(-1).status, 404);
  assert.equal(await call("GET", "/api/canvases/does-not-exist"), true);
  assert.equal(responses.at(-1).status, 404);
  assert.equal(await call("DELETE", `/api/canvases/${specId}`), true);
  assert.equal(responses.at(-1).payload.data.id, specId);
  assert.equal(await call("GET", "/api/runtime"), false, "unrelated paths are not ours");

  // --- diff --------------------------------------------------------------------
  const before = "a\nb\nc\nd\n";
  const after = "a\nx\nc\nd\ne\n";
  const diff = diffLines(before, after);
  assert.deepEqual(diff, [
    { type: "equal", text: "a" },
    { type: "remove", text: "b" },
    { type: "add", text: "x" },
    { type: "equal", text: "c" },
    { type: "equal", text: "d" },
    { type: "add", text: "e" },
  ]);
  assert.deepEqual(diffStats(diff), { added: 2, removed: 1, changed: true });
  assert.equal(applyDiff(diff), "a\nx\nc\nd\ne", "applying the diff yields the after side");
  assert.deepEqual(diffLines("", ""), []);
  assert.deepEqual(diffLines("", "one\ntwo"), [{ type: "add", text: "one" }, { type: "add", text: "two" }]);
  assert.deepEqual(diffLines("one\ntwo", ""), [{ type: "remove", text: "one" }, { type: "remove", text: "two" }]);
  assert.deepEqual(diffStats(diffLines("same\n", "same\n")), { added: 0, removed: 0, changed: false });
  const moved = diffLines("h\n1\n2\n3\n", "h\n3\n1\n2\n");
  assert.equal(applyDiff(moved), "h\n3\n1\n2");
  assert.equal(moved.filter((entry) => entry.type === "equal").length, 3, "LCS keeps the longest common run");
  // Larger input with a single edit stays linear thanks to prefix/suffix trimming.
  const big = Array.from({ length: 5000 }, (_, index) => `line ${index}`);
  const bigDiff = diffLines(big, [...big.slice(0, 2500), "inserted", ...big.slice(2500)]);
  assert.deepEqual(diffStats(bigDiff), { added: 1, removed: 0, changed: true });

  // --- composer mention helpers ---------------------------------------------
  assert.equal(canvasSlug("Release test plan"), "release-test-plan");
  assert.equal(canvasSlug("  Éva's Notes!  "), "eva-s-notes");
  assert.equal(canvasSlug(""), "untitled");
  const canvases = [
    { id: "c1", title: "Release test plan", ownerType: "channel", body: "# Plan" },
    { id: "c2", title: "Notes", ownerType: "member", body: "n" },
  ];
  assert.equal(canvasMentionToken(canvases[0]), "canvas:release-test-plan");
  assert.deepEqual(canvasMentions("Eva, update @canvas:release-test-plan and @canvas:notes @canvas:notes"), ["release-test-plan", "notes"]);
  assert.deepEqual(canvasMentions("mail me@canvas:x"), [], "a mention must start a token");
  assert.deepEqual(mentionedCanvases("see @canvas:notes", canvases).map((item) => item.id), ["c2"]);
  assert.equal(stripCanvasMentions("Eva, update @canvas:notes please"), "Eva, update please");
  assert.equal(isCanvasMentionQuery("can"), true);
  assert.equal(isCanvasMentionQuery("canvas:rel"), true);
  assert.equal(isCanvasMentionQuery("eva"), false);
  assert.deepEqual(canvasMentionItems(canvases, "canvas:rel").map((item) => item.token), ["canvas:release-test-plan"]);
  assert.equal(canvasMentionItems(canvases, "canv").length, 2, "a partial prefix lists every canvas");
  assert.match(canvasAttachmentText(canvases[0]), /```markdown\n# Plan\n```/);
  assert.match(canvasAttachmentText(canvases[0], { path: "/tmp/canvas/c1.md" }), /is the file \/tmp\/canvas\/c1\.md/);
  const expanded = expandCanvasMentions("Write the plan in @canvas:release-test-plan", canvases, { paths: { c1: "/x/c1.md" } });
  assert.deepEqual(expanded.canvases.map((item) => item.id), ["c1"]);
  assert.ok(expanded.prompt.startsWith("Write the plan in\n\nCanvas \"Release test plan\" is the file /x/c1.md."));
  assert.deepEqual(expandCanvasMentions("no mentions", canvases), { prompt: "no mentions", canvases: [] });
  assert.equal(revisionAuthorName({ authorId: "user" }, [{ id: "eva", name: "Eva" }]), "You");
  assert.equal(revisionAuthorName({ authorId: "eva" }, [{ id: "eva", name: "Eva" }]), "Eva");
  assert.equal(isMemberRevision({ authorId: "eva" }), true);
  assert.equal(isMemberRevision({ authorId: "user" }), false);

  console.log("check-canvases: ok");
} finally {
  await rm(stateDir, { recursive: true, force: true });
}
