// Harness resume ids per member (ADR-0113).
//
// Claude Code and Codex keep a conversation on disk under a session (thread)
// id. The bridge remembers that id per member and workspace in
// <agentHome>/harness-sessions.json (server/harness/registry.mjs) and passes
// it back as `--resume` / `exec resume` on the next turn. Until ADR-0113
// "New chat" only closed the Autohand SDK session and left these ids alone,
// so a Claude Code or Codex member silently carried the old context into the
// new conversation. These helpers move the ids with the conversation: a
// chat that is put away takes its ids with it, a chat that is opened again
// brings them back, and a fresh chat starts with none.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { sessionStorePath } from "../harness/registry.mjs";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** The whole store: `{ [harnessId]: { [workspace]: { resumeId, updatedAt } } }`. */
export async function readHarnessSessions(agentHome) {
  try {
    const parsed = JSON.parse(await readFile(sessionStorePath(agentHome), "utf8"));
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Keep only well-formed entries so a damaged file cannot travel into an archive. */
export function normalizeHarnessSessions(store) {
  const clean = {};
  if (!isPlainObject(store)) return clean;
  for (const [harnessId, byWorkspace] of Object.entries(store)) {
    // Built-in engines are plain ids; ACP agents are `acp:<registry id>` (ADR-0122).
    if (!/^(acp:)?[a-z0-9][a-z0-9._-]{0,60}$/.test(harnessId) || !isPlainObject(byWorkspace)) continue;
    const entries = {};
    for (const [workspace, entry] of Object.entries(byWorkspace)) {
      const resumeId = String(entry?.resumeId || "").trim();
      if (!workspace || !resumeId || resumeId.length > 200) continue;
      entries[workspace] = { resumeId, updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : "" };
    }
    if (Object.keys(entries).length) clean[harnessId] = entries;
  }
  return clean;
}

export function countHarnessSessions(store) {
  return Object.values(normalizeHarnessSessions(store)).reduce((total, entries) => total + Object.keys(entries).length, 0);
}

export async function writeHarnessSessions(agentHome, store) {
  const path = sessionStorePath(agentHome);
  await mkdir(dirname(path), { recursive: true });
  // Write-then-rename: a crash mid-write must not leave a torn file that
  // every later turn fails to parse.
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(normalizeHarnessSessions(store), null, 2), "utf8");
  await rename(temp, path);
}

/** Read the ids and forget them; returns what was there. */
export async function captureHarnessSessions(agentHome) {
  const sessions = normalizeHarnessSessions(await readHarnessSessions(agentHome));
  await writeHarnessSessions(agentHome, {});
  return sessions;
}

/** Forget every id; returns how many were forgotten. */
export async function clearHarnessSessions(agentHome) {
  const count = countHarnessSessions(await readHarnessSessions(agentHome));
  if (count) await writeHarnessSessions(agentHome, {});
  return count;
}

/** Put archived ids back in place of whatever is there. */
export async function restoreHarnessSessions(agentHome, sessions) {
  const clean = normalizeHarnessSessions(sessions);
  await writeHarnessSessions(agentHome, clean);
  return countHarnessSessions(clean);
}
