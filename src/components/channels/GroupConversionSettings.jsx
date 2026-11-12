import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function GroupConversionSettings({ group, onConvert }) {
  const [nameDraft, setNameDraft] = useState(null);
  const name = nameDraft ?? group.name;
  const [visibility, setVisibility] = useState("private");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef(null);
  const submitting = useRef(false);
  async function convert(event) {
    event.preventDefault();
    if (submitting.current || !name.trim()) return;
    submitting.current = true; setPending(true); setError("");
    const input = { name: name.trim(), visibility };
    const signature = JSON.stringify(input);
    if (attempt.current?.signature !== signature) attempt.current = { signature, requestId: crypto.randomUUID() };
    try { await onConvert(group.id, { ...input, requestId: attempt.current.requestId }); }
    catch (failure) { setError(failure.message || "Could not convert this group. Try again."); }
    finally { submitting.current = false; setPending(false); }
  }
  return <form onSubmit={convert} className="flex flex-col gap-2 border-t border-border/60 pt-4" data-testid="group-conversion">
    <h2 className="text-sm font-medium">Convert to a channel</h2>
    <p className="text-xs text-muted-foreground">Keep this conversation, its messages and its members. The channel appears under Channels.</p>
    <Label htmlFor="group-channel-name">Channel name</Label><Input id="group-channel-name" maxLength={80} value={name} disabled={pending} onChange={event => setNameDraft(event.target.value)} />
    <Label htmlFor="group-channel-visibility">Channel visibility</Label>
    <Select value={visibility} disabled={pending} onValueChange={setVisibility}><SelectTrigger id="group-channel-visibility"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="private">Private</SelectItem><SelectItem value="public">Public</SelectItem></SelectContent></Select>
    <p className="text-xs text-muted-foreground">{visibility === "public" ? "Everyone in this Squad can read the channel, including its existing messages." : "Only assigned members can access this private channel."}</p>
    {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    <Button type="submit" variant="outline" size="sm" disabled={pending || !name.trim()}>{pending ? "Converting…" : `Convert to ${visibility} channel`}</Button>
  </form>;
}
