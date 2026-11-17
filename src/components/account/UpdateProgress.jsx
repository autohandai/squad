import { Progress } from "@/components/ui/progress";
import { updateBytes, updatePercent } from "@/lib/update-status";
// `bar={false}` when a perch above already draws the measure (Settings ›
// Updates, ADR-0245); the words stay either way.
export function UpdateProgress({ operation, compact = false, bar = true }) {
  if (operation?.phase !== "downloading") return null;
  const percent = updatePercent(operation);
  const label =
    percent === null
      ? `${updateBytes(operation.bytes)} downloaded`
      : `${updateBytes(operation.bytes)} of ${updateBytes(operation.totalBytes)} · ${percent}%`;
  return (
    <div className="flex flex-col gap-2" data-testid="update-progress">
      {bar && percent !== null ? (
        <Progress
          value={percent}
          aria-label="Update download"
          aria-valuetext={label}
        />
      ) : null}
      <p
        className={
          compact
            ? "text-xs text-muted-foreground tabular-nums"
            : "text-sm text-muted-foreground tabular-nums"
        }
      >
        {label}
      </p>
    </div>
  );
}
