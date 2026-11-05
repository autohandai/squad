// Bridge-held app settings (ADR-0105): <squadStateDir>/settings.json. Today it
// carries update preferences, which the bridge policy and browser honour.
// Unknown keys are preserved so a
// later section can add its own without a migration.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const SETTINGS_FILE = "settings.json";

export const DEFAULT_SYSTEM_SETTINGS = Object.freeze({
  quickChatEnabled: true,
  quickChatMenuBarMode: "single",
  quickChatShowUsage: true,
  quickChatAppearance: "glass",
  autoCheckUpdates: true,
  autoDownloadUpdates: false,
});

export function settingsPath(squadStateDir) {
  return join(squadStateDir, SETTINGS_FILE);
}

export function normalizeSystemSettings(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  return {
    ...source,
    quickChatEnabled: source.quickChatEnabled !== false,
    quickChatMenuBarMode: source.quickChatMenuBarMode === "active-agents" ? "active-agents" : "single",
    quickChatShowUsage: source.quickChatShowUsage !== false,
    quickChatAppearance: source.quickChatAppearance === "solid" ? "solid" : "glass",
    autoCheckUpdates: typeof source.autoCheckUpdates === "boolean" ? source.autoCheckUpdates : DEFAULT_SYSTEM_SETTINGS.autoCheckUpdates,
    autoDownloadUpdates: source.autoDownloadUpdates === true,
  };
}

/** The public shape: known keys only. */
export function publicSystemSettings(settings) {
  const normalized = normalizeSystemSettings(settings);
  return { quickChatAppearance: normalized.quickChatAppearance, quickChatEnabled: normalized.quickChatEnabled, quickChatMenuBarMode: normalized.quickChatMenuBarMode, quickChatShowUsage: normalized.quickChatShowUsage, autoCheckUpdates: normalized.autoCheckUpdates, autoDownloadUpdates: normalized.autoDownloadUpdates };
}

export async function readSystemSettings(squadStateDir) {
  try {
    const text = await readFile(settingsPath(squadStateDir), "utf8");
    return normalizeSystemSettings(JSON.parse(text));
  } catch {
    return normalizeSystemSettings({});
  }
}

/** Merge a patch into the stored settings; only known keys are accepted from the patch. */
const pendingWrites = new Map();
export function writeSystemSettings(squadStateDir, patch = {}) {
  const path = settingsPath(squadStateDir);
  const pending = (pendingWrites.get(path) || Promise.resolve()).catch(() => {}).then(() => saveSystemSettings(squadStateDir, patch));
  pendingWrites.set(path, pending);
  return pending.finally(() => { if (pendingWrites.get(path) === pending) pendingWrites.delete(path); });
}
async function saveSystemSettings(squadStateDir, patch) {
  const current = await readSystemSettings(squadStateDir);
  const next = { ...current };
  if (patch && typeof patch === "object") {
    for (const key of ["quickChatEnabled", "quickChatShowUsage"]) if (typeof patch[key] === "boolean") next[key] = patch[key];
    if (["glass", "solid"].includes(patch.quickChatAppearance)) next.quickChatAppearance = patch.quickChatAppearance;
    if (["single", "active-agents"].includes(patch.quickChatMenuBarMode)) next.quickChatMenuBarMode = patch.quickChatMenuBarMode;
    if (typeof patch.autoCheckUpdates === "boolean") next.autoCheckUpdates = patch.autoCheckUpdates;
    if (typeof patch.autoDownloadUpdates === "boolean") next.autoDownloadUpdates = patch.autoDownloadUpdates;
  }
  const path = settingsPath(squadStateDir);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await rename(temporary, path);
  return next;
}

/** Whether an unattended update check may run now. Manual checks ignore this. */
export function autoCheckUpdatesEnabled(settings) {
  return normalizeSystemSettings(settings).autoCheckUpdates !== false;
}
