import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, FolderOpen, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { firstPromptFor, suggestRoles } from "@/lib/squad-recruiting";

/**
 * First run: point at a folder, meet your first teammate, start talking.
 * One column, three moments; readiness stays silent while it is green and
 * appears as one sentence with one action when it is not. See ADR-0013.
 */
const MOMENTS = [
  { id: "folder", label: "Point at a folder" },
  { id: "teammate", label: "Meet your first teammate" },
  { id: "talk", label: "Start talking" },
];

export function FirstRun({
  runtime,
  workspaces = [],
  roleTemplates = [],
  fallbackWorkspace = "",
  onboardingState,
  updateOnboardingState,
  api,
  loginRequestStatus = "",
  onRequestLogin,
  onRefreshAccount,
  providerReady = true,
  onOpenProviders,
  avatarFor,
  renderTemplateAvatar,
  onCreateSomeoneElse,
  onStart,
  onSkip,
  brand,
}) {
  const [folder, setFolder] = useState(onboardingState?.selectedWorkspace || "");
  const [profile, setProfile] = useState(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [pickBusy, setPickBusy] = useState(false);
  const [folderError, setFolderError] = useState("");
  const [validatedFolder, setValidatedFolder] = useState("");
  const [profileAttempt, setProfileAttempt] = useState(0);
  const [tracking, setTracking] = useState(false);
  const [trackError, setTrackError] = useState("");
  const [roleId, setRoleId] = useState(onboardingState?.selectedRoleId || "");
  const [name, setName] = useState(onboardingState?.memberName || "");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const startingRef = useRef(false);
  const nameTouched = useRef(onboardingState?.nameTouched === true);

  const signedIn = runtime?.account?.signedIn === true;
  const runtimeReady = runtime?.available === true;

  // Profile the folder whenever it changes; the sentence it yields drives the
  // role suggestions.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    setValidatedFolder("");
    setProfile(null);
    if (!folder) {
      clearTimeout(timer);
      setProfileBusy(false);
      return undefined;
    }
    setProfileBusy(true);
    setFolderError("");
    api("/api/workspaces/profile", { method: "POST", signal: controller.signal, body: JSON.stringify({ path: folder }) })
      .then((data) => {
        if (!data?.path) throw new Error("Could not validate that folder. Choose a folder and try again.");
        if (!cancelled) {
          setProfile(data);
          setValidatedFolder(folder);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setProfile(null);
          setFolderError(controller.signal.aborted ? "Reading that folder timed out. Try again." : error?.message || "Could not read that folder.");
        }
      })
      .finally(() => {
        clearTimeout(timer);
        if (!cancelled) setProfileBusy(false);
      });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [folder, api, profileAttempt]);

  const suggestions = useMemo(() => suggestRoles(profile, roleTemplates, 3), [profile, roleTemplates]);
  const selected = suggestions.find((item) => item.template.id === roleId)
    || (roleTemplates.find((template) => template.id === roleId) ? { template: roleTemplates.find((template) => template.id === roleId) } : null);
  const moment = !folder ? "folder" : !selected ? "teammate" : "talk";
  const folderReady = Boolean(folder && validatedFolder === folder && profile && !profileBusy && !folderError);
  const canStart = Boolean(selected && folderReady && signedIn && runtimeReady && providerReady && name.trim());

  // A folder that is not a repository is a folder where a member's work
  // cannot be undone. Offer the one action that fixes that, at the moment the
  // folder is chosen rather than after something has been edited.
  async function startTracking() {
    if (!folder || tracking) return;
    setTracking(true);
    setTrackError("");
    try {
      const result = await api("/api/workspaces/track", { method: "POST", body: JSON.stringify({ path: folder }) });
      setProfile((current) => (current ? { ...current, git: result?.git || current.git } : current));
    } catch (error) {
      setTrackError(error?.message || "Could not start tracking that folder.");
    } finally {
      setTracking(false);
    }
  }

  function chooseFolder(path) {
    const next = String(path || "").trim();
    setFolder(next);
    setRoleId("");
    setValidatedFolder("");
    setStartError("");
    setFolderError("");
    setTrackError("");
    updateOnboardingState?.({ selectedWorkspace: next, selectedRoleId: "", lastStep: next ? "teammate" : "folder" });
  }

  async function pickFolder() {
    setPickBusy(true);
    try {
      const picked = await api("/api/workspaces/pick", { method: "POST", body: JSON.stringify({ title: "Choose the folder your first teammate will work in" }) });
      if (picked?.path) chooseFolder(picked.path);
    } catch (error) {
      setFolderError(error?.message || "Could not open the folder picker. Try again or choose a recent folder.");
    } finally {
      setPickBusy(false);
    }
  }

  function chooseRole(template) {
    setRoleId(template.id);
    const nextName = nameTouched.current ? name : template.defaultName || defaultNameFor(template);
    setName(nextName);
    setStartError("");
    updateOnboardingState?.({ selectedRoleId: template.id, memberName: nextName, nameTouched: nameTouched.current, lastStep: "talk" });
  }

  async function start() {
    if (!canStart || startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    setStartError("");
    try {
      await onStart?.({
        template: selected.template,
        name: name.trim() || selected.template.defaultName || defaultNameFor(selected.template),
        folder,
        profile,
        prompt: firstPromptFor(selected.template.title, profile?.name || basename(folder), profile?.summary || ""),
      });
    } catch (error) {
      setStartError(error?.message || "Could not prepare your teammate. Try again.");
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  }

  const recent = workspaces.filter((item) => item?.path && item.path !== folder).slice(0, 5);
  const blockers = [];
  if (!signedIn) blockers.push({ text: "Sign in with your Autohand account to give your teammates a brain.", action: "Sign in", onAction: onRequestLogin, secondary: onRefreshAccount ? { label: "Refresh", onAction: onRefreshAccount } : null, note: loginRequestStatus });
  if (signedIn && !runtimeReady) blockers.push({ text: "The local Autohand runtime is not answering yet.", action: "Retry", onAction: onRefreshAccount });
  if (signedIn && runtimeReady && !providerReady) blockers.push({ text: "No model provider is configured. Autohand AI works with your account.", action: "Open providers", onAction: onOpenProviders });

  const folderFeedback = folderError ? (
    <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
      <span role="alert" className="text-destructive">{folderError}</span>
      {folder ? <Button variant="ghost" size="sm" onClick={() => { setProfileBusy(true); setProfileAttempt((current) => current + 1); }}>Retry folder</Button> : null}
    </div>
  ) : null;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-2xl px-6 py-12 lg:py-16">
        <header className="flex items-center gap-3">
          {brand}
          <div className="min-w-0">
            <div className="text-sm font-semibold">Autohand Squad</div>
            <div className="text-xs text-muted-foreground">First run</div>
          </div>
        </header>

        <ol className="mt-10 flex flex-wrap gap-x-6 gap-y-1 text-xs">
          {MOMENTS.map((item, index) => {
            const active = item.id === moment;
            const done = MOMENTS.findIndex((m) => m.id === moment) > index;
            return (
              <li key={item.id} className={cn("flex items-center gap-2", active ? "text-foreground" : "text-muted-foreground")}>
                <span className={cn("grid size-5 place-items-center rounded-full border text-[10px]", active && "border-foreground", done && "border-transparent bg-foreground text-background")}>{index + 1}</span>
                <span className={cn(active && "font-medium")}>{item.label}</span>
              </li>
            );
          })}
        </ol>

        {blockers.length ? (
          <div className="mt-8 border-y border-border/70 py-4 text-sm">
            {blockers.map((blocker) => (
              <div key={blocker.text} className="flex flex-wrap items-center gap-3">
                <span className="min-w-0 flex-1">{blocker.text}</span>
                {blocker.secondary ? (
                  <Button variant="ghost" size="sm" onClick={blocker.secondary.onAction}>
                    <RefreshCw data-icon="inline-start" />
                    {blocker.secondary.label}
                  </Button>
                ) : null}
                <Button size="sm" onClick={blocker.onAction}>{blocker.action}</Button>
                {blocker.note ? <span className="basis-full text-xs text-muted-foreground">{blocker.note}</span> : null}
              </div>
            ))}
          </div>
        ) : null}

        {moment === "folder" ? (
          <section className="mt-10">
            <h1 className="text-3xl font-semibold tracking-tight">Point at a folder.</h1>
            <p className="mt-3 text-base text-muted-foreground">Your first teammate works inside one folder on this Mac. Pick the project you want help with; you can add more later.</p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button onClick={pickFolder} disabled={pickBusy}>
                {pickBusy ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <FolderOpen data-icon="inline-start" />}
                Choose a folder…
              </Button>
              {fallbackWorkspace ? (
                <Button variant="ghost" onClick={() => chooseFolder(fallbackWorkspace)}>
                  Use {basename(fallbackWorkspace)}
                </Button>
              ) : null}
            </div>
            {folderFeedback}
            {recent.length ? (
              <div className="mt-8">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Recent</div>
                <ul className="mt-2 divide-y divide-border/70">
                  {recent.map((item) => (
                    <li key={item.path}>
                      <button type="button" className="flex w-full items-center justify-between gap-4 py-2.5 text-left text-sm hover:text-foreground" onClick={() => chooseFolder(item.path)}>
                        <span className="min-w-0 truncate font-medium">{item.name || basename(item.path)}</span>
                        <span className="min-w-0 truncate text-xs text-muted-foreground">{item.label || item.path}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : null}

        {moment === "teammate" ? (
          <section className="mt-10">
            <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => chooseFolder("")}>
              ← {basename(folder)}
            </button>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Meet your first teammate.</h1>
            <p className="mt-3 min-h-6 text-base text-muted-foreground">
              {profileBusy ? "Looking at the folder…" : profile?.summary || "Choose a readable project folder to continue."}
            </p>
            {folderFeedback}
            {roleId && !selected ? <p role="alert" className="mt-3 text-sm text-muted-foreground">Your previously selected role is no longer available. Choose a teammate to continue.</p> : null}
            {/* Version control, said once, where the folder is chosen. A
                tracked folder says who commits will be from; an untracked one
                offers to become tracked. Neither blocks going on. */}
            {folderReady && profile?.git?.available !== false ? (
              <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                {profile?.git?.tracked ? (
                  <span>
                    Tracked by git{profile.git.branch ? ` on ${profile.git.branch}` : ""}
                    {profile.git.name ? `. Commits here will be from ${profile.git.name}.` : "."}
                  </span>
                ) : (
                  <>
                    <span>Not tracked by git, so nothing a teammate changes here can be undone.</span>
                    <button
                      type="button"
                      onClick={startTracking}
                      disabled={tracking}
                      className="underline underline-offset-4 transition-colors hover:text-foreground disabled:opacity-60"
                    >
                      {tracking ? "Starting…" : "Start tracking"}
                    </button>
                  </>
                )}
                {trackError ? <span className="text-destructive">{trackError}</span> : null}
              </p>
            ) : null}
            {!profileBusy ? (
              <ul className="mt-6 divide-y divide-border/70">
                {suggestions.map(({ template, needs }, index) => (
                  <li key={template.id}>
                    <button type="button" className="flex w-full items-center gap-4 py-3 text-left hover:text-foreground" onClick={() => chooseRole(template)}>
                      {renderTemplateAvatar ? renderTemplateAvatar(template, "size-10 rounded-md") : null}
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">
                          {template.title}
                          {index === 0 ? <span className="ml-2 text-xs font-normal text-muted-foreground">Best fit</span> : null}
                        </span>
                        <span className="block truncate text-sm text-muted-foreground">{fitSentence(needs, template)}</span>
                      </span>
                      <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-6">
              <Button variant="ghost" size="sm" disabled={!folderReady || starting} onClick={() => onCreateSomeoneElse?.(folder)}>
                Create someone else…
              </Button>
            </div>
          </section>
        ) : null}

        {moment === "talk" && selected ? (
          <section className="mt-10">
            <button type="button" disabled={starting} className="text-xs text-muted-foreground hover:text-foreground" onClick={() => { setRoleId(""); setStartError(""); updateOnboardingState?.({ selectedRoleId: "", lastStep: "teammate" }); }}>
              ← {selected.template.title}
            </button>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Start talking.</h1>
            <div className="mt-6 flex items-center gap-4">
              {avatarFor ? avatarFor(selected.template, name, "size-14 rounded-md") : null}
              <div className="min-w-0 flex-1">
                <label className="text-xs text-muted-foreground" htmlFor="first-run-name">Name</label>
                <Input
                  id="first-run-name"
                  className="mt-1 max-w-xs"
                  value={name}
                  disabled={starting}
                  onChange={(event) => {
                    nameTouched.current = true;
                    setName(event.target.value);
                    updateOnboardingState?.({ memberName: event.target.value, nameTouched: true });
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") start();
                  }}
                />
                <div className="mt-1 text-sm text-muted-foreground">
                  {selected.template.title} · {basename(folder)}
                </div>
              </div>
            </div>
            {profileBusy ? <p className="mt-3 text-sm text-muted-foreground">Looking at the folder…</p> : folderFeedback}
            <p className="mt-6 text-sm text-muted-foreground">
              Your first message is drafted so you can just press send: “{firstPromptFor(selected.template.title, profile?.name || basename(folder), profile?.summary || "")}”
            </p>
            <div className="mt-6 flex items-center gap-3">
              <Button onClick={start} disabled={starting || !canStart}>
                {starting ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}
                Start the conversation
              </Button>
            </div>
            {startError ? <p role="alert" className="mt-3 text-sm text-destructive">{startError}</p> : null}
          </section>
        ) : null}

        <footer className="mt-14 flex items-center justify-between border-t border-border/70 pt-4 text-xs text-muted-foreground">
          <span>Your choices are saved. You can return from Settings.</span>
          <Button variant="ghost" size="sm" onClick={onSkip} disabled={!signedIn || starting}>
            Skip for now
          </Button>
        </footer>
      </div>
    </div>
  );
}

function fitSentence(needs, template) {
  const labels = { frontend: "the UI", backend: "the service code", mobile: "the mobile app", infra: "infra and CI", tests: "the tests", docs: "the docs", data: "the data layer", security: "auth and security", ai: "the AI parts" };
  if (!needs?.length) return template.description ? template.description.split(". ")[0] + "." : "A good all-rounder to start with.";
  const list = needs.map((need) => labels[need] || need);
  const joined = list.length === 1 ? list[0] : list.length === 2 ? `${list[0]} and ${list[1]}` : `${list.slice(0, -1).join(", ")}, and ${list[list.length - 1]}`;
  return `Fits this folder: ${joined}.`;
}

function defaultNameFor(template) {
  const names = {
    "frontend-developer": "Noah",
    "backend-engineer": "Mila",
    "full-stack-developer": "Ari",
    "mobile-developer": "Tane",
    "ux-ui-designer": "Aroha",
    "solution-architect": "Iris",
    "devops-engineer": "Kai",
    "platform-engineer": "Rewi",
    "security-engineer": "Manaia",
    "ai-engineer": "Nikau",
    "technical-writer": "Wren",
    "common-qa-engineer": "Eva",
    "data-analyst": "Huia",
  };
  return names[template?.id] || "Sam";
}

function basename(path) {
  return String(path || "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "";
}
