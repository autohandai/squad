import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { managesTeam, withTeamManagement } from "@/lib/permission-policy";

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
export function MemberCommunications({ agent, api, navigate }) {
  return <MemberQuickSettings agent={agent} api={api} navigate={navigate} sections={["chat", "email"]} showMoreLink={false} />;
}

export function MemberQuickSettings({ agent, api, updateAgent, navigate, sections = ["team", "connectors", "computer"], showMoreLink = true }) {
  const [mail, setMail] = useState({ loaded: false, allowed: false, signedIn: false, address: "", domain: "" });
  const [localPart, setLocalPart] = useState("");
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
      setMail({ loaded: true, allowed: Boolean(data?.allowed), signedIn: Boolean(data?.signedIn), address, domain: data?.domain || "" });
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

  async function saveAddress() {
    setMailBusy(true); setMailError("");
    try {
      await api(`/api/mail/members/${encodeURIComponent(agent.id)}`, { method: "PATCH", body: JSON.stringify({ localPart }) });
      await loadMail();
    } catch (error) { setMailError(error?.message || String(error)); }
    finally { setMailBusy(false); }
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

      {/* Only accounts allowed agent email (autohand.ai) ever see this row. */}
      {sections.includes("email") && mail.allowed && mail.address ? (
        <Row title="Email" detail={`Mail sent here arrives in ${agent.name}’s chat as a summary. Change the name before the @ if you like.`}>
          <div className="flex items-center gap-1">
            <input
              aria-label={`${agent.name}’s email name`}
              data-testid="member-email-local"
              className="w-36 rounded-md border border-input bg-transparent px-2 py-1 text-right font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={localPart}
              maxLength={30}
              disabled={mailBusy}
              onChange={(event) => setLocalPart(event.target.value.toLowerCase().replace(/[^a-z0-9.-]/g, ""))}
              onKeyDown={(event) => { if (event.key === "Enter" && localPart !== mail.address.split("@")[0]) void saveAddress(); }}
            />
            <span className="font-mono text-xs text-muted-foreground">@{mail.domain || mail.address.split("@")[1]}</span>
          </div>
          <div className="mt-1 flex gap-1">
            {localPart && localPart !== mail.address.split("@")[0] ? (
              <Button type="button" size="sm" variant="outline" disabled={mailBusy || localPart.length < 2} onClick={saveAddress} data-testid="member-email-save">{mailBusy ? "Saving…" : "Save"}</Button>
            ) : (
              <Button type="button" variant="ghost" size="sm" onClick={copyAddress} aria-label={`Copy ${mail.address}`}>{copied ? "Copied" : "Copy"}<Copy data-icon="inline-end" /></Button>
            )}
          </div>
          {mailError ? <p className="mt-1 max-w-56 text-right text-xs text-destructive" role="alert">{mailError}</p> : null}
        </Row>
      ) : null}

      {sections.includes("connectors") ? (
        <Row
          title="Connectors"
          detail={connectors === null ? "Checking…" : connectors.length
            ? `Can use ${connectors.map((item) => item.name).slice(0, 3).join(", ")}${connectors.length > 3 ? ` and ${connectors.length - 3} more` : ""}.`
            : "Nothing connected yet. Connect mail, calendar or code so it can do more on its own."}
        >
          <Button type="button" variant="ghost" size="sm" onClick={() => navigate?.(`${base}/connector`)}>
            {connectors?.length ? "Manage" : "Connect"}<ArrowRight data-icon="inline-end" />
          </Button>
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
