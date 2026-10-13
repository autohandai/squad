import { useEffect, useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

function Row({ title, description, status, children, htmlFor }) {
  return (
    <Field orientation="horizontal" className="items-start justify-between gap-6 py-4">
      <FieldContent className="w-[220px] shrink-0 gap-1">
        <FieldTitle>{htmlFor ? <label htmlFor={htmlFor}>{title}</label> : title}</FieldTitle>
        {description ? <FieldDescription className="break-words">{description}</FieldDescription> : null}
        {status ? <p className={cn("text-xs leading-5", status.tone === "error" ? "text-destructive" : "text-muted-foreground")}>{status.text}</p> : null}
      </FieldContent>
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">{children}</div>
    </Field>
  );
}

function kindSummary(connector) {
  if (connector.builtin) return "Built in · web_search and web_fetch";
  if (connector.kind === "stdio") return `Command · ${[connector.command, ...(connector.args || [])].join(" ")}`;
  return `${connector.transport === "sse" ? "SSE" : "HTTP"} · ${connector.url}`;
}

function testSentence(connector, copy) {
  const test = connector.lastTest;
  if (!test) return { text: copy.connectorNotTested || "Not tested yet.", tone: "muted" };
  if (!test.ok) return { text: `${copy.connectorTestFailed || "Test failed"}: ${test.error}`, tone: "error" };
  const tools = test.tools || [];
  const shown = tools.slice(0, 4).join(", ") + (tools.length > 4 ? `, +${tools.length - 4}` : "");
  const base = `${tools.length} ${tools.length === 1 ? "tool" : "tools"}${shown ? ` (${shown})` : ""}`;
  if (connector.builtin) {
    if (!test.keyChecked) return { text: `${base}. ${copy.connectorKeyMissing || "Add a Firecrawl key to search."}`, tone: "muted" };
    const credits = typeof test.credits === "number" ? `, ${test.credits.toLocaleString()} credits left` : "";
    return { text: `${base}. ${copy.connectorKeyChecked || "Key checked"}${credits}.`, tone: "muted" };
  }
  return { text: `${copy.connectorTested || "Tested"}: ${base}.`, tone: "muted" };
}

function pairsToLines(pairs, separator) {
  return (pairs || []).map((pair) => `${pair.key ?? pair.name}${separator}${pair.secret ? "" : pair.value}`).join("\n");
}

function linesToPairs(text, separator) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf(separator);
      if (index < 0) return { key: line, value: "" };
      return { key: line.slice(0, index).trim(), value: line.slice(index + separator.length).trim() };
    });
}

function storedHint(pairs, copy) {
  const stored = (pairs || []).filter((pair) => pair.secret && pair.configured);
  if (!stored.length) return "";
  return `${copy.connectorStoredValues || "Stored, kept when the value is left blank"}: ${stored.map((pair) => `${pair.key ?? pair.name}${pair.hint ? ` (${pair.hint})` : ""}`).join(", ")}.`;
}

function ConnectorForm({ connector = null, onSubmit, onCancel, copy }) {
  const [name, setName] = useState(connector?.name || "");
  const [kind, setKind] = useState(connector?.kind || "stdio");
  const [command, setCommand] = useState(connector?.command || "");
  const [args, setArgs] = useState((connector?.args || []).join("\n"));
  const [env, setEnv] = useState(pairsToLines(connector?.env, "="));
  const [url, setUrl] = useState(connector?.url || "");
  const [transport, setTransport] = useState(connector?.transport || "http");
  const [headers, setHeaders] = useState(pairsToLines(connector?.headers, ": "));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const prefix = connector?.id || "new";

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const input = kind === "stdio"
        ? { name: name.trim(), kind, command: command.trim(), args: args.split("\n").map((line) => line.trim()).filter(Boolean), env: linesToPairs(env, "=") }
        : { name: name.trim(), kind, url: url.trim(), transport, headers: linesToPairs(headers, ":").map((pair) => ({ key: pair.key, value: pair.value })) };
      await onSubmit(input);
    } catch (failure) {
      setError(failure?.message || String(failure));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 py-4">
      <div className="grid gap-3 sm:grid-cols-[220px_1fr] sm:items-center">
        <label htmlFor={`${prefix}-name`} className="text-sm font-medium">{copy.connectorName || "Name"}</label>
        <Input id={`${prefix}-name`} value={name} onChange={(event) => setName(event.target.value)} placeholder="Figma" autoComplete="off" className="max-w-sm" />
        <span className="text-sm font-medium">{copy.connectorKind || "Kind"}</span>
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className="max-w-sm" aria-label={copy.connectorKind || "Kind"}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="stdio">{copy.connectorKindCommand || "Run a command"}</SelectItem>
            <SelectItem value="url">{copy.connectorKindUrl || "Connect to a URL"}</SelectItem>
          </SelectContent>
        </Select>
        {kind === "stdio" ? (
          <>
            <label htmlFor={`${prefix}-command`} className="text-sm font-medium">{copy.connectorCommand || "Command"}</label>
            <Input id={`${prefix}-command`} value={command} onChange={(event) => setCommand(event.target.value)} placeholder="npx" autoComplete="off" spellCheck={false} className="max-w-sm font-mono text-xs" />
            <label htmlFor={`${prefix}-args`} className="self-start pt-2 text-sm font-medium">{copy.connectorArgs || "Arguments"}</label>
            <div className="max-w-sm space-y-1">
              <Textarea id={`${prefix}-args`} value={args} onChange={(event) => setArgs(event.target.value)} rows={3} spellCheck={false} className="font-mono text-xs" placeholder={"-y\n@scope/server"} />
              <p className="text-xs text-muted-foreground">{copy.connectorArgsDetail || "One per line."}</p>
            </div>
            <label htmlFor={`${prefix}-env`} className="self-start pt-2 text-sm font-medium">{copy.connectorEnv || "Environment"}</label>
            <div className="max-w-sm space-y-1">
              <Textarea id={`${prefix}-env`} value={env} onChange={(event) => setEnv(event.target.value)} rows={3} spellCheck={false} className="font-mono text-xs" placeholder="API_TOKEN=…" />
              <p className="text-xs text-muted-foreground">{storedHint(connector?.env, copy) || copy.connectorEnvDetail || "KEY=value, one per line. Values that look like secrets stay on this machine."}</p>
            </div>
          </>
        ) : (
          <>
            <label htmlFor={`${prefix}-url`} className="text-sm font-medium">{copy.connectorUrl || "Address"}</label>
            <Input id={`${prefix}-url`} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://mcp.example.com/mcp" autoComplete="off" spellCheck={false} className="max-w-sm" />
            <span className="text-sm font-medium">{copy.connectorTransport || "Transport"}</span>
            <Select value={transport} onValueChange={setTransport}>
              <SelectTrigger className="max-w-sm" aria-label={copy.connectorTransport || "Transport"}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="http">{copy.connectorTransportHttp || "Streamable HTTP"}</SelectItem>
                <SelectItem value="sse">{copy.connectorTransportSse || "SSE (older servers)"}</SelectItem>
              </SelectContent>
            </Select>
            <label htmlFor={`${prefix}-headers`} className="self-start pt-2 text-sm font-medium">{copy.connectorHeaders || "Headers"}</label>
            <div className="max-w-sm space-y-1">
              <Textarea id={`${prefix}-headers`} value={headers} onChange={(event) => setHeaders(event.target.value)} rows={3} spellCheck={false} className="font-mono text-xs" placeholder="Authorization: Bearer …" />
              <p className="text-xs text-muted-foreground">{storedHint(connector?.headers, copy) || copy.connectorHeadersDetail || "Name: value, one per line. Tokens go here, never in the address."}</p>
            </div>
          </>
        )}
      </div>
      <div className="flex items-center justify-end gap-2">
        {error ? <p className="mr-auto text-sm text-destructive">{error}</p> : null}
        <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={onCancel}>{copy.cancel || "Cancel"}</Button>
        <Button type="submit" size="sm" variant="outline" disabled={saving || !name.trim()}>{saving ? copy.saving || "Saving…" : connector ? copy.save || "Save" : copy.connectorAdd || "Add connector"}</Button>
      </div>
    </form>
  );
}

function WebResearchRows({ connector, busy, onSaveKey, onTest, onToggle, copy }) {
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setKey(""); }, [connector.hasKey, connector.keyHint]);
  async function saveKey() {
    setSaving(true);
    setError("");
    try { await onSaveKey(key.trim()); setKey(""); }
    catch (failure) { setError(failure?.message || String(failure)); }
    finally { setSaving(false); }
  }
  return (
    <>
      <Row title={connector.name} description={copy.webResearchDetail || "Members search the web and read pages through Firecrawl, and cite the sources in their replies."} status={testSentence(connector, copy)}>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onTest}>{busy === "test" ? copy.testing || "Testing…" : copy.test || "Test"}</Button>
        <Switch checked={connector.enabled} disabled={Boolean(busy)} onCheckedChange={(checked) => onToggle(checked)} aria-label={connector.name} />
      </Row>
      <Row title={copy.firecrawlKey || "Firecrawl key"} description={connector.hasKey ? `${copy.connectorKeyStored || "A key is stored"}${connector.keyHint ? ` (${connector.keyHint})` : ""}. ${copy.connectorKeyReplace || "Enter a new one to replace it."}` : copy.firecrawlKeyDetail || "From firecrawl.dev. Stored on this machine and passed only to the research server."} htmlFor="connector-firecrawl-key">
        {error ? <p className="mr-auto text-sm text-destructive">{error}</p> : null}
        <Input id="connector-firecrawl-key" type="password" value={key} placeholder={connector.hasKey ? "••••••••" : "fc-…"} autoComplete="off" onChange={(event) => setKey(event.target.value)} className="max-w-xs" />
        <Button size="sm" variant="outline" disabled={!key.trim() || saving} onClick={saveKey}>{saving ? copy.saving || "Saving…" : copy.save || "Save"}</Button>
      </Row>
    </>
  );
}

/**
 * Settings › Connectors. Props:
 *   connectors  [public records]                 from GET /api/connectors
 *   onCreate(input) -> Promise                   POST /api/connectors (saved off)
 *   onUpdate(id, patch) -> Promise               PUT /api/connectors/:id; the built-in takes { apiKey }
 *   onDelete(id) -> Promise                      DELETE /api/connectors/:id
 *   onTest(id) -> Promise<result>                POST /api/connectors/:id/test
 *   onToggle(id, enabled) -> Promise             POST /api/connectors/:id/enable | disable
 *   copy        locale strings (fallbacks inline)
 * The heading is rendered by the integrator's SettingsSectionHeader.
 */
export function ConnectorsSettings({ connectors = [], onCreate, onUpdate, onDelete, onTest, onToggle, copy = {}, className }) {
  const [editingId, setEditingId] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState({});
  const [errors, setErrors] = useState({});

  async function run(id, action, operation) {
    setBusy((current) => ({ ...current, [id]: action }));
    setErrors((current) => ({ ...current, [id]: "" }));
    try { return await operation(); }
    catch (failure) { setErrors((current) => ({ ...current, [id]: failure?.message || String(failure) })); return null; }
    finally { setBusy((current) => ({ ...current, [id]: "" })); }
  }

  const builtin = connectors.find((connector) => connector.builtin);
  const custom = connectors.filter((connector) => !connector.builtin);

  return (
    <div className={cn("divide-y divide-border/65", className)}>
      {builtin ? (
        <WebResearchRows
          connector={builtin}
          busy={busy[builtin.id] || ""}
          onSaveKey={(apiKey) => onUpdate(builtin.id, { apiKey })}
          onTest={() => run(builtin.id, "test", () => onTest(builtin.id))}
          onToggle={(enabled) => run(builtin.id, "toggle", () => onToggle(builtin.id, enabled))}
          copy={copy}
        />
      ) : null}
      {custom.map((connector) => (
        <div key={connector.id}>
          <Row title={connector.name} description={kindSummary(connector)} status={errors[connector.id] ? { text: errors[connector.id], tone: "error" } : testSentence(connector, copy)}>
            <Button size="sm" variant="ghost" disabled={Boolean(busy[connector.id])} onClick={() => run(connector.id, "test", () => onTest(connector.id))}>
              {busy[connector.id] === "test" ? copy.testing || "Testing…" : copy.test || "Test"}
            </Button>
            <Button size="sm" variant="ghost" disabled={Boolean(busy[connector.id])} onClick={() => { setAdding(false); setEditingId(editingId === connector.id ? "" : connector.id); }}>
              {copy.edit || "Edit"}
            </Button>
            <Button size="sm" variant="ghost" disabled={Boolean(busy[connector.id])} onClick={() => run(connector.id, "delete", () => onDelete(connector.id))}>
              {copy.remove || "Remove"}
            </Button>
            <Switch checked={connector.enabled} disabled={Boolean(busy[connector.id])} onCheckedChange={(checked) => run(connector.id, "toggle", () => onToggle(connector.id, checked))} aria-label={connector.name} />
          </Row>
          {editingId === connector.id ? (
            <ConnectorForm
              connector={connector}
              copy={copy}
              onCancel={() => setEditingId("")}
              onSubmit={async (input) => { await onUpdate(connector.id, input); setEditingId(""); }}
            />
          ) : null}
        </div>
      ))}
      {adding ? (
        <ConnectorForm copy={copy} onCancel={() => setAdding(false)} onSubmit={async (input) => { await onCreate(input); setAdding(false); }} />
      ) : (
        <div className="flex items-center justify-between gap-6 py-4">
          <p className="text-sm leading-6 text-muted-foreground">{copy.connectorsAddDetail || "A new connector is saved off. Test it, then turn it on; members allowed to use MCP connectors get it on their next turn."}</p>
          <Button size="sm" variant="ghost" onClick={() => { setEditingId(""); setAdding(true); }}>
            <Plus className="size-3.5" aria-hidden="true" />
            {copy.connectorAdd || "Add connector"}
          </Button>
        </div>
      )}
    </div>
  );
}
