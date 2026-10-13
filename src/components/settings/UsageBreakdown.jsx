import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  formatUsageCount,
  formatUsageDay,
  formatUsageDuration,
  formatUsageSteps,
  usageLedgerEmpty,
  usageTables,
} from "@/lib/system-settings";

/**
 * Usage ledger (ADR-0105): three plain tables, By member, By model, By day,
 * from the `usage` block of GET /api/analytics (`byMember`, `byModel`,
 * `byDay`). Divider-separated, no cards. The integrator renders it inside
 * AnalyticsPanel and passes the snapshot's `usage`.
 */
export function UsageBreakdown({ usage = {}, locale = "en", copy = {}, className }) {
  const tables = usageTables(usage, copy);
  const days = Number(usage?.ledgerWindowDays) || 30;
  const title = copy.usageLedger || "Usage";
  const description = (copy.usageLedgerDescription || "Tokens, steps and time per member, model and day over the last {days} days.").replace("{days}", String(days));

  return (
    <section aria-label={title} className={cn("min-w-0", className)}>
      <div className="mb-4">
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      {usageLedgerEmpty(usage) ? (
        <p className="text-sm text-muted-foreground" data-testid="usage-ledger-empty">
          {copy.usageLedgerEmpty || "No member has used a model in this window yet."}
        </p>
      ) : (
        <div className="divide-y divide-border/65">
          {tables.map((table) => (
            <UsageTable key={table.id} table={table} locale={locale} copy={copy} />
          ))}
        </div>
      )}
    </section>
  );
}

function UsageTable({ table, locale, copy }) {
  const numeric = "text-right tabular-nums";
  return (
    <div className="py-5 first:pt-0 last:pb-0" data-testid={`usage-table-${table.id}`}>
      <h4 className="mb-2 text-sm font-medium">{table.title}</h4>
      {table.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{copy.usageTableEmpty || "Nothing recorded."}</p>
      ) : (
        <Table className="text-sm">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="px-0">{table.labelHeading}</TableHead>
              <TableHead className={numeric}>{copy.usageRuns || "Runs"}</TableHead>
              <TableHead className={numeric}>{copy.usageInput || "Input"}</TableHead>
              <TableHead className={numeric}>{copy.usageOutput || "Output"}</TableHead>
              <TableHead className={numeric}>{copy.usageTotal || "Total"}</TableHead>
              <TableHead className={numeric}>{copy.usageSteps || "Steps"}</TableHead>
              <TableHead className={cn(numeric, "pr-0")}>{copy.usageDuration || "Time"}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.rows.map((row) => (
              <TableRow key={row.key || row.label} className="hover:bg-transparent">
                <TableCell className="max-w-[18rem] truncate px-0 font-medium" title={row.label}>
                  {table.id === "byDay" ? formatUsageDay(row.label, locale) : row.label}
                </TableCell>
                <TableCell className={numeric}>{formatUsageCount(row.runs, locale)}</TableCell>
                <TableCell className={numeric}>{formatUsageCount(row.inputTokens, locale)}</TableCell>
                <TableCell className={numeric}>{formatUsageCount(row.outputTokens, locale)}</TableCell>
                <TableCell className={numeric}>{formatUsageCount(row.totalTokens, locale)}</TableCell>
                <TableCell className={numeric}>{formatUsageSteps(row.steps, locale)}</TableCell>
                <TableCell className={cn(numeric, "pr-0 text-muted-foreground")}>{formatUsageDuration(row.durationMs)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
