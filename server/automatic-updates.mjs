import { verifiedInstaller } from "./desktop-updates.mjs";
import { compareUpdateVersions } from "../src/lib/update-version.js";

// One bridge owns downloads across every window. Installation is never part
// of this policy: the explicit install endpoint remains the consent boundary.
export function createAutomaticUpdates({ settings, status, flow, platform, arch, onError = () => {} }) {
  let pending;
  async function check(knownStatus) {
    const saved = await settings();
    if (!saved.autoCheckUpdates || !saved.autoDownloadUpdates) return;
    const release = knownStatus || await status();
    if (release.status !== "available" || release.checkError || compareUpdateVersions(release.appVersion, release.snapshot?.latestAllowedVersion) !== -1) return;
    try { verifiedInstaller(release.snapshot, { platform, arch }); } catch { return; }
    const operation = await flow.progress();
    // Ready downloads, failures and cancellations require the person's next
    // decision for this version. No repeated downloads or retry storm.
    // A download of an older release is not a decision about this one
    // (ADR-0279): a 0.1.23 installer left open blocked 0.1.24.
    const superseded = ["ready", "installer-open"].includes(operation.phase) && compareUpdateVersions(operation.version, release.snapshot.latestAllowedVersion) === -1;
    if ((!["idle", "complete", "failed", "cancelled"].includes(operation.phase) && !superseded) || operation.version === release.snapshot.latestAllowedVersion) return;
    // A preference changed while discovery was in flight takes effect now.
    const current = await settings();
    if (!current.autoCheckUpdates || !current.autoDownloadUpdates) return;
    await flow.start({ version: release.snapshot.latestAllowedVersion, automatic: true });
  }
  return {
    check(knownStatus) {
      if (!pending) pending = check(knownStatus).catch(onError).finally(() => { pending = undefined; });
      return pending;
    },
  };
}
