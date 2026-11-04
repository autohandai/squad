import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archiveSquadState, RESET_RUNTIME_FILES } from "../server/system/reset.mjs";

const directory = await mkdtemp(join(tmpdir(), "squad-reset-archive-"));
try {
  const squad = join(directory, "squad"), app = join(directory, "app");
  await mkdir(squad); await mkdir(app);
  for (const name of RESET_RUNTIME_FILES) await writeFile(join(squad, name), `owned-${name}`, { mode: 0o600 });
  await writeFile(join(squad, "history"), "old chats");
  await writeFile(join(app, "member"), "old member");
  const account = join(directory, "account.json"); await writeFile(account, "untouched sign-in");
  const receipt = await archiveSquadState({ squadStateDir: squad, appStateDir: app, memberWorkspaceRoots: [join(app, "nested"), app] });
  assert.equal(receipt.moved.length, 2, "nested and duplicate roots are archived exactly once");
  for (const name of RESET_RUNTIME_FILES) {
    assert.equal(await readFile(join(squad, name), "utf8"), `owned-${name}`);
    if (process.platform !== "win32") assert.equal((await stat(join(squad, name))).mode & 0o777, 0o600);
  }
  assert.equal(await readFile(join(receipt.moved[0].backup, "history"), "utf8"), "old chats");
  await assert.rejects(readFile(join(squad, "history")), { code: "ENOENT" });
  assert.equal(await readFile(account, "utf8"), "untouched sign-in");

  const failedSquad = join(directory, "failed-squad"), failedApp = join(directory, "failed-app");
  await mkdir(failedSquad); await mkdir(failedApp);
  await writeFile(join(failedSquad, "history"), "restore these chats");
  await writeFile(join(failedApp, "member"), "keep this member");
  let failed = false;
  await assert.rejects(archiveSquadState({ squadStateDir: failedSquad, appStateDir: failedApp, moveFolder: async (from, to) => {
    if (from === failedApp && !failed) { failed = true; throw Object.assign(new Error("fixture rename denied"), { code: "EACCES" }); }
    return rename(from, to);
  } }), /fixture rename denied/);
  assert.equal(await readFile(join(failedSquad, "history"), "utf8"), "restore these chats");
  assert.equal(await readFile(join(failedApp, "member"), "utf8"), "keep this member");
  console.log("PASS reset preserves service ownership and modes, archives nested roots once, retains sign-in, and rolls back a partial archive failure.");
} finally { await rm(directory, { recursive: true, force: true }); }
