import { useState } from "react";

export function DeleteTaskAction({ onDelete, title, detail }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function remove() {
    setBusy(true);
    setError("");
    try { await onDelete(); }
    catch (failure) { setError(failure.message || "Could not delete this task."); setBusy(false); }
  }
  return <span className="inline-flex flex-wrap items-center gap-2 text-xs">
    <button type="button" disabled={busy} onBlur={() => setArmed(false)} onPointerLeave={() => setArmed(false)} onClick={() => armed ? void remove() : setArmed(true)} className={armed ? "text-destructive hover:underline disabled:opacity-50" : "text-muted-foreground hover:text-destructive hover:underline"}>{busy ? "Deleting…" : armed ? "Delete task" : "Delete"}</button>
    {armed ? <>
      <span className="text-muted-foreground">Delete task{title ? ` “${title}”` : ""}?</span>
      {detail ? <span className="text-muted-foreground">{detail}</span> : null}
    </> : null}
    {armed ? <button type="button" disabled={busy} onClick={() => setArmed(false)} className="text-muted-foreground hover:underline">Cancel</button> : null}
    {error ? <span role="alert" className="text-destructive">{error}</span> : null}
  </span>;
}
