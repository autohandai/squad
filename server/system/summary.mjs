// Settings → System counts (ADR-0105). Pure helpers over what is really on
// disk: web-status.json (members live in the browser and are mirrored there),
// channels.json (channels, threads, messages are top-level arrays) and each
// member's memory under <appStateDir>/agents/<id>/: profile/MEMORY.md bullet
// lines plus memory/index.json entries.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/** Bullet or numbered list lines in a MEMORY.md document; headings and prose do not count. */
export function countMemoryBullets(markdown) {
  let total = 0;
  for (const line of String(markdown || "").split(/\r?\n/)) {
    if (/^\s*(?:[-*+]|\d+[.)])\s+\S/.test(line)) total += 1;
  }
  return total;
}

/** Entries in a memory/index.json document ({ version, entries: [...] }). */
export function countMemoryIndexEntries(index) {
  if (!index || typeof index !== "object") return 0;
  return Array.isArray(index.entries) ? index.entries.length : 0;
}

async function readText(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

/**
 * Walk <agentsDir>/<id>/ for every member folder (the observers folder is
 * the bridge's own and is skipped) and count memory entries.
 */
export async function countMemoryEntries(agentsDir) {
  let entries;
  try {
    entries = await readdir(agentsDir, { withFileTypes: true });
  } catch {
    return { memoryEntries: 0, memoryDocuments: 0, members: 0 };
  }
  let memoryEntries = 0;
  let memoryDocuments = 0;
  let members = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "observers" || entry.name.startsWith(".")) continue;
    members += 1;
    const home = join(agentsDir, entry.name);
    const markdown = await readText(join(home, "profile", "MEMORY.md"));
    if (markdown) {
      memoryDocuments += 1;
      memoryEntries += countMemoryBullets(markdown);
    }
    const indexText = await readText(join(home, "memory", "index.json"));
    if (indexText) {
      try {
        memoryEntries += countMemoryIndexEntries(JSON.parse(indexText));
      } catch {
        // A damaged index counts nothing rather than failing the summary.
      }
    }
  }
  return { memoryEntries, memoryDocuments, members };
}

function listLength(value) {
  return Array.isArray(value) ? value.length : 0;
}

/**
 * Counts for the System section.
 *   webStatus      parsed web-status.json or null
 *   channelsState  ctx.readChannelsState() result
 *   memory         countMemoryEntries() result
 */
export function systemSummary({ webStatus = null, channelsState = null, memory = null, squadStateDir = "", appStateDir = "", now = new Date() } = {}) {
  const channels = Array.isArray(channelsState?.channels) ? channelsState.channels : [];
  // Older channel files nested threads and messages under each channel; the
  // current store keeps them top-level. Count whichever shape is present.
  const nestedThreads = channels.reduce((sum, channel) => sum + listLength(channel?.threads), 0);
  const nestedMessages = channels.reduce((sum, channel) => sum + listLength(channel?.messages), 0);
  const webMembers = Array.isArray(webStatus?.members) ? webStatus.members : [];
  return {
    members: webMembers.length || Number(memory?.members) || 0,
    channels: channels.length,
    threads: listLength(channelsState?.threads) || nestedThreads,
    messages: listLength(channelsState?.messages) || nestedMessages,
    memoryEntries: Number(memory?.memoryEntries) || 0,
    memoryDocuments: Number(memory?.memoryDocuments) || 0,
    dataFolder: squadStateDir,
    memberStateFolder: appStateDir,
    membersSource: webMembers.length ? "web-status" : "member-folders",
    updatedAt: now instanceof Date ? now.toISOString() : String(now),
  };
}
