import { useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  HARNESS_OPTIONS,
  harnessOption,
  normalizeHarnessAssignment,
  readinessFor,
  readinessLabel,
  readinessTone,
} from "@/lib/harness";
import { cn } from "@/lib/utils";

/**
 * "Runs with" control. One restrained select plus a single readiness line.
 * Advanced fields (executable path, harness-native model) sit behind a
 * disclosure so the default member flow stays short.
 */
export function HarnessSelect({
  value,
  onChange,
  harnesses = [],
  loading = false,
  onRefresh,
  onTest,
  testing = false,
  testResult = null,
  id = "member-harness",
  label = "Runs with",
  description = "The engine that executes this member. Personality, model, and permissions stay the same when you change it.",
  showAdvanced = true,
}) {
  const assignment = normalizeHarnessAssignment(value);
  const [advancedOpen, setAdvancedOpen] = useState(Boolean(assignment.executablePath || assignment.model));
  const readiness = testResult?.id === assignment.id ? testResult : readinessFor(harnesses, assignment.id);
  const option = harnessOption(assignment.id);

  function update(patch) {
    onChange?.(normalizeHarnessAssignment({ ...assignment, ...patch }));
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        {onRefresh ? (
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} data-icon="inline-start" />
            Re-check
          </Button>
        ) : null}
      </div>
      <Select value={assignment.id} onValueChange={(next) => update({ id: next })}>
        <SelectTrigger id={id} className="w-full bg-card sm:max-w-sm">
          <SelectValue placeholder="Choose an engine" />
        </SelectTrigger>
        <SelectContent>
          {HARNESS_OPTIONS.map((item) => {
            const itemReadiness = readinessFor(harnesses, item.id);
            return (
              <SelectItem key={item.id} value={item.id}>
                <span className="flex items-center gap-2">
                  <span>{item.label}</span>
                  {item.isDefault ? <span className="text-xs text-muted-foreground">Default</span> : null}
                  {itemReadiness ? (
                    <span className={cn("text-xs", readinessTone(itemReadiness.status))}>{readinessLabel(itemReadiness.status)}</span>
                  ) : null}
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      <p className="text-sm text-muted-foreground">
        <span className={cn("font-medium", readinessTone(loading && !readiness ? "checking" : readiness?.status))}>
          {loading && !readiness ? readinessLabel("checking") : readinessLabel(readiness?.status)}
        </span>
        {readiness?.version ? <span> · {option.short} {readiness.version}</span> : null}
        {readiness?.detail ? <span> · {readiness.detail}</span> : null}
        {readiness?.setup ? (
          <span>
            {" "}
            · <code className="rounded bg-muted px-1 py-0.5 text-xs">{readiness.setup}</code>
          </span>
        ) : null}
      </p>
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}

      {showAdvanced ? (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((open) => !open)}
          >
            {advancedOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            Advanced
          </button>
          {advancedOpen ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-model`} className="text-xs">
                  {option.short} model override
                </Label>
                <Input
                  id={`${id}-model`}
                  value={assignment.model}
                  placeholder={assignment.id === "claude" ? "e.g. sonnet" : assignment.id === "codex" ? "e.g. gpt-5-codex" : "Use the workspace model"}
                  className="h-9 bg-card"
                  onChange={(event) => update({ model: event.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-path`} className="text-xs">
                  Executable path
                </Label>
                <Input
                  id={`${id}-path`}
                  value={assignment.executablePath}
                  placeholder="Leave empty to auto-detect"
                  className="h-9 bg-card font-mono text-xs"
                  onChange={(event) => update({ executablePath: event.target.value })}
                />
              </div>
              {onTest ? (
                <div className="sm:col-span-2">
                  <Button type="button" variant="outline" size="sm" disabled={testing} onClick={() => onTest(assignment)}>
                    {testing ? "Testing…" : "Test harness"}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
