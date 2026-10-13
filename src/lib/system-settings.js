// Pure helpers for the Usage ledger tables and the Settings → System section
// (ADR-0105). No React, no DOM: scripts/check-usage-and-system.mjs imports
// this file under Node.

export const USAGE_TABLE_IDS = Object.freeze(["byMember", "byModel", "byDay"]);

/** "1 min 35 sec", "1 hour 35 min", "12 sec", "—" for nothing. */
export function formatUsageDuration(ms) {
  const total = Math.max(0, Math.round(Number(ms) || 0));
  if (!total) return "—";
  const seconds = Math.round(total / 1000);
  if (seconds < 60) return `${seconds} sec`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const rest = seconds % 60;
    return rest ? `${minutes} min ${rest} sec` : `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes ? `${hours} hour ${restMinutes} min` : `${hours} hour`;
}

export function formatUsageCount(value, locale = "en") {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  try {
    return new Intl.NumberFormat(locale || "en").format(Math.round(numeric));
  } catch {
    return String(Math.round(numeric));
  }
}

/** Steps are only shown when at least one record in the row reported them. */
export function formatUsageSteps(value, locale = "en") {
  if (value === null || value === undefined) return "—";
  return formatUsageCount(value, locale);
}

/** A calendar day key (YYYY-MM-DD) as a short local date; other labels pass through. */
export function formatUsageDay(label, locale = "en") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(label || ""))) return String(label || "");
  const [year, month, day] = String(label).split("-").map(Number);
  try {
    return new Intl.DateTimeFormat(locale || "en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
  } catch {
    return String(label);
  }
}

/**
 * The three tables the Usage page renders, in display order, from the
 * `usage` block of /api/analytics. Rows are passed through untouched; the
 * caller formats cells.
 */
export function usageTables(usage = {}, copy = {}) {
  const rows = (key) => (Array.isArray(usage?.[key]) ? usage[key] : []);
  return [
    { id: "byMember", title: copy.usageByMember || "By member", rows: rows("byMember"), labelHeading: copy.usageMember || "Member" },
    { id: "byModel", title: copy.usageByModel || "By model", rows: rows("byModel"), labelHeading: copy.usageModel || "Model" },
    { id: "byDay", title: copy.usageByDay || "By day", rows: rows("byDay"), labelHeading: copy.usageDay || "Day" },
  ];
}

export function usageLedgerEmpty(usage = {}) {
  return usageTables(usage).every((table) => table.rows.length === 0);
}

/**
 * Whether the browser's unattended update check should run. The bridge
 * reports the switch on every /api/updates answer; until the first answer
 * arrives the browser asks once (the bridge itself skips the repository
 * call when the switch is off, so that first ask is harmless).
 */
export function shouldAutoCheckUpdates(status) {
  if (!status || typeof status !== "object") return true;
  return status.autoCheck !== false;
}

/** Rows for the System section's counts. */
export function systemCountRows(summary = {}, copy = {}) {
  return [
    { id: "members", label: copy.systemMembers || "Members", value: summary.members },
    { id: "channels", label: copy.systemChannels || "Channels", value: summary.channels },
    { id: "threads", label: copy.systemThreads || "Threads", value: summary.threads },
    { id: "messages", label: copy.systemMessages || "Messages", value: summary.messages },
    { id: "memoryEntries", label: copy.systemMemoryEntries || "Memory entries", value: summary.memoryEntries },
  ];
}
