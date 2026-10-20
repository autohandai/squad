import { useCallback, useEffect, useState } from "react";
import { Pencil, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Team memory (ADR-0134): what members saved for the whole team, and what
// this member saved for itself, through the squad_remember tool. It is
// shared by every member whichever engine it runs on, so it lives on the
// bridge, not in this browser. Saved immediately; the person removes what is
// wrong. Divider rows, like "What … knows" above it.

const REFRESH_MS = 8000;

export function TeamMemorySection({ agent, request, formatTime = () => "" }) {
  const [memory, setMemory] = useState(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [scope, setScope] = useState("team");
  const [editing, setEditing] = useState(null);
  const projectPaths = [...new Set([agent.workspace, ...(agent.projects || []).map(project => project.path)].filter(Boolean))];
  const workspace = projectPaths[0] || "";

  const load = useCallback(async () => {
    try {
      const data = await request("/api/team");
      setMemory(Array.isArray(data?.memory) ? data.memory : []);
    } catch (failure) {
      setMemory((current) => current || []);
      setError(failure?.message || "Team memory could not be loaded.");
    }
  }, [request]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  async function add(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setBusy("add");
    setError("");
    try {
      await request("/api/team/memory", { method: "POST", body: JSON.stringify({ text, scope, ...(scope === "member" ? { memberId: agent.id } : {}), ...(scope === "project" ? { workspace } : {}) }) });
      setDraft("");
      await load();
    } catch (failure) {
      setError(failure?.message || "That could not be saved.");
    } finally {
      setBusy("");
    }
  }

  async function update(event) {
    event.preventDefault();
    if (busy || !editing?.text.trim()) return;
    setBusy(editing.id); setError("");
    try {
      await request(`/api/team/memory/${encodeURIComponent(editing.id)}`, { method: "PATCH", body: JSON.stringify({ text: editing.text.trim() }) });
      setEditing(null);
      await load();
    } catch (failure) { setError(failure?.message || "That could not be updated."); }
    finally { setBusy(""); }
  }

  async function remove(id) {
    if (busy) return;
    setBusy(id);
    setError("");
    try {
      await request(`/api/team/memory/${encodeURIComponent(id)}`, { method: "DELETE" });
      await load();
    } catch (failure) {
      setError(failure?.message || "That could not be removed.");
    } finally {
      setBusy("");
    }
  }

  const team = (memory || []).filter((entry) => entry.scope === "team");
  const own = (memory || []).filter((entry) => entry.scope === "member" && entry.memberId === agent.id);
  const project = (memory || []).filter(entry => entry.scope === "project" && projectPaths.includes(entry.workspace));

  const rows = (entries) => (
    <div className="divide-y divide-border/70 border-y border-border/70">
      {entries.map((entry) => (
        <div key={entry.id} className="group py-2.5 text-sm">
          {editing?.id === entry.id ? (
            <form onSubmit={update} className="flex flex-col gap-2">
              <Textarea aria-label="Edit saved memory" value={editing.text} maxLength={500} disabled={Boolean(busy)} onChange={event => setEditing(current => ({ ...current, text: event.target.value }))} />
              <div className="flex gap-2"><Button size="sm" variant="outline" disabled={Boolean(busy) || !editing.text.trim()}>Save memory</Button><Button type="button" size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => setEditing(null)}>Cancel</Button></div>
            </form>
          ) : (
            <div className="flex items-baseline gap-3">
              <span className="min-w-0 flex-1">{entry.text}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{[entry.authorName, entry.updatedAt || entry.createdAt ? formatTime(entry.updatedAt || entry.createdAt) : ""].filter(Boolean).join(" · ")}</span>
              <Button type="button" variant="ghost" size="icon" className="size-6 shrink-0 self-center" aria-label={`Edit memory: ${entry.text}`} title="Edit memory" disabled={Boolean(busy)} onClick={() => { setError(""); setEditing({ id: entry.id, text: entry.text }); }}><Pencil /></Button>
              <Button type="button" variant="ghost" size="icon" className="size-6 shrink-0 self-center" aria-label={`Forget: ${entry.text}`} title="Forget" disabled={Boolean(busy)} onClick={() => remove(entry.id)}><X /></Button>
            </div>
          )}
          {entry.workspace ? <p className="mt-1 truncate text-xs text-muted-foreground" title={entry.workspace}>{entry.workspace}</p> : null}
        </div>
      ))}
    </div>
  );

  return (
    <section className="grid gap-2" aria-labelledby="memory-team" data-testid="team-memory">
      <h3 id="memory-team" className="text-sm font-semibold">
        Shared with the team{team.length ? <span className="ml-2 font-normal text-muted-foreground">{team.length}</span> : null}
      </h3>
      <p className="text-sm text-muted-foreground">
        {`Every member reads this on every engine. ${agent.name} adds to it when you say “remember” or “keep in mind”, and a rename lands here so the others learn it.`}
      </p>
      {memory === null ? null : team.length ? rows(team) : <p className="text-sm text-muted-foreground">Nothing shared yet.</p>}
      {own.length ? (
        <>
          <h4 className="pt-2 text-sm font-medium">{`Only ${agent.name}`}</h4>
          {rows(own)}
        </>
      ) : null}
      {project.length ? <><h4 className="pt-2 text-sm font-medium">Project memory</h4>{rows(project)}</> : null}
      <form className="flex flex-wrap gap-2 pt-2" onSubmit={add}>
        <Select value={scope} disabled={Boolean(busy)} onValueChange={setScope}>
          <SelectTrigger aria-label="Memory visibility" className="w-auto"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup><SelectItem value="team">Whole team</SelectItem><SelectItem value="member">{`Only ${agent.name}`}</SelectItem>{workspace ? <SelectItem value="project">Current project</SelectItem> : null}</SelectGroup></SelectContent>
        </Select>
        <Input value={draft} disabled={Boolean(busy)} onChange={(event) => setDraft(event.target.value)} placeholder="Add something to remember" aria-label="Add team memory" className="min-w-40 flex-1" maxLength={500} />
        <Button type="submit" size="sm" variant="outline" disabled={!draft.trim() || Boolean(busy)}>Add</Button>
      </form>
      {scope === "project" ? <p className="text-xs text-muted-foreground">{`Shared with members working in ${workspace}.`}</p> : null}
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
    </section>
  );
}
