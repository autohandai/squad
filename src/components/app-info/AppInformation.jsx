import { useEffect, useState } from "react";
import { Check, Copy, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

const PAGES = {
  about: "About Autohand Squad",
  policies: "Policies",
  changelog: "Changelog",
  licenses: "Third-party licenses",
};

async function requestAppInfo(api, signal) {
  if (api) return api("/api/app-info", { signal });
  const response = await fetch("/api/app-info", { signal });
  const payload = await response.json();
  if (!response.ok || payload.success === false) throw new Error(payload.error || "App information could not be loaded.");
  return payload.data ?? payload;
}

function InformationLinks({ page }) {
  return (
    <nav aria-label="App information" className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm">
      {Object.entries(PAGES).filter(([id]) => id !== page).map(([id, label]) => (
        <a key={id} href={`/app-info/${id}?window=1`} className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {id === "about" ? "About" : label}
        </a>
      ))}
    </nav>
  );
}

function DocumentText({ text, renderMarkdown, unavailable, heading = "" }) {
  if (!text) return <p className="text-sm text-muted-foreground">{unavailable}</p>;
  const firstHeading = text.match(/^\s*#\s+([^\n]+)(?:\n|$)/);
  const content = firstHeading && firstHeading[1].trim().toLowerCase() === heading.toLowerCase() ? text.slice(firstHeading[0].length).trimStart() : text;
  if (renderMarkdown) return <div className="min-w-0 break-words text-sm leading-7 [&_li]:grid-cols-[1rem_minmax(0,1fr)]">{renderMarkdown(content)}</div>;
  return <div className="whitespace-pre-wrap break-words text-sm leading-7">{content}</div>;
}

function ExecutableChecksum({ info }) {
  const [copyState, setCopyState] = useState("");
  const hash = /^[a-f0-9]{64}$/i.test(info?.appExecutableSha256 || "") ? info.appExecutableSha256 : "";

  async function copyChecksum() {
    try {
      await navigator.clipboard.writeText(hash);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <div className="mt-6 border-t border-border/60 pt-4 text-left">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs font-medium">Desktop executable SHA-256</h2>
        {hash ? (
          <Button type="button" variant="ghost" size="icon-xs" onClick={copyChecksum} aria-label="Copy desktop executable SHA-256">
            {copyState === "copied" ? <Check /> : <Copy />}
          </Button>
        ) : null}
      </div>
      {hash ? (
        <>
          <p className="mt-2 break-all font-mono text-xs leading-5" data-testid="app-executable-sha256">{hash}</p>
          {info.appExecutableName ? <p className="mt-1 break-words text-xs text-muted-foreground">{info.appExecutableName}</p> : null}
        </>
      ) : (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">Not available. The installed desktop executable has not been measured.</p>
      )}
      {copyState ? <p className="mt-1 text-xs text-muted-foreground" role="status">{copyState === "copied" ? "Checksum copied." : "Could not copy. Select the checksum to copy it."}</p> : null}
    </div>
  );
}

function About({ info, onCheckUpdates }) {
  const commit = info?.commitHash || info?.commit || "";
  return (
    <>
      <header className="text-center">
        <img src="/brand/autohand-squad/autohand-squad-mark-light.webp" alt="" aria-hidden="true" className="mx-auto size-16 object-contain dark:hidden" />
        <img src="/brand/autohand-squad/autohand-squad-mark-dark.webp" alt="" aria-hidden="true" className="mx-auto hidden size-16 object-contain dark:block" />
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">Autohand Squad</h1>
        <p className="mt-1 text-sm text-muted-foreground">{info?.version ? `Version ${info.version}` : "Version unavailable"}</p>
        <p className="mx-auto mt-4 max-w-sm text-sm leading-6 text-muted-foreground">A workspace for human and agent teams to talk, share context, and get work done together.</p>
      </header>

      <dl className="mt-6 space-y-3 text-xs">
        <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3">
          <dt className="text-muted-foreground">Commit</dt>
          <dd className="min-w-0 leading-5"><span className="block break-all font-mono">{commit || "Not recorded"}</span>{info?.dirty === true ? <span className="mt-1 block text-muted-foreground">Local changes</span> : info?.dirty == null ? <span className="mt-1 block text-muted-foreground">Working tree state not recorded</span> : null}</dd>
        </div>
        <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3">
          <dt className="text-muted-foreground">Built</dt>
          <dd className="break-words leading-5">{info?.builtAt || "Not recorded"}</dd>
        </div>
        {info?.computerUse ? <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3">
          <dt className="text-muted-foreground">Computer Use</dt>
          <dd className="leading-5">{info.computerUse.version}{info.computerUse.prerelease ? " · prerelease component" : ""}</dd>
        </div> : null}
      </dl>

      <ExecutableChecksum info={info} />

      <div className="mt-5 flex justify-center">
        {onCheckUpdates ? (
          <Button type="button" variant="outline" size="sm" onClick={onCheckUpdates}><RefreshCw data-icon="inline-start" />Check for upgrades</Button>
        ) : (
          <Button asChild variant="outline" size="sm"><a href="/settings?section=updates&check=1"><RefreshCw data-icon="inline-start" />Check for upgrades</a></Button>
        )}
      </div>
    </>
  );
}

function LicenseNotices({ info }) {
  const entries = Array.isArray(info?.thirdPartyLicenses) ? info.thirdPartyLicenses : [];
  return (
    <>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">Licenses and notices for dependencies included in this app.</p>
      {Array.isArray(info?.licenseCoverage) && info.licenseCoverage.length ? <ul className="mt-4 space-y-2 text-xs leading-5 text-muted-foreground">{info.licenseCoverage.map((limit, index) => <li key={index}>{limit}</li>)}</ul> : null}
      <div className="mt-6 divide-y divide-border/60 border-y border-border/60">
        {entries.map((entry, index) => (
          <details key={`${entry.ecosystem}-${entry.name}-${entry.version}-${index}`} className="py-3">
            <summary className="cursor-pointer text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="font-medium">{entry.name || "Unnamed dependency"}</span>
              <span className="ml-2 break-words text-xs text-muted-foreground">{[entry.version, entry.license || "License not recorded", entry.ecosystem].filter(Boolean).join(" · ")}</span>
            </summary>
            {entry.repository ? <a href={entry.repository} target="_blank" rel="noreferrer" className="mt-3 block break-words text-xs text-muted-foreground underline underline-offset-4">{entry.repository}</a> : null}
            {entry.note ? <p className="mt-3 text-xs leading-5 text-muted-foreground">{entry.note}</p> : null}
            {entry.text ? <div className="mt-3 whitespace-pre-wrap break-words text-xs leading-6">{entry.text}</div> : <p className="mt-3 text-xs text-muted-foreground">License text was not included in this build.</p>}
          </details>
        ))}
      </div>
      {!entries.length ? <p className="mt-4 text-sm text-muted-foreground">Third-party license notices are not available for this build.</p> : null}
    </>
  );
}

export function AppInformation({ page = "about", api, info: suppliedInfo, onCheckUpdates, renderMarkdown }) {
  const [loadedInfo, setLoadedInfo] = useState(null);
  const [loading, setLoading] = useState(suppliedInfo === undefined);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const info = suppliedInfo === undefined ? loadedInfo : suppliedInfo;
  const activePage = Object.hasOwn(PAGES, page) ? page : "about";

  useEffect(() => {
    if (suppliedInfo !== undefined) return undefined;
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    requestAppInfo(api, controller.signal).then((value) => {
      if (!cancelled) setLoadedInfo(value);
    }).catch((failure) => {
      if (!cancelled) setError(failure.message || "App information could not be loaded.");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; controller.abort(); };
  }, [api, reload, suppliedInfo]);

  const documents = info?.documents || {};
  return (
    <main data-app-information={activePage} className="min-h-[100svh] bg-background px-6 py-8 text-foreground sm:px-10">
      <div className={`mx-auto ${activePage === "about" ? "max-w-md" : "max-w-2xl"}`}>
        {activePage !== "about" ? <header className="mb-6"><h1 className="text-xl font-semibold">{PAGES[activePage]}</h1>{info?.version ? <p className="mt-1 text-xs text-muted-foreground">Autohand Squad {info.version}</p> : null}</header> : null}
        {loading ? <p role="status" className="py-8 text-center text-sm text-muted-foreground">Loading app information…</p> : error ? (
          <div className="py-8 text-center"><p role="alert" className="text-sm text-destructive">{error}</p><Button variant="ghost" size="sm" className="mt-3" onClick={() => setReload((value) => value + 1)}>Try again</Button></div>
        ) : activePage === "about" ? <About info={info} onCheckUpdates={onCheckUpdates} /> : activePage === "changelog" ? (
          <DocumentText text={info?.changelog || documents.changelog} heading="Changelog" renderMarkdown={renderMarkdown} unavailable="The changelog was not included in this build." />
        ) : activePage === "policies" ? (
          <div className="space-y-8"><p className="text-sm"><a href="https://autohand.ai/policies/" target="_blank" rel="noreferrer" className="text-muted-foreground underline underline-offset-4 hover:text-foreground">Product policies</a></p><section><h2 className="mb-3 text-base font-semibold">Security policy</h2><DocumentText text={info?.security || documents.security} heading="Security policy" renderMarkdown={renderMarkdown} unavailable="A security policy was not included in this build." /></section><section><h2 className="mb-3 text-base font-semibold">Project license</h2><DocumentText text={info?.license || documents.license} renderMarkdown={renderMarkdown} unavailable="The project license was not included in this build." /></section></div>
        ) : <LicenseNotices info={info} />}
        <footer className="mt-8 border-t border-border/60 pt-5"><InformationLinks page={activePage} /></footer>
      </div>
    </main>
  );
}
