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

export const CHANGES_BATCH_END = "autohand.changesBatchEnd";
export const CHANGES_BATCH_UPDATE = "autohand.changesBatchUpdate";

export class ChangeBatches {
  constructor({ log = () => {} } = {}) {
    this.log = log;
    this.open = new Map();
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
    if (!batches.has(batchId)) batches.set(batchId, { batchId, files: [], changeCount: 0, ended: false });
    return batches.get(batchId);
  }

  /**
   * Decide every ended batch of this session: accept them, or reject them when
   * the turn was stopped. Returns { applied, rejected, files, errors }.
   */
  async settle(sdk, { accept = true } = {}) {
    const batches = this.open.get(sdk);
    const result = { applied: 0, rejected: 0, files: [], errors: [] };
    if (!batches) return result;
    for (const entry of Array.from(batches.values())) {
      if (!entry.ended) continue;
      batches.delete(entry.batchId);
      if (!entry.changeCount) continue;
      const decide = sdk?.client?.decideChanges?.bind(sdk.client) || sdk?.decideChanges?.bind(sdk);
      if (!decide) { result.errors.push(`${entry.batchId}: the SDK cannot decide change batches`); continue; }
      try {
        const outcome = await decide({ batchId: entry.batchId, action: accept ? "accept_all" : "reject_all" });
        if (accept) {
          result.applied += Number(outcome?.appliedCount ?? entry.changeCount) || 0;
          result.files.push(...entry.files);
          for (const failure of Array.isArray(outcome?.errors) ? outcome.errors : []) result.errors.push(`${failure.changeId || entry.batchId}: ${failure.error || "could not apply"}`);
        } else {
          result.rejected += entry.changeCount;
        }
      } catch (error) {
        result.errors.push(`${entry.batchId}: ${error?.message || error}`);
        this.log(`change batch ${entry.batchId} was not ${accept ? "applied" : "rejected"}: ${error?.message || error}`);
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
