#!/usr/bin/env node
// Staged engine changes are written through to the turn's folders as they
// are announced (ADR-0161 §15), so a member checking its work on disk sees
// it; at the end only what could not be written is accepted and the staged
// copy of the rest is dropped, so it cannot replay over later shell work.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChangeBatches } from "../server/change-batches.mjs";

const root = await mkdtemp(join(tmpdir(), "squad-change-batches-"));
const workspace = join(root, "workspace"); const outside = join(root, "outside");
await mkdir(workspace); await mkdir(outside);
await writeFile(join(workspace, "old.txt"), "old");
await symlink(outside, join(workspace, "escape"));

const decisions = [];
const sdk = { async decideChanges(params) { decisions.push(params); return { appliedCount: params.action === "accept_selected" ? params.selectedChangeIds.length : 0 }; } };
const update = (id, filePath, changeType, proposedContent) => ({ type: "unknown_notification", method: "autohand.changesBatchUpdate", params: { batchId: "b1", change: { id, filePath, changeType, proposedContent } } });
const batches = new ChangeBatches();
batches.bind(sdk, [workspace]);

batches.observe(sdk, update("c1", "index.html", "create", "<h1>Pies</h1>"));
batches.observe(sdk, update("c2", join(workspace, "css", "styles.css"), "create", "body{}"));
batches.observe(sdk, update("c3", "index.html", "modify", "<h1>Pies, again</h1>"));
batches.observe(sdk, update("c4", "old.txt", "delete", ""));
batches.observe(sdk, update("c5", join(outside, "x.txt"), "create", "no"));
batches.observe(sdk, update("c6", "escape/y.txt", "create", "no"));
// The member checks its work mid-turn: it is on disk, in announcement order.
await batches.writes.get(sdk);
assert.equal(await readFile(join(workspace, "index.html"), "utf8"), "<h1>Pies, again</h1>", "later staged content wins, as it did in the engine");
assert.equal(await readFile(join(workspace, "css", "styles.css"), "utf8"), "body{}", "missing folders are created");
assert.equal(existsSync(join(workspace, "old.txt")), false, "a staged delete removes the file");
assert.equal(existsSync(join(outside, "x.txt")), false, "nothing is written outside the turn's folders");
assert.equal(existsSync(join(outside, "y.txt")), false, "a symlink cannot carry a write out of the workspace");

// A shell write after the staged ones is not undone at the end.
await writeFile(join(workspace, "index.html"), "<h1>Written by the shell</h1>");
batches.observe(sdk, { type: "unknown_notification", method: "autohand.changesBatchEnd", params: { batchId: "b1", changeCount: 6 } });
const result = await batches.settle(sdk, { accept: true });
assert.deepEqual(decisions.at(-1), { batchId: "b1", action: "accept_selected", selectedChangeIds: ["c5", "c6"] }, "only what could not be written is left to the engine");
assert.equal(await readFile(join(workspace, "index.html"), "utf8"), "<h1>Written by the shell</h1>");
assert.equal(result.applied, 6, "four written through, two applied by the engine");

// Everything inside the workspace: the staged copy is dropped.
const only = new ChangeBatches(); only.bind(sdk, [workspace]);
only.observe(sdk, { ...update("d1", "a.txt", "create", "a"), params: { batchId: "b2", change: { id: "d1", filePath: "a.txt", changeType: "create", proposedContent: "a" } } });
only.observe(sdk, { type: "unknown_notification", method: "autohand.changesBatchEnd", params: { batchId: "b2", changeCount: 1 } });
const dropped = await only.settle(sdk, { accept: true });
assert.deepEqual(decisions.at(-1), { batchId: "b2", action: "reject_all" });
assert.equal(dropped.applied, 1); assert.deepEqual(dropped.files, ["a.txt"]);
assert.match(ChangeBatches.summary(dropped), /Applied 1 file change \(a\.txt\)/);

// No folders bound (older call paths): the engine applies the batch as before.
const unbound = new ChangeBatches();
unbound.observe(sdk, { type: "unknown_notification", method: "autohand.changesBatchUpdate", params: { batchId: "b3", change: { id: "e1", filePath: "z.txt", changeType: "create", proposedContent: "z" } } });
unbound.observe(sdk, { type: "unknown_notification", method: "autohand.changesBatchEnd", params: { batchId: "b3", changeCount: 1 } });
await unbound.settle(sdk, { accept: true });
assert.deepEqual(decisions.at(-1), { batchId: "b3", action: "accept_all" });

// A stopped reply: what landed stays, the staged copy is dropped.
const stopped = new ChangeBatches(); stopped.bind(sdk, [workspace]);
stopped.observe(sdk, { type: "unknown_notification", method: "autohand.changesBatchUpdate", params: { batchId: "b4", change: { id: "f1", filePath: "f.txt", changeType: "create", proposedContent: "f" } } });
stopped.observe(sdk, { type: "unknown_notification", method: "autohand.changesBatchEnd", params: { batchId: "b4", changeCount: 1 } });
await stopped.settle(sdk, { accept: false });
assert.deepEqual(decisions.at(-1), { batchId: "b4", action: "reject_all" });
assert.equal(await readFile(join(workspace, "f.txt"), "utf8"), "f");

await rm(root, { recursive: true, force: true });
console.log("check-change-batches: ok");
