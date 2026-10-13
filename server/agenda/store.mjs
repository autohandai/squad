// Always-on agenda settings and the day's starts (ADR-0125).
//
// `<squadStateDir>/always-on.json`:
//   { version: 1,
//     members: { [memberId]: { enabled, dailyCap, updatedAt } },
//     days:    { [memberId]: { date: "YYYY-MM-DD", starts: [{ at, key, kind, title, runId, goalId, status, finishedAt, reason }] } } }
//
// Settings live on the bridge, not in the browser, so the switch holds while
// the app is closed (the same reason breaks do, ADR-0027). Writes go through
// the shared atomic JSON writer.

import { join } from "node:path";

import { readPersistentJson, writePersistentJson } from "../persistent-json.mjs";

export const STORE_FILE = "always-on.json";
export const DEFAULT_DAILY_CAP = 6;
export const MAX_DAILY_CAP = 24;
const MAX_STARTS_KEPT = 40;

export function normalizeDailyCap(value) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number) || number < 1) return DEFAULT_DAILY_CAP;
  return Math.min(number, MAX_DAILY_CAP);
}

export function normalizeSettings(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  return { enabled: source.enabled === true, dailyCap: normalizeDailyCap(source.dailyCap), updatedAt: String(source.updatedAt || "") };
}

/** The bridge's calendar date in `timeZone` ("2026-10-14"). */
export function dayKeyIn(date = new Date(), timeZone = undefined) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export class AgendaStore {
  constructor(squadStateDir) {
    this.filename = join(squadStateDir, STORE_FILE);
    this.state = { version: 1, members: {}, days: {} };
    this.writing = Promise.resolve();
    this.ready = readPersistentJson(this.filename, null).then((saved) => {
      if (saved && typeof saved === "object") {
        this.state.members = saved.members && typeof saved.members === "object" ? saved.members : {};
        this.state.days = saved.days && typeof saved.days === "object" ? saved.days : {};
      }
    }).catch(() => {});
  }

  save() {
    const snapshot = structuredClone({ ...this.state, updatedAt: new Date().toISOString() });
    this.writing = this.writing.catch(() => {}).then(() => writePersistentJson(this.filename, snapshot));
    return this.writing;
  }

  settings(memberId) {
    return normalizeSettings(this.state.members[memberId]);
  }

  enabledMembers() {
    return Object.keys(this.state.members).filter((id) => this.settings(id).enabled);
  }

  async setSettings(memberId, patch) {
    await this.ready;
    const current = this.settings(memberId);
    const next = normalizeSettings({ ...current, ...(patch && typeof patch === "object" ? patch : {}), updatedAt: new Date().toISOString() });
    this.state.members[memberId] = next;
    await this.save();
    return next;
  }

  today(memberId, date) {
    const day = this.state.days[memberId];
    return day && day.date === date ? day : { date, starts: [] };
  }

  async recordStart(memberId, date, start) {
    const day = this.today(memberId, date);
    this.state.days[memberId] = { date, starts: [...day.starts, start].slice(-MAX_STARTS_KEPT) };
    await this.save();
  }

  async settleStart(memberId, key, patch) {
    const day = this.state.days[memberId];
    const start = day?.starts?.findLast?.((item) => item.key === key && !item.finishedAt);
    if (!start) return null;
    Object.assign(start, patch);
    await this.save();
    return start;
  }
}
