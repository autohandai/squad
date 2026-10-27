export const UPDATE_BUSY_PHASES = new Set([
  "checking",
  "downloading",
  "verifying",
  "preparing",
  "installing",
  "restarting",
]);
export function updateInstallAction(operation = {}) {
  if (!operation.verified || !["ready", "failed", "installer-open"].includes(operation.phase)) return null;
  if (operation.installMode === "restart") return "Install and restart";
  return operation.phase === "installer-open" ? "Open installer again" : "Install update";
}
export function updatePercent(operation) {
  const bytes = Number(operation?.bytes);
  const total = Number(operation?.totalBytes);
  return total > 0 && bytes >= 0
    ? Math.min(100, Math.floor((bytes / total) * 100))
    : null;
}
export function updateBytes(value) {
  if (!Number.isFinite(Number(value)) || Number(value) < 0) return "";
  const bytes = Number(value);
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}
export function checkedTime(value) {
  const stamp = String(value || "").replace(/^unix-ms:/, "");
  const date = new Date(/^\d+$/.test(stamp) ? Number(stamp) : stamp);
  return Number.isFinite(date.getTime()) ? date : null;
}
function compare(a, b) {
  const x = String(a).replace(/^v/, "").split(/[.-]/);
  const y = String(b).replace(/^v/, "").split(/[.-]/);
  for (let i = 0; i < 3; i++) {
    const d = Number(x[i]) - Number(y[i]);
    if (d) return d;
  }
  return 0;
}
export function updateView(
  updates,
  operation = {},
  { checking = false, error = "" } = {},
) {
  const snapshot = updates?.snapshot;
  const current = updates?.appVersion || snapshot?.currentVersion || "";
  const latest = snapshot?.latestAllowedVersion || "";
  const available =
    updates?.status === "available" &&
    snapshot?.success === true &&
    ["github:autohandai/squad", "squad-api"].includes(snapshot?.source);
  const downloadable =
    available &&
    snapshot.downloadUrl &&
    snapshot.downloadName &&
    /^[a-f0-9]{64}$/i.test(snapshot.downloadSha256 || "");
  const phase = operation.phase || "idle";
  const busy = UPDATE_BUSY_PHASES.has(phase);
  const rawFailure =
    error || operation.error || updates?.checkError || snapshot?.error || "";
  const failure = rawFailure.includes("--squad-swap-update") && /Operation not permitted|Permission denied/i.test(rawFailure)
    ? "macOS blocked automatic installation. Open the verified installer to finish updating. Your saved data is unchanged."
    : rawFailure;
  const preview =
    updates?.status === "up-to-date" && latest && compare(current, latest) > 0;
  const titles = {
    checking: "Checking for updates…",
    downloading: `Downloading ${operation.version || latest}…`,
    verifying: "Verifying the download…",
    preparing: "Preparing the update…",
    ready: `Version ${operation.version || latest} is ready`,
    installing: "Installing update…",
    restarting: "Reopening Squad…",
    "installer-open": "Installer opened",
    complete: operation.message || "Update complete",
    cancelled: "Download cancelled",
  };
  const title =
    titles[phase] ||
    (checking
      ? "Checking for updates…"
      : error || operation.error
        ? "Could not update"
        : updates?.status === "offline"
          ? "Update service is offline"
          : updates?.status === "check-failed"
            ? "Could not check for updates"
            : available
              ? `Version ${latest} is available`
              : preview
                ? "You’re running a preview"
                : updates?.status === "up-to-date"
                  ? "You're up to date"
                  : "Not checked yet");
  return {
    current,
    latest,
    available,
    downloadable: Boolean(downloadable),
    busy,
    phase,
    failure,
    preview,
    title,
    percent: updatePercent(operation),
  };
}
