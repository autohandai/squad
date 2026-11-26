import { useEffect, useState } from "react";
import { Check, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PresenceDot } from "@/components/members/PresenceDot";
import { saveQuickChatSettings } from "@/components/settings/QuickChatPreferences";
import { cn } from "@/lib/utils";
import trayTemplate from "../../../src-tauri/icons/tray-template.png";
import { SaveStatus } from "@/components/ui/loading";

const MODES = [
  { id: "single", label: "One Squad icon", detail: "One quiet mark. Your members wait inside Quick Chat, one click away." },
  { id: "active-agents", label: "Agent avatars", detail: "Each available member gets their own avatar, with a dot that shows who is working." },
];
const PRESENCE = ["online", "working", "idle"];

/**
 * The Squad item exactly as the native shell draws it: the same template
 * image, tinted by the menu bar like every macOS status item.
 */
function SquadMark({ className }) {
  const mask = { maskImage: `url(${trayTemplate})`, WebkitMaskImage: `url(${trayTemplate})`, maskSize: "contain", WebkitMaskSize: "contain", maskRepeat: "no-repeat", WebkitMaskRepeat: "no-repeat", maskPosition: "center", WebkitMaskPosition: "center" };
  return <span className={cn("block bg-current", className)} style={mask} />;
}

/**
 * A small, looping picture of the macOS menu bar: the pointer reaches Squad,
 * the item highlights, and Quick Chat drops from it with the selected member
 * already answering. Decorative only; the choices below carry the meaning.
 * Under reduced motion it is one still frame with Quick Chat open.
 */
export function MenuBarPreview({ mode, members }) {
  const avatars = mode === "active-agents";
  // The middle portrait is the one being clicked; members[1] is the person shown answering.
  const selected = members[1];
  return <div aria-hidden="true" data-testid="menu-bar-preview" data-mode={mode} className="menu-bar-preview relative h-52 select-none overflow-hidden rounded-lg bg-muted/55">
    {/* Whatever the person is working in, kept faint so the menu bar leads. */}
    <div className="absolute bottom-[-12px] left-6 top-12 w-[44%] rounded-md border border-border/60 bg-background/55">
      <div className="flex gap-1 px-2.5 py-2"><span className="size-1.5 rounded-full bg-foreground/15" /><span className="size-1.5 rounded-full bg-foreground/15" /><span className="size-1.5 rounded-full bg-foreground/15" /></div>
      <div className="space-y-2 px-4 pt-2"><span className="block h-1.5 w-2/5 rounded-full bg-foreground/15" /><span className="block h-1.5 w-4/5 rounded-full bg-foreground/10" /><span className="block h-1.5 w-3/5 rounded-full bg-foreground/10" /><span className="block h-1.5 w-2/3 rounded-full bg-foreground/10" /></div>
    </div>
    <div className="absolute inset-x-0 top-0 flex h-7 items-center gap-3 border-b border-border/60 bg-background/85 px-3 text-[11px] text-foreground/80">
      <span className="flex flex-1 items-center gap-2.5" aria-hidden="true">
        <span className="h-1.5 w-7 rounded-full bg-foreground/25" /><span className="h-1.5 w-5 rounded-full bg-foreground/12" /><span className="h-1.5 w-6 rounded-full bg-foreground/12" /><span className="h-1.5 w-5 rounded-full bg-foreground/12" />
      </span>
      <Wifi className="size-3 text-foreground/55" strokeWidth={2.4} />
      <span className="relative flex items-center" style={{ "--mb-anchor": avatars ? "60px" : "46px" }}>
        <span className="mb-item flex h-[22px] items-center gap-[3px] rounded-[5px] px-1">
          {avatars ? members.map((member, index) => <span key={member.key} className="relative inline-flex">
            <span className="inline-flex size-4 overflow-hidden rounded-full">{member.avatar("size-4 rounded-full")}</span>
            <PresenceDot state={PRESENCE[index]} size="xs" className="absolute -bottom-px -right-px ring-1" />
          </span>) : <SquadMark className="size-4" />}
        </span>
        <svg className="mb-cursor pointer-events-none absolute left-1/2 top-1/2 z-20 h-4 w-3 drop-shadow-sm" viewBox="0 0 12 17" fill="none"><path d="M1 1v13.2l3.3-3.1 2.2 5 2.1-.9-2.2-4.9H11L1 1Z" fill="black" stroke="white" strokeWidth="1.1" strokeLinejoin="round" /></svg>
        <span className="mb-popover absolute right-[-40px] top-[calc(100%+9px)] z-10 block w-52">
          <span className="absolute -top-1 size-2 rotate-45 border-l border-t border-border/80 bg-popover" style={{ right: "calc(var(--mb-anchor) - 4px)" }} />
          <span className="block rounded-lg border border-border/80 bg-popover p-2.5 text-popover-foreground shadow-lg">
            <span className="flex items-center justify-center gap-2">
              {members.map((member, index) => <span key={member.key} className={cn("relative inline-flex rounded-full", index === 1 ? "ring-2 ring-foreground/70 ring-offset-1 ring-offset-popover" : "opacity-70")}>
                <span className="inline-flex size-6 overflow-hidden rounded-full">{member.avatar("size-6 rounded-full")}</span>
                <PresenceDot state={PRESENCE[index]} size="xs" className="absolute -bottom-px -right-px ring-1 ring-popover" />
              </span>)}
            </span>
            <span className="mt-1.5 block truncate text-center text-[10px] text-muted-foreground">{selected.name} · Working</span>
            <span className="mt-2 block rounded-md bg-muted px-2 py-1.5 text-[10.5px] leading-4">
              <span className="mb-type block whitespace-nowrap">On it. Summary goes to #general.</span>
            </span>
            <span className="mt-2 flex h-6 items-center justify-between rounded-md border border-border/80 px-2 text-[10px] text-muted-foreground">
              <span className="truncate">Message {selected.name}</span><span aria-hidden="true">↵</span>
            </span>
          </span>
        </span>
      </span>
      <span className="tabular-nums">Mon 9:41</span>
    </div>
  </div>;
}

/** Onboarding: how Squad appears in the macOS menu bar. Saves through the Settings › Quick Chat path. */
export function MenuBarStep({ api, members, onBack, onContinue, footerNote }) {
  const [settings, setSettings] = useState(null);
  const [mode, setMode] = useState("single");
  const [peek, setPeek] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let disposed = false;
    api("/api/system/settings").then(value => { if (!disposed) { setSettings(value); setMode(value?.quickChatMenuBarMode || "single"); setError(""); } }).catch(failure => { if (!disposed) setError(failure.message); });
    return () => { disposed = true; };
  }, [api, attempt]);
  async function choose(next) {
    if (busy || !settings || next === mode && settings.quickChatEnabled !== false) return;
    const previous = mode;
    setMode(next); setBusy(true); setError(""); setStatus("");
    try {
      // Choosing how Quick Chat appears is also choosing to have it.
      const { saved, notice } = await saveQuickChatSettings(api, settings.quickChatEnabled === false ? { quickChatEnabled: true, quickChatMenuBarMode: next } : { quickChatMenuBarMode: next });
      setSettings(saved); setMode(saved.quickChatMenuBarMode || next);
      setStatus(notice || `Saved. ${MODES.find(item => item.id === next).label} is in your menu bar now.`);
    } catch (failure) { setMode(previous); setError(failure.message || "Could not save the menu bar choice."); }
    finally { setBusy(false); }
  }
  const shown = peek || mode;
  return <section aria-labelledby="menu-bar-heading" data-testid="onboarding-menu-bar">
    <h1 id="menu-bar-heading" tabIndex={-1} className="text-3xl font-semibold tracking-tight">How Squad shows in your menu bar.</h1>
    <p className="mt-3 text-base text-muted-foreground">Squad stays up in the menu bar while you work. Click it to open Quick Chat and talk to any member, or press ⌘⇧K from anywhere.</p>
    <div className="mt-8"><MenuBarPreview key={shown} mode={shown} members={members} /></div>
    <fieldset className="mt-6" disabled={!settings}>
      <legend className="text-sm font-semibold">Show in the menu bar</legend>
      <div className="mt-2 divide-y divide-border/70" onMouseLeave={() => setPeek(null)}>
        {MODES.map(item => {
          const checked = mode === item.id;
          return <label key={item.id} onMouseEnter={() => setPeek(item.id)} className="group flex cursor-pointer items-start gap-3 py-3.5 has-[:focus-visible]:rounded-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring">
            <input type="radio" name="menu-bar-mode" value={item.id} checked={checked} onChange={() => choose(item.id)} className="sr-only" aria-describedby={`menu-bar-${item.id}-detail`} />
            <span className="mt-0.5 grid size-4 shrink-0 place-items-center" aria-hidden="true">{checked ? <Check className="size-4" /> : null}</span>
            <span className="min-w-0 flex-1">
              <span className={cn("block text-sm", checked ? "font-semibold" : "text-foreground/85")}>{item.label}</span>
              <span id={`menu-bar-${item.id}-detail`} className="mt-0.5 block text-sm text-muted-foreground">{item.detail}</span>
            </span>
          </label>;
        })}
      </div>
    </fieldset>
    <div className="min-h-5 text-sm" aria-live="polite">
      {busy ? <SaveStatus state="saving" className="text-sm" /> : status ? <span className="text-muted-foreground">{status}</span> : settings?.quickChatEnabled === false ? <span className="text-muted-foreground">Quick Chat is off. Choosing a style turns it back on.</span> : null}
    </div>
    {error ? <div className="mt-2 text-sm"><p role="alert" className="text-destructive">{error}</p>{!settings ? <Button variant="ghost" size="sm" onClick={() => setAttempt(value => value + 1)}>Retry</Button> : null}</div> : null}
    <footer className="mt-8 flex flex-wrap items-center gap-2 border-t border-border/70 pt-6">
      <Button onClick={onContinue} disabled={busy}>Continue</Button>
      {onBack ? <Button variant="ghost" onClick={onBack} disabled={busy}>Back</Button> : null}
      <p className="basis-full pt-1 text-xs text-muted-foreground">{footerNote || "Change this any time in Settings › Quick Chat."}</p>
    </footer>
  </section>;
}
