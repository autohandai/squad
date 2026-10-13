// Bridge-held app settings (ADR-0105): <squadStateDir>/settings.json. Today it
// carries one key, `autoCheckUpdates`, which the bridge's update status and
// the browser's automatic check both honour. Unknown keys are preserved so a
// later section can add its own without a migration.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const SETTINGS_FILE = "settings.json";

export const DEFAULT_SYSTEM_SETTINGS = Object.freeze({
  autoCheckUpdates: true,
});

export function settingsPath(squadStateDir) {
  return join(squadStateDir, SETTINGS_FILE);
}

export function normalizeSystemSettings(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  return {
    ...source,
    autoCheckUpdates: typeof source.autoCheckUpdates === "boolean" ? source.autoCheckUpdates : DEFAULT_SYSTEM_SETTINGS.autoCheckUpdates,
  };
}

/** The public shape: known keys only. */
export function publicSystemSettings(settings) {
  const normalized = normalizeSystemSettings(settings);
  return { autoCheckUpdates: normalized.autoCheckUpdates };
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
export async function writeSystemSettings(squadStateDir, patch = {}) {
  const current = await readSystemSettings(squadStateDir);
  const next = { ...current };
  if (patch && typeof patch === "object") {
    if (typeof patch.autoCheckUpdates === "boolean") next.autoCheckUpdates = patch.autoCheckUpdates;
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
