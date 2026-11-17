import { useEffect, useState } from "react";
import { Lock, LockOpen, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const SECRET_NAME = /(token|secret|key|password|passwd|auth|bearer|credential|cookie|session)/i;

function rowsFrom(pairs = [], field) {
  return pairs.map((pair) => ({ key: pair[field] ?? pair.key ?? pair.name, value: pair.secret ? "" : pair.value || "", secret: pair.secret === true, stored: pair.secret && pair.configured ? pair.hint || "stored" : "" }));
}

/**
 * Name/value rows. The lock marks a value as secret: sealed on this
 * computer, shown only as its last four characters, kept when left blank.
 * A name that looks like a key turns the lock on by itself.
 */
function PairRows({ rows, onChange, nameLabel, valuePlaceholder, idPrefix }) {
  const update = (index, patch) => onChange(rows.map((row, current) => (current === index ? { ...row, ...patch } : row)));
  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <Input aria-label={`${nameLabel} ${index + 1} name`} id={`${idPrefix}-name-${index}`} value={row.key} spellCheck={false} autoComplete="off" placeholder={nameLabel === "Header" ? "Authorization" : "API_KEY"} className="w-[38%] font-mono text-xs"
            onChange={(event) => { const key = event.target.value; update(index, { key, secret: row.touchedSecret ? row.secret : SECRET_NAME.test(key) || row.secret }); }} />
          <Input aria-label={`${nameLabel} ${index + 1} value`} value={row.value} type={row.secret ? "password" : "text"} spellCheck={false} autoComplete="off" placeholder={row.stored ? `Stored (${row.stored}), leave blank to keep` : valuePlaceholder} className="min-w-0 flex-1 font-mono text-xs"
            onChange={(event) => update(index, { value: event.target.value, secret: row.touchedSecret ? row.secret : row.secret || /^bearer\s/i.test(event.target.value) })} />
          <Button type="button" size="icon-sm" variant="ghost" aria-pressed={row.secret} aria-label={row.secret ? "Secret: sealed on this computer" : "Not secret"} title={row.secret ? "Secret: sealed on this computer" : "Not secret"} onClick={() => update(index, { secret: !row.secret, touchedSecret: true })}>
            {row.secret ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5 text-muted-foreground" />}
          </Button>
          <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove ${nameLabel.toLowerCase()} ${index + 1}`} onClick={() => onChange(rows.filter((_, current) => current !== index))}><X className="size-3.5" /></Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="ghost" className="-ml-2" onClick={() => onChange([...rows, { key: "", value: "", secret: false }])}><Plus className="size-3.5" aria-hidden="true" />Add {nameLabel === "Header" ? "header" : "variable"}</Button>
    </div>
  );
}

function checkSentence(check) {
  if (!check) return null;
  if (check.needsSignIn) return { tone: "ok", text: "This server asks you to sign in. Squad opens its sign-in page after you add it." };
  if (check.ok) return { tone: "ok", text: `Works · ${check.transport === "sse" ? "SSE" : check.transport === "http" ? "Streamable HTTP" : check.framing ? "stdio" : "MCP"} · ${check.tools.length} ${check.tools.length === 1 ? "tool" : "tools"}${check.tools.length ? ` (${check.tools.slice(0, 4).map((tool) => tool.name || tool).join(", ")}${check.tools.length > 4 ? ", …" : ""})` : ""}` };
  return { tone: "error", text: check.error || "The check failed." };
}

/**
 * Any MCP server by hand: an address (transport detected), a command, or a
 * pasted "mcpServers" config from a README. `connector` edits an existing one.
 */
export function CustomConnectorDialog({ api, open, onOpenChange, connector = null, onSaved, onNeedsSignIn }) {
  const editing = Boolean(connector);
  const [tab, setTab] = useState("url");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [transport, setTransport] = useState("http");
  const [headers, setHeaders] = useState([]);
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [env, setEnv] = useState([]);
  const [config, setConfig] = useState("");
  const [check, setCheck] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setTab(connector?.kind === "stdio" ? "stdio" : "url");
    setName(connector?.name || "");
    setUrl(connector?.url || ""); setTransport(connector?.transport || "http"); setHeaders(rowsFrom(connector?.headers, "name"));
    setCommand(connector?.command || ""); setArgs((connector?.args || []).join("\n")); setEnv(rowsFrom(connector?.env, "key"));
    setConfig(""); setCheck(null); setBusy(""); setError("");
  }, [open, connector]);

  const definition = () => (tab === "stdio"
    ? { name: name.trim(), kind: "stdio", command: command.trim(), args: args.split("\n").map((line) => line.trim()).filter(Boolean), env: env.filter((row) => row.key.trim()).map(({ key, value, secret }) => ({ key: key.trim(), value, secret })) }
    : { name: name.trim(), kind: "url", url: url.trim(), transport, headers: headers.filter((row) => row.key.trim()).map(({ key, value, secret }) => ({ key: key.trim(), value, secret })) });

  async function runCheck() {
    setBusy("check"); setError(""); setCheck(null);
    try {
      const result = await api("/api/connectors/check", { method: "POST", body: JSON.stringify(definition()) });
      setCheck(result);
      if (result.ok && result.transport && tab === "url") setTransport(result.transport);
    } catch (failure) { setError(failure?.message || String(failure)); }
    finally { setBusy(""); }
  }

  async function save(event) {
    event?.preventDefault();
    setBusy("save"); setError("");
    try {
      if (tab === "paste") {
        const added = await api("/api/connectors/import", { method: "POST", body: JSON.stringify({ config }) });
        onSaved?.(added.connectors);
        onOpenChange(false);
        return;
      }
      if (editing) {
        const saved = await api(`/api/connectors/${encodeURIComponent(connector.id)}`, { method: "PUT", body: JSON.stringify(definition()) });
        const tested = await api(`/api/connectors/${encodeURIComponent(connector.id)}/test`, { method: "POST" }).catch(() => null);
        // A connector that was off because it didn't work goes on once the fix works;
        // one the person switched off while it worked stays off.
        const wasBroken = ["failing", "needs-sign-in", "untested", "unstable"].includes(connector.health?.state);
        const enabled = tested?.ok && !connector.enabled && wasBroken ? await api(`/api/connectors/${encodeURIComponent(connector.id)}/enable`, { method: "POST" }).catch(() => null) : null;
        onSaved?.([enabled || tested?.connector || saved]);
        if (tested?.needsSignIn) onNeedsSignIn?.(saved);
        onOpenChange(false);
        return;
      }
      const created = await api("/api/connectors", { method: "POST", body: JSON.stringify({ ...definition(), verify: true }) });
      onSaved?.([created.connector]);
      if (created.test?.needsSignIn) onNeedsSignIn?.(created.connector);
      onOpenChange(false);
    } catch (failure) { setError(failure?.message || String(failure)); }
    finally { setBusy(""); }
  }

  const sentence = checkSentence(check);
  const ready = tab === "paste" ? config.trim().length > 2 : name.trim() && (tab === "stdio" ? command.trim() : url.trim());

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl" data-testid="custom-connector-dialog">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${connector.name}` : "Custom connector"}</DialogTitle>
          <DialogDescription className="text-left">{editing ? "Changes are checked before members use them. A new address signs this connector out." : "Any MCP server: its address, a command that starts it, or the config from its instructions."}</DialogDescription>
        </DialogHeader>
        {!editing ? (
          <Tabs value={tab} onValueChange={(next) => { setTab(next); setCheck(null); setError(""); }}>
            <TabsList variant="line" className="w-full justify-start">
              <TabsTrigger value="url">Address</TabsTrigger>
              <TabsTrigger value="stdio">Command</TabsTrigger>
              <TabsTrigger value="paste">Paste config</TabsTrigger>
            </TabsList>
          </Tabs>
        ) : null}
        <form id="custom-connector-form" onSubmit={save} className="space-y-4">
          {tab !== "paste" ? (
            <label className="block space-y-1.5" htmlFor="custom-connector-name"><span className="text-sm font-medium">Name</span>
              <Input id="custom-connector-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Internal docs" autoComplete="off" />
            </label>
          ) : null}
          {tab === "url" ? (
            <>
              <label className="block space-y-1.5" htmlFor="custom-connector-url"><span className="text-sm font-medium">Address</span>
                <Input id="custom-connector-url" value={url} onChange={(event) => { setUrl(event.target.value); setCheck(null); }} onBlur={() => { if (url.trim() && name.trim() && !check) void runCheck(); }} placeholder="https://mcp.example.com/mcp" autoComplete="off" spellCheck={false} />
                <span className="block text-xs leading-5 text-muted-foreground">Squad finds out whether it speaks Streamable HTTP or the older SSE, and whether it needs a sign-in. Tokens go in a header, never in the address.</span>
              </label>
              <div className="space-y-1.5">
                <p className="text-sm font-medium">Headers <span className="font-normal text-muted-foreground">· optional</span></p>
                <PairRows rows={headers} onChange={(next) => { setHeaders(next); setCheck(null); }} nameLabel="Header" valuePlaceholder="Bearer …" idPrefix="custom-header" />
              </div>
            </>
          ) : null}
          {tab === "stdio" ? (
            <>
              <label className="block space-y-1.5" htmlFor="custom-connector-command"><span className="text-sm font-medium">Command</span>
                <Input id="custom-connector-command" value={command} onChange={(event) => { setCommand(event.target.value); setCheck(null); }} placeholder="npx" autoComplete="off" spellCheck={false} className="font-mono text-xs" />
              </label>
              <label className="block space-y-1.5" htmlFor="custom-connector-args"><span className="text-sm font-medium">Arguments <span className="font-normal text-muted-foreground">· one per line</span></span>
                <Textarea id="custom-connector-args" value={args} onChange={(event) => { setArgs(event.target.value); setCheck(null); }} rows={3} spellCheck={false} className="font-mono text-xs" placeholder={"-y\n@scope/server@1.2.3"} />
              </label>
              <div className="space-y-1.5">
                <p className="text-sm font-medium">Environment <span className="font-normal text-muted-foreground">· optional</span></p>
                <PairRows rows={env} onChange={(next) => { setEnv(next); setCheck(null); }} nameLabel="Variable" valuePlaceholder="value" idPrefix="custom-env" />
              </div>
            </>
          ) : null}
          {tab === "paste" ? (
            <label className="block space-y-1.5" htmlFor="custom-connector-config"><span className="text-sm font-medium">Config</span>
              <Textarea id="custom-connector-config" value={config} onChange={(event) => setConfig(event.target.value)} rows={9} spellCheck={false} className="font-mono text-xs" placeholder={'{\n  "mcpServers": {\n    "docs": { "url": "https://mcp.example.com/mcp" }\n  }\n}'} />
              <span className="block text-xs leading-5 text-muted-foreground">The "mcpServers" block most servers show for Claude, Cursor or VS Code. Values whose names look like keys are sealed on this computer. Each server is checked and turned on if it works.</span>
            </label>
          ) : null}
          {sentence ? <p className={cn("text-sm leading-6", sentence.tone === "error" ? "text-destructive" : "text-muted-foreground")} role="status" data-testid="custom-connector-check">{sentence.text}</p> : null}
          {error ? <p className="text-sm leading-6 text-destructive" role="alert">{error}</p> : null}
        </form>
        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" disabled={Boolean(busy)} onClick={() => onOpenChange(false)}>Cancel</Button>
          {tab !== "paste" ? <Button type="button" variant="outline" disabled={!ready || Boolean(busy)} onClick={runCheck}>{busy === "check" ? <><Spinner className="size-3.5" />Checking…</> : "Check"}</Button> : null}
          <Button type="submit" form="custom-connector-form" disabled={!ready || Boolean(busy)}>{busy === "save" ? <><Spinner className="size-3.5" />{editing ? "Saving…" : "Adding…"}</> : editing ? "Save" : "Add"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
