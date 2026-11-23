// Bridge-held app settings (ADR-0105): <squadStateDir>/settings.json. Today it
// carries update preferences, which the bridge policy and browser honour.
// Unknown keys are preserved so a
// later section can add its own without a migration.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const SETTINGS_FILE = "settings.json";
// The app's avatar style, so the menu bar draws the same portraits (ADR-0272).
export const AVATAR_STYLES = ["flat", "3d", "clay"];

export const DEFAULT_SYSTEM_SETTINGS = Object.freeze({
  quickChatEnabled: true,
  quickChatMenuBarMode: "single",
  quickChatShowUsage: true,
  quickChatAppearance: "glass",
  menuBarAttentionDot: true,
  sidebarLiquidGlass: true,
  autoCheckUpdates: true,
  autoDownloadUpdates: false,
  avatarStyle: "flat",
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
    menuBarAttentionDot: source.menuBarAttentionDot !== false,
    sidebarLiquidGlass: source.sidebarLiquidGlass !== false,
    autoCheckUpdates: typeof source.autoCheckUpdates === "boolean" ? source.autoCheckUpdates : DEFAULT_SYSTEM_SETTINGS.autoCheckUpdates,
    autoDownloadUpdates: source.autoDownloadUpdates === true,
    avatarStyle: AVATAR_STYLES.includes(source.avatarStyle) ? source.avatarStyle : "flat",
  };
}

/** The public shape: known keys only. */
export function publicSystemSettings(settings) {
  const normalized = normalizeSystemSettings(settings);
  return { sidebarLiquidGlass: normalized.sidebarLiquidGlass, quickChatAppearance: normalized.quickChatAppearance, quickChatEnabled: normalized.quickChatEnabled, quickChatMenuBarMode: normalized.quickChatMenuBarMode, quickChatShowUsage: normalized.quickChatShowUsage, menuBarAttentionDot: normalized.menuBarAttentionDot, autoCheckUpdates: normalized.autoCheckUpdates, autoDownloadUpdates: normalized.autoDownloadUpdates, avatarStyle: normalized.avatarStyle };
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
    for (const key of ["quickChatEnabled", "quickChatShowUsage", "menuBarAttentionDot", "sidebarLiquidGlass"]) if (typeof patch[key] === "boolean") next[key] = patch[key];
    if (["glass", "solid"].includes(patch.quickChatAppearance)) next.quickChatAppearance = patch.quickChatAppearance;
    if (["single", "active-agents"].includes(patch.quickChatMenuBarMode)) next.quickChatMenuBarMode = patch.quickChatMenuBarMode;
    if (typeof patch.autoCheckUpdates === "boolean") next.autoCheckUpdates = patch.autoCheckUpdates;
    if (typeof patch.autoDownloadUpdates === "boolean") next.autoDownloadUpdates = patch.autoDownloadUpdates;
    if (AVATAR_STYLES.includes(patch.avatarStyle)) next.avatarStyle = patch.avatarStyle;
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
