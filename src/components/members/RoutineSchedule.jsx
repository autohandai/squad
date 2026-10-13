import { useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DAY_LABELS, MONTH_LABELS, ROUTINE_KINDS, RUN_LIMIT_OPTIONS, formatInZone, scheduleFromDraft, timeZoneChoices } from "@/lib/routines";
import { cn } from "@/lib/utils";

// The Schedule section of the Automations editor (ADR-0110). Divider rows,
// one control per row, no cards. The next three dates come from the bridge
// (`preview`), never from the browser, so the editor and the scheduler agree.

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const MONTH_DAYS = Array.from({ length: 31 }, (_, index) => index + 1);

function Row({ label, hint, children, align = "center" }) {
  return (
    <div className={cn("grid gap-1 py-3 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-4", align === "start" ? "sm:items-start" : "sm:items-center")}>
      <div className="text-sm text-muted-foreground sm:pt-0.5">
        <div>{label}</div>
        {hint ? <div className="mt-0.5 text-xs text-muted-foreground/80">{hint}</div> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function TimeField({ value, onChange, label = "Time" }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Input type="time" value={value} onChange={(event) => onChange(event.target.value)} className="h-9 w-32 text-sm" />
    </label>
  );
}

export function RoutineSchedule({ value, onChange, preview, locale, copy = {}, className }) {
  const draft = value;
  const [next, setNext] = useState({ description: "", labels: [], problems: [], error: "", loading: false });
  const zones = useRef(null);
  if (!zones.current) zones.current = timeZoneChoices();
  const schedule = scheduleFromDraft(draft);
  const scheduleKey = JSON.stringify(schedule);

  useEffect(() => {
    if (!schedule || typeof preview !== "function") {
      setNext({ description: "", labels: [], problems: [], error: "", loading: false });
      return undefined;
    }
    let cancelled = false;
    setNext((current) => ({ ...current, loading: true, error: "" }));
    const timer = setTimeout(async () => {
      try {
        const result = await preview(schedule);
        if (cancelled) return;
        setNext({
          description: result?.description || "",
          labels: Array.isArray(result?.next) ? result.next.map((iso) => formatInZone(iso, result.timeZone || schedule.timeZone, locale, { year: true })) : [],
          problems: Array.isArray(result?.problems) ? result.problems : [],
          error: "",
          loading: false,
        });
      } catch (error) {
        if (!cancelled) setNext({ description: "", labels: [], problems: [], error: error?.message || "Could not compute the next dates.", loading: false });
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // The serialized schedule is the dependency: the object is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleKey, preview, locale]);

  function update(patch) {
    onChange({ ...draft, ...patch });
  }

  const problemWords = {
    time: "a time",
    date: "a date",
    days: "at least one day",
    everyMinutes: "an interval between 5 and 1440 minutes",
    startDate: "a start date",
    startTime: "a start time",
    day: "a valid day for that month",
    month: "a month",
    cron: "a valid five-field cron expression",
    timeZone: "a timezone",
  };

  return (
    <section className={cn("divide-y divide-border/60", className)} aria-label={copy.routineSchedule || "Schedule"}>
      <Row label={copy.routineRepeat || "Repeat"}>
        <Select value={draft.kind} onValueChange={(kind) => update({ kind })}>
          <SelectTrigger className="h-9 w-full text-sm sm:w-64" aria-label="Repeat">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Repeat</SelectLabel>
              {ROUTINE_KINDS.map((kind) => (
                <SelectItem key={kind.id} value={kind.id}>
                  {kind.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Row>

      {draft.kind === "once" ? (
        <Row label="When">
          <div className="flex flex-wrap items-center gap-3">
            <Input type="date" value={draft.date} onChange={(event) => update({ date: event.target.value })} className="h-9 w-44 text-sm" aria-label="Date" />
            <TimeField value={draft.time} onChange={(time) => update({ time })} />
          </div>
        </Row>
      ) : null}

      {draft.kind === "weekdays" ? (
        <Row label="Days" align="start">
          <div className="flex flex-wrap items-center gap-3">
            <ToggleGroup
              type="multiple"
              value={draft.days.map(String)}
              onValueChange={(values) => update({ days: values.map(Number).sort((a, b) => a - b) })}
              variant="outline"
              spacing={1}
              className="gap-1"
              aria-label="Days of the week"
            >
              {DAY_ORDER.map((day) => (
                <ToggleGroupItem key={day} value={String(day)} className="h-8 w-11 px-0 text-xs" aria-label={DAY_LABELS[day]}>
                  {DAY_LABELS[day]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <TimeField value={draft.time} onChange={(time) => update({ time })} />
          </div>
        </Row>
      ) : null}

      {draft.kind === "interval" ? (
        <>
          <Row label="Every" hint="5 to 1440 minutes">
            <label className="inline-flex items-center gap-2 text-sm">
              <Input
                type="number"
                min={5}
                max={1440}
                step={5}
                value={draft.everyMinutes}
                onChange={(event) => update({ everyMinutes: Number(event.target.value) || 0 })}
                className="h-9 w-24 text-sm"
                aria-label="Minutes"
              />
              <span className="text-muted-foreground">minutes</span>
            </label>
          </Row>
          <Row label="Starting" hint="Runs align to this moment">
            <div className="flex flex-wrap items-center gap-3">
              <Input type="date" value={draft.startDate} onChange={(event) => update({ startDate: event.target.value })} className="h-9 w-44 text-sm" aria-label="Start date" />
              <TimeField value={draft.startTime} onChange={(startTime) => update({ startTime })} label="at" />
            </div>
          </Row>
        </>
      ) : null}

      {draft.kind === "monthly" ? (
        <Row label="Day">
          <div className="flex flex-wrap items-center gap-3">
            <Select value={String(draft.day)} onValueChange={(day) => update({ day: day === "last" ? "last" : Number(day) })}>
              <SelectTrigger className="h-9 w-36 text-sm" aria-label="Day of month">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Day of month</SelectLabel>
                  {MONTH_DAYS.map((day) => (
                    <SelectItem key={day} value={String(day)}>
                      {day}
                    </SelectItem>
                  ))}
                  <SelectItem value="last">Last day</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <TimeField value={draft.time} onChange={(time) => update({ time })} />
          </div>
        </Row>
      ) : null}

      {draft.kind === "yearly" ? (
        <Row label="Date">
          <div className="flex flex-wrap items-center gap-3">
            <Select value={String(draft.month)} onValueChange={(month) => update({ month: Number(month) })}>
              <SelectTrigger className="h-9 w-40 text-sm" aria-label="Month">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Month</SelectLabel>
                  {MONTH_LABELS.map((label, index) => (
                    <SelectItem key={label} value={String(index + 1)}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select value={String(draft.day === "last" ? 1 : draft.day)} onValueChange={(day) => update({ day: Number(day) })}>
              <SelectTrigger className="h-9 w-24 text-sm" aria-label="Day">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Day</SelectLabel>
                  {MONTH_DAYS.map((day) => (
                    <SelectItem key={day} value={String(day)}>
                      {day}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <TimeField value={draft.time} onChange={(time) => update({ time })} />
          </div>
        </Row>
      ) : null}

      {draft.kind === "cron" ? (
        <Row label="Expression" hint="minute hour day-of-month month day-of-week">
          <Input
            value={draft.cron}
            onChange={(event) => update({ cron: event.target.value })}
            placeholder="0 9 1 * *"
            spellCheck={false}
            className="h-9 w-full font-mono text-sm sm:w-64"
            aria-label="Cron expression"
          />
        </Row>
      ) : null}

      {draft.kind !== "manual" ? (
        <>
          <Row label={copy.routineTimeZone || "Time zone"}>
            <Select value={draft.timeZone} onValueChange={(timeZone) => update({ timeZone })}>
              <SelectTrigger className="h-9 w-full text-sm sm:w-72" aria-label="Time zone">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Time zone</SelectLabel>
                  {zones.current.map((zone) => (
                    <SelectItem key={zone} value={zone}>
                      {zone}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Row>
          <Row label={copy.routineRunLimit || "Run limit"} hint="Stops a stuck run">
            <Select value={String(draft.maxRunMinutes || 0)} onValueChange={(minutes) => update({ maxRunMinutes: Number(minutes) || 0 })}>
              <SelectTrigger className="h-9 w-full text-sm sm:w-48" aria-label="Run limit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Run limit</SelectLabel>
                  {RUN_LIMIT_OPTIONS.map((option) => (
                    <SelectItem key={option.minutes} value={String(option.minutes)}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Row>
          <Row label={copy.routineNext || "Next"} align="start">
            <div className="text-sm" aria-live="polite" data-testid="routine-next">
              {next.error ? (
                <p className="text-destructive">{next.error}</p>
              ) : next.problems.length ? (
                <p className="text-muted-foreground">Needs {next.problems.map((problem) => problemWords[problem] || problem).join(", ")}.</p>
              ) : next.labels.length ? (
                <>
                  {next.description ? <p className="mb-1 text-foreground">{next.description}</p> : null}
                  <ol className="space-y-0.5 text-muted-foreground">
                    {next.labels.map((label) => (
                      <li key={label}>{label}</li>
                    ))}
                  </ol>
                </>
              ) : next.loading ? (
                <p className="text-muted-foreground">Computing…</p>
              ) : (
                <p className="text-muted-foreground">No upcoming run.</p>
              )}
            </div>
          </Row>
        </>
      ) : null}
    </section>
  );
}
