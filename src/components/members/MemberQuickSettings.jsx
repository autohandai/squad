import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { managesTeam, usesConnectors, withConnectors, withTeamManagement } from "@/lib/permission-policy";
import { EMAIL_ACTIONS, URGENCY_LEVELS, normalizeEmailPolicy } from "@/lib/email-policy";
import { cn } from "@/lib/utils";

/**
 * A member's quick settings (ADR-0265): the few switches that change what a
 * member can do, in the Execution panel's Permissions tab and at the top of
 * the profile's Permissions page. Divider rows, one sentence each, the
 * full detail one link away.
 *
 * - Manage the team: create members and change any member's setup.
 * - Email: its address on code.autohandai.com (ADR-0262), or the offer.
 * - Connectors: what it can use, and where to connect more.
 * - Computer Use: the current grant, set on the Permissions page.
 */
/**
 * Communications (ADR-0266): every way to reach the member, in one view. Its
 * direct conversation, and for accounts allowed agent email (autohand.ai),
 * its address with the name before the @ editable.
 */
export function MemberCommunications({ agent, api, navigate, updateAgent }) {
  return <MemberQuickSettings agent={agent} api={api} navigate={navigate} updateAgent={updateAgent} sections={["chat", "email", "email-rules"]} showMoreLink={false} />;
}

export function MemberQuickSettings({ agent, api, updateAgent, navigate, sections = ["team", "connectors", "computer"], showMoreLink = true }) {
  const [mail, setMail] = useState({ loaded: false, allowed: false, signedIn: false, address: "", domain: "", canRename: false, renamedFrom: "" });
  const [localPart, setLocalPart] = useState("");
  const [editing, setEditing] = useState(false);
  const [check, setCheck] = useState({ state: "idle", text: "" });
  const [mailBusy, setMailBusy] = useState(false);
  const [mailError, setMailError] = useState("");
  const [connectors, setConnectors] = useState(null);
  const [computer, setComputer] = useState(null);
  const [copied, setCopied] = useState(false);
  const base = `/squad-members/${encodeURIComponent(agent.id)}`;

  const loadMail = useCallback(async () => {
    try {
      let data = await api(`/api/mail/members/${encodeURIComponent(agent.id)}`);
      // Accounts allowed agent email give every member an address from its
      // name automatically (ADR-0262 revised); a member seen without one gets it now.
      if (data?.allowed && !data.mailbox) {
        await api("/api/mail/assign", { method: "POST" }).catch(() => {});
        data = await api(`/api/mail/members/${encodeURIComponent(agent.id)}`);
      }
      const address = data?.mailbox?.address || "";
      setMail({ loaded: true, allowed: Boolean(data?.allowed), signedIn: Boolean(data?.signedIn), address, domain: data?.domain || "", canRename: data?.mailbox?.canRename !== false, renamedFrom: data?.mailbox?.renamedFrom || "" });
      setLocalPart(address.split("@")[0] || "");
    } catch { setMail((current) => ({ ...current, loaded: true })); }
  }, [api, agent.id]);

  useEffect(() => {
    if (sections.includes("email")) void loadMail();
    if (sections.includes("connectors")) api("/api/connectors").then((data) => setConnectors((data?.connectors || []).filter((item) => item.enabled && !item.managed))).catch(() => setConnectors([]));
    if (sections.includes("computer")) api(`/api/computer-use/status?memberId=${encodeURIComponent(agent.id)}`).then(setComputer).catch(() => setComputer(null));
  }, [api, agent.id, loadMail, sections.join(",")]);

  const team = managesTeam(agent.permissions);
  function setTeam(on) {
    updateAgent?.(agent.id, { permissions: withTeamManagement(agent.permissions, on), updatedAt: new Date().toISOString() });
  }

  // As the person types a new name: is it free? (ADR-0267)
  const current = mail.address.split("@")[0];
  useEffect(() => {
    if (!editing) return undefined;
    const wanted = localPart.trim();
    if (!wanted || wanted === current) { setCheck({ state: "idle", text: "" }); return undefined; }
    if (!/^[a-z0-9][a-z0-9.-]{0,28}[a-z0-9]$/.test(wanted) || wanted.includes("..")) { setCheck({ state: "bad", text: "Use 2–30 letters, numbers, dots or dashes." }); return undefined; }
    setCheck({ state: "checking", text: "Checking…" });
    let live = true;
    const timer = setTimeout(() => {
      api(`/api/mail/available?localPart=${encodeURIComponent(wanted)}`)
        .then((result) => { if (live) setCheck(result?.available ? { state: "ok", text: "Available" } : { state: "bad", text: ({ taken: "Taken by someone else", in_use: "Another member has it", reserved: "Reserved, choose another", invalid: "Use 2–30 letters, numbers, dots or dashes." })[result?.reason] || "Not available" }); })
        .catch(() => { if (live) setCheck({ state: "bad", text: "Couldn’t check right now" }); });
    }, 350);
    return () => { live = false; clearTimeout(timer); };
  }, [api, editing, localPart, current]);

  async function saveAddress() {
    setMailBusy(true); setMailError("");
    try {
      await api(`/api/mail/members/${encodeURIComponent(agent.id)}`, { method: "PATCH", body: JSON.stringify({ localPart }) });
      setEditing(false);
      await loadMail();
    } catch (error) { setMailError(error?.message || String(error)); }
    finally { setMailBusy(false); }
  }

  const rules = normalizeEmailPolicy(agent.emailPolicy);
  function setRule(level, action) {
    updateAgent?.(agent.id, { emailPolicy: { ...rules, [level]: action }, updatedAt: new Date().toISOString() });
  }

  function copyAddress() {
    try { void navigator.clipboard.writeText(mail.address); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* the address stays visible */ }
  }

  const scope = computer?.grant?.scope;
  const computerWords = scope === "control" ? "Can operate your computer" : scope === "observe" ? "Can look at apps and screenshots" : "Not allowed";

  return (
    <div className="divide-y divide-border/70 border-y border-border/70" data-testid="member-quick-settings">
      {sections.includes("team") ? (
        <Row title="Manage the team" detail={`Let ${agent.name} create members and change any member’s setup, its own included. Off, it asks you first.`}>
          <Switch checked={team} onCheckedChange={setTeam} disabled={!updateAgent} aria-label={`Let ${agent.name} manage the team`} data-testid="manage-team-switch" />
        </Row>
      ) : null}

      {sections.includes("chat") ? (
        <Row title="Direct conversation" detail={`Message ${agent.name} from Squad here or on your iPhone. Replies, files and decisions stay in the chat.`}>
          <Button type="button" variant="ghost" size="sm" onClick={() => navigate?.(`/conversations/new?member=${encodeURIComponent(agent.id)}`)}>
            Open chat<ArrowRight data-icon="inline-end" />
          </Button>
        </Row>
      ) : null}

      {/* Only accounts allowed agent email (autohand.ai) ever see these rows. */}
      {sections.includes("email") && mail.allowed && mail.address ? (
        <div className="py-3" data-testid="member-email">
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Email address</p>
              <p className="mt-0.5 font-mono text-sm">{mail.address}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {mail.renamedFrom ? `Changed from ${mail.renamedFrom}. This is ${agent.name}’s address now.` : `Given from ${agent.name}’s name. You can change the name before the @ once.`}
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button type="button" variant="ghost" size="sm" onClick={copyAddress} aria-label={`Copy ${mail.address}`}>{copied ? "Copied" : "Copy"}<Copy data-icon="inline-end" /></Button>
              {mail.canRename && !editing ? <Button type="button" variant="outline" size="sm" onClick={() => { setEditing(true); setLocalPart(current); }} data-testid="member-email-change">Change…</Button> : null}
            </div>
          </div>
          {editing ? (
            <div className="mt-3 border-t border-border/60 pt-3">
              <div className="flex flex-wrap items-center gap-1">
                <input
                  autoFocus
                  aria-label={`New email name for ${agent.name}`}
                  data-testid="member-email-local"
                  className="w-44 rounded-md border border-input bg-transparent px-2 py-1 text-right font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={localPart}
                  maxLength={30}
                  disabled={mailBusy}
                  onChange={(event) => setLocalPart(event.target.value.toLowerCase().replace(/[^a-z0-9.-]/g, ""))}
                  onKeyDown={(event) => { if (event.key === "Enter" && check.state === "ok") void saveAddress(); if (event.key === "Escape") setEditing(false); }}
                />
                <span className="font-mono text-sm text-muted-foreground">@{mail.domain || mail.address.split("@")[1]}</span>
                <span role="status" data-testid="member-email-check" className={cn("ml-2 text-xs", check.state === "ok" ? "text-emerald-600 dark:text-emerald-400" : check.state === "bad" ? "text-destructive" : "text-muted-foreground")}>
                  {check.state === "ok" ? "✓ " : ""}{check.text}
                </span>
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">You can change it only once. {mail.address} stops receiving mail as soon as you do.</p>
              <div className="mt-2 flex gap-2">
                <Button type="button" size="sm" disabled={mailBusy || check.state !== "ok"} onClick={saveAddress} data-testid="member-email-save">{mailBusy ? "Changing…" : "Change address"}</Button>
                <Button type="button" size="sm" variant="ghost" disabled={mailBusy} onClick={() => { setEditing(false); setMailError(""); }}>Cancel</Button>
              </div>
              {mailError ? <p className="mt-1 text-xs text-destructive" role="alert">{mailError}</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {sections.includes("email-rules") && mail.allowed && mail.address ? (
        <div className="py-3" data-testid="member-email-rules">
          <p className="text-sm font-medium">When an email arrives</p>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            {agent.name} reads each email and labels it Urgent, Normal or Low. Choose what it may do for each. Replies go only to the person who wrote, from {mail.address}, one per email and at most 50 a day, and every reply shows in your chat.
          </p>
          <div className="mt-2 divide-y divide-border/60">
            {URGENCY_LEVELS.map((level) => (
              <div key={level.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-40 flex-1">
                  <p className="text-sm">{level.label}</p>
                  <p className="text-xs text-muted-foreground">{level.hint}</p>
                </div>
                <div role="radiogroup" aria-label={`${level.label} email`} className="inline-flex rounded-md border border-border/80 p-0.5">
                  {EMAIL_ACTIONS.map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      role="radio"
                      aria-checked={rules[level.id] === action.id}
                      disabled={!updateAgent}
                      data-testid={`email-rule-${level.id}-${action.id}`}
                      onClick={() => setRule(level.id, action.id)}
                      className={cn("rounded px-2.5 py-1 text-xs transition-colors", rules[level.id] === action.id ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {rules.urgent === "reply" || rules.normal === "reply" || rules.low === "reply" ? (
            <p className="mt-2 text-xs leading-5 text-muted-foreground">Replies sent on {agent.name}’s own are listed in its chat with the email they answer, so you can always see what went out.</p>
          ) : null}
        </div>
      ) : null}

      {sections.includes("connectors") ? (
        <Row
          title="Connectors"
          detail={connectors === null ? "Checking…" : !usesConnectors(agent.permissions)
            ? (connectors.length ? `Off for ${agent.name}. Turn on to let it use ${connectors.map((item) => item.name).slice(0, 3).join(", ")}.` : `Off for ${agent.name}, and nothing is connected yet.`)
            : connectors.length
              ? `Can use ${connectors.map((item) => item.name).slice(0, 3).join(", ")}${connectors.length > 3 ? ` and ${connectors.length - 3} more` : ""}.`
              : "Nothing connected yet. Connect mail, calendar or code so it can do more on its own."}
        >
          <div className="flex items-center gap-2">
            <Switch checked={usesConnectors(agent.permissions)} onCheckedChange={(on) => updateAgent?.(agent.id, { permissions: withConnectors(agent.permissions, on), updatedAt: new Date().toISOString() })} disabled={!updateAgent} aria-label={`Let ${agent.name} use connectors`} data-testid="quick-connectors-switch" />
            <Button type="button" variant="ghost" size="sm" onClick={() => navigate?.(`${base}/connector`)}>
              {connectors?.length ? "Manage" : "Connect"}<ArrowRight data-icon="inline-end" />
            </Button>
          </div>
        </Row>
      ) : null}

      {sections.includes("computer") ? (
        <Row title="Computer Use" detail={computer ? computerWords : "Checking…"}>
          <Button type="button" variant="ghost" size="sm" onClick={() => navigate?.(`${base}/permissions`)}>
            Change<ArrowRight data-icon="inline-end" />
          </Button>
        </Row>
      ) : null}

      {showMoreLink ? (
        <div className="py-3">
          <Button type="button" variant="link" size="sm" className="h-auto px-0" onClick={() => navigate?.(`${base}/permissions`)}>
            All permissions for {agent.name}<ArrowRight data-icon="inline-end" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Row({ title, detail, children }) {
  return (
    <div className="flex items-start gap-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{detail}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end">{children}</div>
    </div>
  );
}
