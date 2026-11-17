import { createRoot } from "react-dom/client";

import "@/styles.css";
import { SignInGate } from "@/components/account/SignInGate";
import { UpdateScreen } from "@/components/account/UpdateScreen";
import { UpdatesSettings } from "@/components/settings/UpdatesSettings";
import { SKIN_VAR_DEFAULTS, skinById, tokensForSkin } from "@/lib/skins";

// ?view=signin|update|settings &theme=light|dark &skin=<id> plus a state.
const query = new URLSearchParams(location.search);
const theme = query.get("theme") === "light" ? "light" : "dark";
document.documentElement.classList.add(theme);
// The skin's palette and shape variables, as the app applies them.
const skin = skinById(query.get("skin"));
document.documentElement.dataset.skin = skin.id;
for (const [token, value] of Object.entries(tokensForSkin(skin, theme) || {})) document.documentElement.style.setProperty(`--${token}`, value);
for (const [key, fallback] of Object.entries(SKIN_VAR_DEFAULTS)) document.documentElement.style.setProperty(`--${key}`, skin.vars?.[key] ?? fallback);
document.body.className = "bg-background text-foreground";

const flow = { id: "autohand", state: "running", url: "https://autohand.ai/cli-auth?code=WXYZ-2345&source=squad", code: "WXYZ-2345", provider: "" };
const fixtureLogin = {
  // `fail` makes starting sign-in fail, for the error state.
  startLogin: async options => {
    if (query.get("fail")) throw new Error("Could not reach autohand.ai. Check your connection and try again.");
    flow.provider = options?.provider || "";
    if (flow.provider) flow.url += `&provider=${flow.provider}`;
    return { ...flow };
  },
  loginStatus: async () => ({ ...flow }),
  openLoginPage: async () => ({ opened: true }),
  cancelLogin: async () => ({ cancelled: true }),
  refreshAccount: async () => {},
};

const version = "0.1.24";
const updates = {
  appVersion: "0.1.23",
  status: "available",
  snapshot: { success: true, source: "squad-api", currentVersion: "0.1.23", latestAllowedVersion: version, downloadName: `autohand-squad-${version}-macos-arm64.dmg`, downloadUrl: "https://example.test/squad.dmg", downloadSha256: "a".repeat(64), checkedAt: new Date().toISOString() },
};
const percent = Number(query.get("percent") || 42);
const operations = {
  downloading: { phase: "downloading", version, bytes: percent * 1_200_000, totalBytes: 120_000_000 },
  "downloading-unknown": { phase: "downloading", version, bytes: 48_000_000, totalBytes: null },
  verifying: { phase: "verifying", version },
  preparing: { phase: "preparing", version, verified: true, installMode: "restart" },
  installing: { phase: "installing", version, verified: true, installMode: "restart" },
  restarting: { phase: "restarting", version, verified: true, installMode: "restart" },
  failed: { phase: "ready", version, verified: true, installMode: "restart", error: "macOS refused to replace the app. Your saved data is unchanged." },
};
const phase = query.get("phase") || "installing";

function Fixture() {
  const view = query.get("view") || "signin";
  if (view === "update") {
    return <UpdateScreen updates={updates} operation={operations[phase]} flockSeed="fixture" onRetry={() => {}} onOpenReleases={() => {}} onClose={() => {}} />;
  }
  if (view === "settings") {
    return <main className="mx-auto max-w-2xl px-8 py-12" id="settings-updates"><UpdatesSettings updates={updates} operation={operations[phase]} onCheck={() => {}} onDownload={() => {}} onInstall={() => {}} onCancel={() => {}} onOpenReleases={() => {}} /></main>;
  }
  return <SignInGate account={{ signedIn: false }} bridgeUnavailable={query.get("offline") === "1"} flockSeed="fixture" {...fixtureLogin} />;
}

createRoot(document.getElementById("root")).render(<Fixture />);
