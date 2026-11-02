// The engine's proposed file changes, accepted so they reach the disk
// (ADR-0161).
//
// In RPC mode Autohand Code 0.9.7 keeps preview mode on: every file a tool
// writes during a turn is staged, announced as `autohand.changesBatchUpdate`,
// and at turn end `autohand.changesBatchEnd` names the batch and waits for
// the client's `autohand.changesDecision`. Squad never sent one, so a member
// could report "Added 27 lines" and leave nothing in the repository. The
// permission card (or the member's allow rules) is the gate Squad means; a
// batch that reaches its end is therefore accepted, and a turn the person
// stopped is rejected rather than half-applied.

import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { withDeadline } from "./deadline.mjs";

// Write-through (ADR-0161 §15). Staged changes were invisible on disk until
// the reply ended, so a member that checked its work with `ls` or `cat` saw
// nothing, concluded its file tools were broken, rewrote everything through
// the shell, and then the batch applied at the end on top of the shell's
// files: on the 0.1.16 demo run an 11-line test index.html replaced the
// real one. Each staged change inside the turn's folders is now written as
// it is announced, so the disk always matches what the member was told; at
// the end only what could not be written (outside those folders) is accepted
// and the engine's staged copy of the rest is dropped.

export const CHANGES_BATCH_END = "autohand.changesBatchEnd";
export const CHANGES_BATCH_UPDATE = "autohand.changesBatchUpdate";

export class ChangeBatches {
  constructor({ log = () => {}, fs = { mkdir, realpath, rm, writeFile } } = {}) {
    this.log = log;
    this.fs = fs;
    this.open = new Map();
    this.roots = new WeakMap();
    this.writes = new WeakMap();
  }

  /** The folders this session's turn may write in: the workspace and its extra folders. */
  bind(sdk, roots = []) {
    const list = [...new Set((Array.isArray(roots) ? roots : []).filter((root) => typeof root === "string" && isAbsolute(root)).map((root) => resolve(root)))];
    this.roots.set(sdk, list);
  }

  /** Where a staged change lands, or "" when it is outside every bound folder. */
  async target(sdk, filePath) {
    const roots = this.roots.get(sdk) || [];
    if (!roots.length || !filePath) return "";
    const absolute = isAbsolute(filePath) ? resolve(filePath) : resolve(roots[0], filePath);
    // Resolve the nearest existing parent, so a symlink cannot carry a write out.
    let probe = dirname(absolute);
    let real = "";
    while (!real) {
      try { real = await this.fs.realpath(probe); } catch { const up = dirname(probe); if (up === probe) return ""; probe = up; }
    }
    const landing = resolve(real, relative(probe, absolute));
    for (const root of roots) {
      let realRoot = root;
      try { realRoot = await this.fs.realpath(root); } catch { continue; }
      if (landing === realRoot || landing.startsWith(realRoot + sep)) return landing;
    }
    return "";
  }

  /** Apply one staged change to disk, in announcement order per session. */
  writeThrough(sdk, entry, change) {
    const previous = this.writes.get(sdk) || Promise.resolve();
    const next = previous.then(async () => {
      const id = String(change?.id || "");
      const path = await this.target(sdk, String(change?.filePath || ""));
      if (!path || !id) { if (id) entry.pending.add(id); return; }
      try {
        if (change.changeType === "delete") await this.fs.rm(path, { force: true });
        else {
          await this.fs.mkdir(dirname(path), { recursive: true });
          await this.fs.writeFile(path, String(change.proposedContent ?? ""), "utf8");
        }
        entry.written.add(id);
        entry.pending.delete(id);
      } catch (error) {
        entry.pending.add(id);
        this.log(`change ${id} could not be written through to ${path}: ${error?.message || error}`);
      }
    });
    this.writes.set(sdk, next.catch(() => {}));
    return next;
  }

  /** Record what an engine event says about staged changes. Returns true when the event was a batch event. */
  observe(sdk, event) {
    if (event?.type !== "unknown_notification") return false;
    const params = event.params && typeof event.params === "object" ? event.params : {};
    const batchId = String(params.batchId || "");
    if (event.method === CHANGES_BATCH_UPDATE && batchId) {
      const entry = this.entry(sdk, batchId);
      const path = String(params.change?.filePath || "");
      if (path && !entry.files.includes(path)) entry.files.push(path);
      if (params.change && typeof params.change === "object") {
        if (this.roots.get(sdk)?.length) void this.writeThrough(sdk, entry, params.change);
        else if (params.change.id) entry.pending.add(String(params.change.id));
      }
      return true;
    }
    if (event.method === CHANGES_BATCH_END && batchId) {
      const entry = this.entry(sdk, batchId);
      entry.ended = true;
      entry.changeCount = Number(params.changeCount) || 0;
      return true;
    }
    return false;
  }

  entry(sdk, batchId) {
    const batches = this.open.get(sdk) || new Map();
    this.open.set(sdk, batches);
    if (!batches.has(batchId)) batches.set(batchId, { batchId, files: [], changeCount: 0, ended: false, written: new Set(), pending: new Set() });
    return batches.get(batchId);
  }

  /**
   * Decide every ended batch of this session: accept them, or reject them when
   * the turn was stopped. Returns { applied, rejected, files, errors }.
   */
  /**
   * Forget a session's staged batches without asking the engine: for a turn
   * whose engine stopped answering (ADR-0161 §13), the decision request
   * would wait five minutes for a reply that never comes, and the process is
   * about to be killed with its staging area.
   */
  discard(sdk) {
    const batches = this.open.get(sdk);
    this.open.delete(sdk);
    return batches ? batches.size : 0;
  }

  async settle(sdk, { accept = true, deadlineMs = 0 } = {}) {
    // Writes still on their way to disk finish before the batch is decided.
    await (this.writes.get(sdk) || Promise.resolve());
    const batches = this.open.get(sdk);
    const result = { applied: 0, rejected: 0, files: [], errors: [] };
    if (!batches) return result;
    for (const entry of Array.from(batches.values())) {
      if (!entry.ended) continue;
      batches.delete(entry.batchId);
      if (!entry.changeCount) continue;
      const written = entry.written.size;
      const pending = [...entry.pending];
      // Written through: the disk already has it; the engine's staged copy
      // is dropped so it cannot replay older content over later shell work.
      // Not written (outside the turn's folders, or no folders bound): the
      // engine applies it, or discards it when the reply was stopped.
      const action = !accept ? "reject_all" : !written ? "accept_all" : pending.length ? "accept_selected" : "reject_all";
      const decide = sdk?.client?.decideChanges?.bind(sdk.client) || sdk?.decideChanges?.bind(sdk);
      if (written) { result.applied += written; result.files.push(...entry.files); }
      if (!decide) { result.errors.push(`${entry.batchId}: the SDK cannot decide change batches`); continue; }
      try {
        const decision = decide({ batchId: entry.batchId, action, ...(action === "accept_selected" ? { selectedChangeIds: pending } : {}) });
        const outcome = await (deadlineMs > 0 ? withDeadline(decision, deadlineMs, "the change decision") : decision);
        if (action === "reject_all") {
          if (!accept) result.rejected += written ? pending.length : entry.changeCount;
        } else {
          result.applied += Number(outcome?.appliedCount ?? (action === "accept_all" ? entry.changeCount : pending.length)) || 0;
          if (!written) result.files.push(...entry.files);
          for (const failure of Array.isArray(outcome?.errors) ? outcome.errors : []) result.errors.push(`${failure.changeId || entry.batchId}: ${failure.error || "could not apply"}`);
        }
      } catch (error) {
        result.errors.push(`${entry.batchId}: ${error?.message || error}`);
        this.log(`change batch ${entry.batchId} was not decided (${action}): ${error?.message || error}`);
      }
    }
    if (!batches.size) this.open.delete(sdk);
    return result;
  }

  /** The chat line for a settled batch, or "" when nothing was written. */
  static summary(result) {
    if (!result) return "";
    if (result.applied) {
      const names = result.files.slice(0, 3).join(", ");
      const more = result.files.length > 3 ? ` and ${result.files.length - 3} more` : "";
      return `Applied ${result.applied} file ${result.applied === 1 ? "change" : "changes"}${names ? ` (${names}${more})` : ""}`;
    }
    if (result.rejected) return `Discarded ${result.rejected} staged file ${result.rejected === 1 ? "change" : "changes"} because the reply was stopped`;
    if (result.errors.length) return `File changes were not applied: ${result.errors[0]}`;
    return "";
  }
}
