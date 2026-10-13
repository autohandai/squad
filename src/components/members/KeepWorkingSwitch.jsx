import { useEffect, useState } from "react";

import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

const CAP_CHOICES = [2, 4, 6, 10, 24];

/**
 * "Keep working between messages" (ADR-0125): one switch row in the
 * member's engine settings. Off by default; the setting lives on the bridge
 * (`PUT /api/agenda/:memberId`) so it holds with the app closed.
 */
export function KeepWorkingSwitch({ api, memberId, memberName = "This member", copy = {}, className = "" }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setState(null);
    setError("");
    api(`/api/agenda/${encodeURIComponent(memberId)}`).then((data) => { if (!cancelled) setState(data); }).catch((reason) => { if (!cancelled) setError(reason?.message || "Could not read the setting."); });
    return () => { cancelled = true; };
  }, [api, memberId]);

  async function save(patch) {
    setBusy(true);
    setError("");
    try {
      setState(await api(`/api/agenda/${encodeURIComponent(memberId)}`, { method: "PUT", body: JSON.stringify(patch) }));
    } catch (reason) {
      setError(reason?.message || "Could not save the setting.");
    } finally {
      setBusy(false);
    }
  }

  const enabled = Boolean(state?.enabled);
  const cap = state?.dailyCap || 6;
  const id = `keep-working-${memberId}`;
  return (
    <div className={className} data-testid="keep-working">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <label htmlFor={id} className="text-sm font-medium">{copy.keepWorkingLabel || "Keep working between messages"}</label>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            {(copy.keepWorkingHint || "When {name} is idle, it starts the next open task on its plan, or a goal a restart cut short, one at a time. Your next message stops it.").replace("{name}", memberName)}
          </p>
        </div>
        <Switch id={id} checked={enabled} disabled={busy || !state} onCheckedChange={(checked) => save({ enabled: checked })} aria-label={copy.keepWorkingLabel || "Keep working between messages"} />
      </div>
      {enabled ? (
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <span>{copy.keepWorkingCap || "Up to"}</span>
          <Select value={String(cap)} onValueChange={(value) => save({ dailyCap: Number(value) })} disabled={busy}>
            <SelectTrigger size="sm" className="h-7 w-16 text-xs" aria-label={copy.keepWorkingCapLabel || "Items a day"}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {CAP_CHOICES.map((value) => <SelectItem key={value} value={String(value)}>{value}</SelectItem>)}
              </SelectGroup>
            </SelectContent>
          </Select>
          <span>{(copy.keepWorkingToday || "a day · {count} today").replace("{count}", String(state?.today?.count || 0))}</span>
        </div>
      ) : null}
      {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
