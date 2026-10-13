// Runs queued follow-ups one at a time per member (ADR-0111).
//
// The dispatcher never launches a harness itself: `executeTurn` is the same
// bridge-owned turn goals use (server.mjs `executeChatTurn`), and the turn is
// registered as an active chat so presence shows Working, the member stop
// route aborts it, and the project observer defers to it.
//
// A member gets its next item only when it is free: no browser-owned chat in
// flight, no busy warm session, no live run, no running goal, not on a break,
// and its queue not paused. Anything else keeps the item queued; nothing is
// ever dropped or re-sent silently.

import { BREAK_PAUSE_REASON, STOP_PAUSE_REASON, publicItem } from "./store.mjs";

const POLL_MS = 1000;

export class QueueDispatcher {
  constructor({ store, executeTurn, isMemberBusy, availability, registerChat, emit = () => {}, cleanResult = (result) => result, now = () => Date.now() }) {
    this.store = store; this.executeTurn = executeTurn; this.isMemberBusy = isMemberBusy; this.availability = availability;
    this.registerChat = registerChat; this.emit = emit; this.cleanResult = cleanResult; this.now = now;
    this.workers = new Map();
    this.timer = null;
    this.ticking = false;
    this.stopped = false;
  }

  at() { return new Date(this.now()).toISOString(); }

  /** Subscribe to the bus events that can free a member, and poll while work waits. */
  attach(events) {
    for (const name of ["chat.finished", "run.finished", "member.stopped", "goal.finished", "member.availability"]) events.on(name, () => this.schedule());
    this.schedule();
  }

  close() {
    this.stopped = true;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  schedule() {
    if (this.stopped) return;
    setImmediate(() => this.tick().catch((error) => console.error(`queue dispatch failed: ${error?.message || error}`)));
  }

  async tick() {
    if (this.ticking || this.stopped) return;
    this.ticking = true;
    try {
      await this.store.ready;
      const waiting = new Set([...this.store.items.values()].filter((item) => item.status === "queued").map((item) => item.memberId));
      for (const memberId of waiting) {
        if (this.workers.has(memberId) || this.store.memberState(memberId).paused) continue;
        const item = this.store.nextQueued(memberId);
        if (!item) continue;
        if ((await this.availability?.get(memberId, item.launch?.agent || {}))?.onBreak) continue;
        if (await this.isMemberBusy(memberId)) continue;
        this.run(item);
      }
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      // Busy state in the session pool changes without an event; a slow poll
      // while anything waits keeps the queue honest without burning CPU.
      if (waiting.size) { this.timer = setTimeout(() => { this.timer = null; this.schedule(); }, POLL_MS); this.timer.unref?.(); }
    } finally { this.ticking = false; }
  }

  /** Cancel the running item of a member (if any) and pause its queue. */
  async stop(memberId, reason = STOP_PAUSE_REASON) {
    const worker = this.workers.get(memberId);
    const running = this.store.runningFor(memberId);
    if (running) await this.store.cancel(running.id);
    await this.store.setPaused(memberId, true, reason);
    worker?.controller.abort();
    return { cancelled: running ? running.id : null };
  }

  run(item) {
    const memberId = item.memberId;
    if (this.workers.has(memberId)) return;
    const controller = new AbortController();
    const worker = { controller, itemId: item.id, done: null };
    worker.done = (async () => {
      const unregister = this.registerChat?.(memberId, controller) || (() => {});
      const startedAt = this.now();
      try {
        await this.store.transition(item, { status: "running", startedAt: this.at(), error: "" });
        this.emit("queue.started", { memberId, itemId: item.id, text: item.text.slice(0, 140) });
        const result = this.cleanResult(await this.executeTurn({ ...item.launch, agentId: memberId, requestId: `queue-${item.id}`, mode: "prompt", prompt: item.text, resumeSession: true }, {
          signal: controller.signal,
          onEvent: (event, data) => {
            if (item.status !== "running") return;
            if (event === "progress" && data?.items?.length) {
              item.progress = { items: data.items, summary: String(data.summary || ""), outcome: "" }; item.updatedAt = this.at();
              this.store.save().catch(() => {});
            }
          },
        }));
        if (item.status !== "running") return;
        if (result?.declined) {
          await this.store.transition(item, { status: "failed", error: String(result.reply || "The member declined this follow-up."), finishedAt: this.at() });
          await this.store.setPaused(memberId, true, result.reason === "break" ? BREAK_PAUSE_REASON : `The member declined the follow-up. ${String(result.reply || "")}`.trim());
          return;
        }
        await this.store.transition(item, {
          status: "done", finishedAt: this.at(), reply: String(result?.reply || "").slice(0, 16000),
          progress: result?.progress ? { ...result.progress, outcome: "completed" } : item.progress ? { ...item.progress, outcome: "completed" } : null,
          result: { workspace: result?.workspace || item.workspace, transport: result?.transport || "", effectiveModel: result?.effectiveModel || null, durationMs: Number(result?.durationMs) || (this.now() - startedAt), command: result?.command || "", startedAt: result?.startedAt || item.startedAt, completedAt: result?.completedAt || this.at() },
        });
      } catch (error) {
        if (item.status === "running") {
          if (controller.signal.aborted) {
            const onBreak = Boolean((await this.availability?.get(memberId, item.launch?.agent || {}).catch(() => null))?.onBreak);
            await this.store.transition(item, { status: "cancelled", finishedAt: this.at(), error: onBreak ? "Cancelled because the member went on a break." : "Stopped by you." });
            await this.store.setPaused(memberId, true, onBreak ? BREAK_PAUSE_REASON : STOP_PAUSE_REASON);
          } else {
            const message = error?.reply || error?.message || String(error);
            await this.store.transition(item, { status: "failed", finishedAt: this.at(), error: message });
            // A failure pauses the queue so a person reads the cause before the
            // next follow-up builds on it (ADR-0066's "pause for attention").
            await this.store.setPaused(memberId, true, error?.reason === "break" ? BREAK_PAUSE_REASON : `The previous follow-up failed: ${message.slice(0, 200)}`);
          }
        } else if (controller.signal.aborted && item.status === "cancelled" && !this.store.memberState(memberId).paused) {
          await this.store.setPaused(memberId, true, STOP_PAUSE_REASON);
        }
      } finally {
        unregister();
        this.workers.delete(memberId);
        const snapshot = publicItem(item);
        this.emit("queue.finished", { memberId, itemId: item.id, status: item.status, preview: String(item.reply || item.error || "").slice(0, 140) });
        this.emit("chat.finished", { memberId, status: item.status === "done" ? "completed" : "failed", channelId: "", preview: String(item.reply || item.error || "").slice(0, 140), queueItemId: item.id, queueItem: snapshot });
        this.schedule();
      }
    })();
    this.workers.set(memberId, worker);
  }
}
