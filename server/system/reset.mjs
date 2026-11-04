import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { isAbsolute, join, relative, resolve } from "node:path";

// These describe services which survive the archive, not the person's team.
// The supervisor needs the original PID/start time and launch path to recover.
export const RESET_RUNTIME_FILES = ["daemon.json", "analytics.json", "web-server.json", "tray.json", "native-grant-token", "reset-progress.json"];

export async function readResetProgress(stateDir) {
  try { return JSON.parse(await readFile(join(stateDir, "reset-progress.json"), "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

export async function writeResetProgress(stateDir, progress) {
  await mkdir(stateDir, { recursive: true });
  const temporary = join(stateDir, `.reset-progress-${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(progress), { mode: 0o600, flag: "wx" });
  await rename(temporary, join(stateDir, "reset-progress.json"));
}

function topLevelFolders(folders) {
  const unique = [...new Set(folders.filter(Boolean).map(folder => resolve(folder)))];
  return unique.filter(folder => !unique.some(parent => {
    if (parent === folder) return false;
    const path = relative(parent, folder);
    return path && path !== ".." && !path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(path);
  }));
}

export async function archiveSquadState({ squadStateDir, appStateDir, memberWorkspaceRoots = [], moveFolder = rename }) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const ownership = [];
  for (const name of RESET_RUNTIME_FILES) {
    const path = join(squadStateDir, name);
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Squad's service record ${name} is not a regular file.`);
      ownership.push({ name, bytes: await readFile(path), mode: info.mode & 0o777 });
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const moved = [];
  try {
    for (const folder of topLevelFolders([squadStateDir, appStateDir, ...memberWorkspaceRoots])) {
      const backup = `${folder}.reset-${stamp}`;
      try { await moveFolder(folder, backup); moved.push({ folder, backup }); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    if (ownership.length) await mkdir(squadStateDir, { recursive: true });
    for (const record of ownership) {
      try { await writeFile(join(squadStateDir, record.name), record.bytes, { flag: "wx", mode: record.mode }); }
      // A surviving service can have refreshed its own record already.
      catch (error) { if (error.code !== "EEXIST") throw error; }
    }
  } catch (failure) {
    // A failed reset is recoverable. Retain anything a service recreated,
    // then put every successfully archived folder back in reverse order.
    const rollbackErrors = [];
    for (const entry of [...moved].reverse()) {
      try {
        try { await moveFolder(entry.folder, `${entry.folder}.reset-recovery-${stamp}`); }
        catch (error) { if (error.code !== "ENOENT") throw error; }
        await moveFolder(entry.backup, entry.folder);
      } catch (error) { rollbackErrors.push(error); }
    }
    if (rollbackErrors.length) throw new Error("Reset could not finish restoring its folders. The dated backups were kept; restart Squad and check its logs.", { cause: failure });
    throw failure;
  }
  return { resetId: stamp, previousPid: process.pid, moved, preservedRuntime: ownership.map(record => record.name), restarting: true };
}
