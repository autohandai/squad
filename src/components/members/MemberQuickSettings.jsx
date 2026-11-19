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
export function MemberQuickSettings({ agent, api, updateAgent, navigate, sections = ["team", "email", "connectors", "computer"], showMoreLink = true }) {
  const [mail, setMail] = useState({ loaded: false, allowed: false, signedIn: false, address: "", domain: "" });
  const [mailBusy, setMailBusy] = useState(false);
  const [mailError, setMailError] = useState("");
  const [connectors, setConnectors] = useState(null);
  const [computer, setComputer] = useState(null);
  const [copied, setCopied] = useState(false);
  const base = `/squad-members/${encodeURIComponent(agent.id)}`;

  const loadMail = useCallback(async () => {
    try {
      const data = await api(`/api/mail/members/${encodeURIComponent(agent.id)}`);
      setMail({ loaded: true, allowed: Boolean(data?.allowed), signedIn: Boolean(data?.signedIn), address: data?.mailbox?.address || "", domain: data?.domain || "" });
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

  async function registerEmail() {
    setMailBusy(true); setMailError("");
    try {
      await api(`/api/mail/members/${encodeURIComponent(agent.id)}`, { method: "POST", body: JSON.stringify({ memberName: agent.name }) });
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

      {sections.includes("email") ? (
        <Row
          title="Email"
          detail={mail.address
            ? `Mail sent here arrives in ${agent.name}’s chat as a summary. Pause or edit it in Automations.`
            : mail.allowed
              ? `Give ${agent.name} its own inbox, so people and services can email it directly.`
              : !mail.loaded ? "Checking…"
                : mail.signedIn ? "Members get an email address on accounts signed in with @autohand.ai."
                  : "Sign in to Autohand to give members an email address."}
        >
          {mail.address ? (
            <Button type="button" variant="ghost" size="sm" onClick={copyAddress} aria-label={`Copy ${mail.address}`}>
              <span className="max-w-48 truncate font-mono text-xs">{copied ? "Copied" : mail.address}</span><Copy data-icon="inline-end" />
            </Button>
          ) : mail.allowed ? (
            <Button type="button" variant="outline" size="sm" disabled={mailBusy} onClick={registerEmail} data-testid="member-email-register">
              {mailBusy ? "Creating…" : "Create address"}
            </Button>
          ) : null}
          {mailError ? <p className="mt-1 text-xs text-destructive" role="alert">{mailError}</p> : null}
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
