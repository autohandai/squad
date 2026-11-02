import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Workflow } from "lucide-react";

import { ActivityFeed } from "@/components/activity/ActivityFeed";
import { CopyButton } from "@/components/chat/CopyButton";
import { Button } from "@/components/ui/button";
import { activityStats, chatWorkActivity, normalizeActivity } from "@/lib/activity";
import { groupRunsByDay, isLiveRun, runDurationLabel, runMetaParts, runStatusWord, runTimeLabel, trimTitle } from "@/lib/execution-panel";
import { cn } from "@/lib/utils";

import { EmptyLine, GroupLabel, StatusDot } from "./bits";

/**
 * Runs tab (ADR-0117): one divider list grouped by day, one line per run.
 * A reply and a launched run share the list; the row is the member, the
 * person's question, and the time, with engine and model only where they
 * differ from what the member usually runs with.
 *
 *   runs         this member's runs from GET /api/runs (any order)
 *   tasks        tasks, to mark a run that has a linked task
 *   agents       the roster, for the avatar and name
 *   AgentAvatar  the app's avatar component
 *   api          the app's bridge client, for Stop and the activity route
 *   onHandoff    (run) => open the handoff dialog
 *   focusRunId   `?panel=runs&run=<id>`: scroll to that run with output open
 */
export function RunList({ runs = [], tasks = [], agents = [], copy = {}, locale = "en-US", AgentAvatar, api, onHandoff, focusRunId = "", now, diagnostics = false }) {
  // A history link (?panel=runs&run=<id>) lands on that run with its output open.
  useEffect(() => {
    if (!focusRunId) return;
    document.getElementById(`run-${focusRunId}`)?.scrollIntoView({ block: "start" });
  }, [focusRunId, runs.length]);

  const groups = useMemo(() => groupRunsByDay(runs, { now, locale, copy }), [runs, now, locale, copy]);
  const linkedRunIds = useMemo(() => new Set(tasks.map((task) => task?.runtimeId).filter(Boolean)), [tasks]);

  if (!runs.length) {
    return <EmptyLine>{copy.runsAppearAfterLaunch || "Replies and launched runs appear here, whichever engine the member runs on."}</EmptyLine>;
  }
  return (
    <div data-testid="execution-runs">
      {groups.map((group) => (
        <section key={group.day || "undated"} aria-label={group.label}>
          <GroupLabel>{group.label}</GroupLabel>
          <div className="divide-y divide-border/70">
            {group.runs.map((run) => (
              <RunRow
                key={run.id}
                run={run}
                agent={agents.find((agent) => agent.id === run.agentId)}
                linked={linkedRunIds.has(run.id)}
                copy={copy}
                locale={locale}
                now={now}
                AgentAvatar={AgentAvatar}
                api={api}
                onHandoff={onHandoff}
                focused={Boolean(focusRunId) && run.id === focusRunId}
                diagnostics={diagnostics}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function RunRow({ run, agent, linked, copy, locale, now, AgentAvatar, api, onHandoff, focused, diagnostics = false }) {
  const [stopping, setStopping] = useState(false);
  const [retry, setRetry] = useState({ busy: false, note: "" });
  const live = isLiveRun(run);
  // A turn the restart cut short (ADR-0123): Retry sends the same request
  // again through the member's queue; the row then says it was retried.
  const retryable = run.status === "interrupted" && run.retryable !== false && !run.retryItemId && Boolean(api);

  async function retryRun() {
    if (!api || retry.busy) return;
    setRetry({ busy: true, note: "" });
    try {
      const data = await api(`/api/runs/${encodeURIComponent(run.id)}/retry`, { method: "POST" });
      setRetry({ busy: false, note: data?.paused ? copy.retryQueuedPaused || "Queued. The member's queue is paused; resume it to run." : copy.retryQueued || "Queued; it runs when the member is free." });
    } catch (error) {
      setRetry({ busy: false, note: error?.message || copy.retryFailed || "Could not retry." });
    }
  }
  const statusWord = runStatusWord(run, copy);
  const meta = runMetaParts(run, agent, { copy, linked });
  const title = trimTitle(run.title) || copy.chatRun || "chat reply";

  async function stop() {
    if (!api || stopping) return;
    setStopping(true);
    setRetry((current) => ({ ...current, note: "" }));
    try {
      await api(`/api/runs/${encodeURIComponent(run.id)}/stop`, { method: "POST" });
    } catch (error) {
      // A failed stop used to leave the row live with no word of why.
      setRetry((current) => ({ ...current, note: `${copy.stopFailed || "Could not stop this run"}: ${error?.message || "the bridge did not answer"}` }));
    } finally {
      setStopping(false);
    }
  }

  return (
    <article id={`run-${run.id}`} className="group py-2.5" data-run-status={run.status}>
      <div className="flex items-center gap-2.5">
        <StatusDot status={run.status} />
        {AgentAvatar ? <AgentAvatar agent={agent} className="size-5 border-0" /> : null}
        <span className="shrink-0 text-sm font-medium text-foreground">{agent?.name || run.agentId || copy.squad || "Squad"}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-foreground" title={run.title}>
          {title}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {live && api ? (
            <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-xs text-muted-foreground" onClick={stop} disabled={stopping}>
              {copy.stop || "Stop"}
            </Button>
          ) : null}
          {retryable ? (
            <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-xs text-muted-foreground" onClick={retryRun} disabled={retry.busy}>
              {copy.retry || "Retry"}
            </Button>
          ) : null}
          {onHandoff ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-6 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
              aria-label={copy.handoff || "Handoff"}
              title={copy.handoff || "Handoff"}
              onClick={() => onHandoff(run)}
            >
              <Workflow className="size-3.5" />
            </Button>
          ) : null}
          <time className="min-w-[3.5rem] text-right text-xs tabular-nums text-muted-foreground" dateTime={run.startedAt || undefined}>
            {runTimeLabel(run, { now, locale })}
          </time>
        </span>
      </div>
      <div className="pl-[1.125rem] sm:pl-[2.6rem]">
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {statusWord ? <span className={cn(run.status === "failed" ? "text-destructive" : "text-amber-700 dark:text-amber-300")}>{statusWord} · </span> : null}
          {meta.join(" · ")}
        </p>
        {retry.note ? <p className="mt-0.5 text-xs text-muted-foreground" role="status">{retry.note}</p> : null}
        <RunActivity run={run} copy={copy} api={api} initialOpen={focused} diagnostics={diagnostics} />
      </div>
    </article>
  );
}

/**
 * What a run did, in the chat's words (ADR-0163): the same Work details line
 * the reply carries ("Work details · 4 tools · 1m 12s"), the reply text for a
 * chat turn, and the activity feed with the engine's status chatter, thoughts
 * and message echoes filtered out. The command line and the Raw toggle appear
 * only with the diagnostic-output chat setting on; a person reading the Runs
 * tab is reading what the member did, not how the bridge started it.
 *
 * The feed folds `run.logs` (the tail the runs list carries); once a run has
 * finished and the disclosure is open, the full history comes from
 * `GET /api/runs/:id/activity`.
 */
export function RunActivity({ run, copy = {}, api, initialOpen = false, diagnostics = false }) {
  const [open, setOpen] = useState(Boolean(initialOpen));
  useEffect(() => {
    if (initialOpen) setOpen(true);
  }, [initialOpen]);
  const [showRaw, setShowRaw] = useState(false);
  const [history, setHistory] = useState(null);
  const logs = Array.isArray(run.logs) ? run.logs : [];
  const finished = !isLiveRun(run);
  const localItems = useMemo(() => normalizeActivity(logs, { status: run.status }), [logs, run.status]);

  useEffect(() => {
    if (!open || !finished || !api || history?.runId === run.id) return undefined;
    let cancelled = false;
    api(`/api/runs/${encodeURIComponent(run.id)}/activity`)
      .then((data) => {
        if (cancelled || !data || !Array.isArray(data.items)) return;
        setHistory({ runId: run.id, items: data.items, raw: Array.isArray(data.raw) ? data.raw : logs });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, finished, api, run.id, history?.runId, logs]);

  const useHistory = finished && history?.runId === run.id;
  const allItems = useHistory ? history.items : localItems;
  const items = useMemo(() => chatWorkActivity(allItems, { diagnostics }), [allItems, diagnostics]);
  const raw = useHistory ? history.raw : logs;
  const reply = run.kind === "chat" || run.mode === "chat" ? String(run.reply || "").trim() : "";
  const stats = activityStats(items);
  const duration = runDurationLabel(run);
  // "Work details · 4 tools · 1m 12s"; a turn with nothing but an answer says
  // so, and a live turn says it is working rather than counting log lines.
  const summary = stats.rows
    ? [copy.workDetails || "Work details", stats.tools ? `${stats.tools} ${stats.tools === 1 ? copy.tool || "tool" : copy.tools || "tools"}` : `${stats.rows} ${stats.rows === 1 ? copy.update || "update" : copy.updates || "updates"}`, duration].filter(Boolean).join(" · ")
    : !finished
      ? copy.runWorking || "Working…"
      : reply
        ? [copy.runReplyOnly || "Reply only", duration].filter(Boolean).join(" · ")
        : [copy.runNoWork || "No work recorded", duration].filter(Boolean).join(" · ");
  const copyText = () => [reply, ...raw.map((entry) => (typeof entry === "string" ? entry : entry?.line ?? ""))].filter(Boolean).join("\n");

  return (
    <details className="mt-0.5 text-xs" open={open} onToggle={(event) => setOpen(event.currentTarget.open)} data-testid="run-work">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3 transition-transform [details[open]>summary>&]:rotate-90" aria-hidden="true" />
        {summary}
        {stats.failed ? <span className="text-destructive/80">· {stats.failed} {copy.failed || "failed"}</span> : null}
        {/* The reply and the output, as text, for a bug report or a terminal. */}
        {raw.length || reply ? <CopyButton text={copyText} label={copy.copyOutput || "Copy output"} className="size-5" /> : null}
      </summary>
      {reply ? (
        <p className="mt-2 line-clamp-6 whitespace-pre-wrap break-words text-xs text-foreground" title={reply.length > 600 ? reply : undefined} data-testid="run-reply">
          {reply.length > 600 ? `${reply.slice(0, 599)}…` : reply}
        </p>
      ) : null}
      {diagnostics && run.command ? <code className="mt-2 block truncate font-mono text-[11px] text-muted-foreground">{run.command}</code> : null}
      {items.length || (diagnostics && raw.length) ? (
        <ActivityFeed items={items} raw={raw} showRaw={diagnostics && showRaw} onToggleRaw={diagnostics ? () => setShowRaw((value) => !value) : undefined} copy={copy} className="mt-2" />
      ) : null}
    </details>
  );
}
