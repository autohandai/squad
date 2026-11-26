import { useContext, useState } from "react";
import { Button } from "@/components/ui/button";
import { SquadOwnershipContext } from "@/components/account/SquadOwnerSwitcher";

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

// ADR-0283: the squad from before account ownership. After it was brought back
// automatically this says so and offers Undo; when it wasn't (another account,
// a Squad already set up, or the copy failed) it offers to bring it back. One
// quiet line under the window's top, like the update notice; it shows during
// setup too, because that is where an updated Mac lands without it.
export function LegacyImportNotice({ api, onOpenBackups }) {
  const context = useContext(SquadOwnershipContext);
  const legacy = context?.legacy;
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [confirmUndo, setConfirmUndo] = useState(false), [details, setDetails] = useState(false), [hidden, setHidden] = useState(false);
  if (!legacy || hidden) return null;
  async function post(path, body = {}) {
    setBusy(true); setError("");
    try { await api(path, { method: "POST", body: JSON.stringify(body) }); return true; }
    catch (failure) { setError(failure.message || "That didn't work. Your earlier files are untouched."); return false; }
    finally { setBusy(false); }
  }
  const dismiss = async () => { if (await post("/api/ownership/legacy/dismiss")) setHidden(true); };
  if (legacy.status === "imported") {
    return <div data-testid="legacy-import-notice" role="status" className="space-y-2 border-b border-border/65 px-6 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <p className="min-w-0 flex-1">Brought back your squad from before the update: {plural(legacy.memberCount, "member")}{legacy.chatCount ? `, ${plural(legacy.chatCount, "chat")}` : ""}. <span className="text-muted-foreground">Your earlier files are untouched. Members start paused until you look them over.</span></p>
        {legacy.omissions?.length ? <Button size="sm" variant="ghost" onClick={() => setDetails(value => !value)}>{details ? "Hide what was left out" : "What was left out"}</Button> : null}
        {confirmUndo
          ? <><span className="text-muted-foreground">Go back to the empty Squad?</span>
            <Button size="sm" variant="outline" disabled={busy} onClick={async () => { if (await post("/api/ownership/legacy/undo", { confirm: "undo-automatic-import" })) window.location.replace("/squad"); }}>{busy ? "Undoing…" : "Undo"}</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmUndo(false)}>Keep it</Button></>
          : <><Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmUndo(true)}>Undo</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void dismiss()}>Done</Button></>}
      </div>
      {details ? <ul data-testid="legacy-import-omissions" className="space-y-1 text-xs text-muted-foreground">
        {legacy.omissions.map((item, index) => <li key={index}>{item.path ? <span className="font-mono">{item.path}</span> : null}{item.path ? " · " : ""}{item.reason}</li>)}
        <li><button type="button" className="underline underline-offset-2" onClick={onOpenBackups}>Settings › Backups</button> can recover more from your earlier files.</li>
      </ul> : null}
      {error ? <p role="alert" className="text-destructive">{error}</p> : null}
    </div>;
  }
  const names = legacy.names?.length ? ` (${legacy.names.join(", ")}${legacy.memberCount > legacy.names.length ? ", …" : ""})` : "";
  return <div data-testid="legacy-import-offer" role="status" className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/65 px-6 py-2 text-sm">
    <p className="min-w-0 flex-1">
      {legacy.status === "failed" ? "Squad couldn't bring back your squad from before the update on its own." : "Your squad from before the update is still on this computer:"}{" "}
      <span className="text-muted-foreground">{plural(legacy.memberCount, "member")}{names}. {legacy.status === "failed" && legacy.error ? `${legacy.error} ` : ""}Your earlier files are untouched.</span>
    </p>
    <Button size="sm" variant="outline" disabled={busy} onClick={onOpenBackups}>Bring back your earlier squad</Button>
    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void dismiss()}>Not now</Button>
    {error ? <p role="alert" className="w-full text-destructive">{error}</p> : null}
  </div>;
}
