import { useState } from "react";
import { Check, ChevronDown, FolderGit2, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command as CommandRoot, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function MemberWorkspacePicker({ name, workspace, choices, onChoose, onBrowse }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const folderName = workspace?.replace(/[/\\]+$/, "").split(/[/\\]/).pop();
  const search = query.trim().toLowerCase();
  const folders = choices.filter(item => `${item.label} ${item.path}`.toLowerCase().includes(search));
  const typedPath = /^(\/|[a-z]:[/\\])/i.test(query.trim()) ? query.trim() : "";

  async function choose(path) {
    setBusy(true);
    setError("");
    try {
      await onChoose(path);
      setOpen(false);
    } catch (failure) {
      setError(failure.message || "Could not change the working folder.");
    } finally { setBusy(false); }
  }

  async function browse() {
    setBusy(true);
    setError("");
    try {
      const path = await onBrowse();
      if (path) { await onChoose(path); setOpen(false); }
    } catch (failure) {
      if (!/cancelled/i.test(failure.message || "")) setError(failure.message || "Could not open the folder chooser.");
    } finally { setBusy(false); }
  }

  return (
    <Popover open={open} onOpenChange={next => { if (!busy) { setOpen(next); setQuery(""); setError(""); } }}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" className="h-9 min-w-0 max-w-72 gap-2 rounded-md px-2 text-muted-foreground" aria-label={`Workspace for ${name}: ${workspace || "Choose a folder"}`} title={workspace || "Choose a working folder"}>
          <FolderGit2 className="size-4 shrink-0" />
          <span className="truncate">{folderName || "Choose a folder"}</span>
          <ChevronDown className="size-3.5 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={8} className="w-[min(23rem,calc(100vw-2rem))] p-0" aria-label="Working folder">
        <div className="px-3 py-3">
          <p className="text-sm font-medium">{name}’s workspace</p>
          <p className="mt-1 break-all text-xs text-muted-foreground">{workspace || "Choose the folder where this member will work."}</p>
        </div>
        <CommandRoot shouldFilter={false} className="bg-transparent">
          <CommandInput value={query} onValueChange={setQuery} placeholder="Find a folder or paste a path…" aria-label="Find a working folder" disabled={busy} />
          <CommandList className="max-h-48 p-1">
            {folders.map(item => (
              <CommandItem key={item.path} value={item.path} disabled={busy} onSelect={() => void choose(item.path)} className="items-start gap-2 py-2">
                <FolderGit2 className="mt-0.5 size-4 shrink-0" />
                <span className="min-w-0 flex-1"><span className="block truncate">{item.label}</span><span className="block truncate text-xs text-muted-foreground" title={item.path}>{item.path}</span></span>
                {item.path === workspace ? <Check className="mt-0.5 size-4 shrink-0" /> : null}
              </CommandItem>
            ))}
            {typedPath && !choices.some(item => item.path === typedPath) ? (
              <CommandItem value={typedPath} disabled={busy} onSelect={() => void choose(typedPath)} className="gap-2 py-2">
                <FolderOpen className="size-4 shrink-0" /><span className="min-w-0 truncate">Use {typedPath}</span>
              </CommandItem>
            ) : null}
            {!folders.length && !typedPath ? <p className="px-2 py-3 text-xs text-muted-foreground">Choose another folder below, or paste its full path.</p> : null}
          </CommandList>
        </CommandRoot>
        <div className="border-t px-1 py-1">
          <Button type="button" variant="ghost" size="sm" className="w-full justify-start" disabled={busy} onClick={() => void browse()}><FolderOpen className="size-4" />Choose another folder…</Button>
        </div>
        {busy ? <p className="px-3 pb-2 text-xs text-muted-foreground" role="status">Choosing a working folder…</p> : null}
        {error ? <p className="px-3 pb-3 text-xs text-destructive" role="alert">{error}</p> : null}
      </PopoverContent>
    </Popover>
  );
}
