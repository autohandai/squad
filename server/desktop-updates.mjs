import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";

export const UPDATE_REPOSITORY = "autohandai/squad";
export const RELEASES_URL = `https://github.com/${UPDATE_REPOSITORY}/releases`;
export const MAX_INSTALLER_BYTES = 1024 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;

function updateError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

async function readJson(path) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

function daemonBaseUrl(value) {
  const url = new URL(String(value));
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw updateError("The update daemon must be on this computer.");
  }
  return url.origin;
}

async function daemonRequest(fetchImpl, url, options = {}, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal, redirect: "error" });
    if (!response.ok) throw updateError(`Update service returned HTTP ${response.status}.`, 502);
    return options.method === "POST" ? await response.json() : null;
  } finally { clearTimeout(timer); }
}

/**
 * A failed fresh check never turns a cached snapshot into a current result.
 * `autoCheck` is the Settings → System switch (ADR-0105): when it is off an
 * unattended call (refresh=false) only reports what update.json already
 * holds and never asks the daemon to contact the repository; a manual check
 * (refresh=true) always runs.
 */
export async function desktopUpdateStatus({ squadStateDir, appVersion, refresh = false, autoCheck = true, readJsonImpl = readJson, fetchImpl = fetch }) {
  const [record, saved] = await Promise.all([
    readJsonImpl(join(squadStateDir, "daemon.json")),
    readJsonImpl(join(squadStateDir, "update.json")),
  ]);
  let snapshot = saved || null;
  let daemonReachable = false;
  let checkError = "";
  let fresh = false;
  if (record?.url) {
    try {
      const base = daemonBaseUrl(record.url);
      await daemonRequest(fetchImpl, `${base}/health`);
      daemonReachable = true;
      if (refresh || (!snapshot && autoCheck !== false)) {
        try {
          const body = await daemonRequest(fetchImpl, `${base}/updates/check`, { method: "POST" }, 30_000);
          const result = body?.data || body;
          if (!result || typeof result !== "object" || result.success !== true || result.error) {
            throw updateError(result?.error || "The repository update check did not succeed.", 502);
          }
          snapshot = result;
          fresh = true;
        } catch (error) { checkError = error.message || "The repository update check failed."; }
      }
    } catch (error) { checkError = error.message || "The local update service is unavailable."; }
  }
  const status = !daemonReachable ? "offline" : checkError || snapshot?.error || snapshot?.success === false ? "check-failed" : !snapshot?.checkedAt || snapshot?.success !== true ? "never-checked" : snapshot.updateAvailable ? "available" : "up-to-date";
  return { daemonReachable, appVersion, repository: UPDATE_REPOSITORY, releasesUrl: RELEASES_URL, snapshot, status, checkError: checkError || snapshot?.error || "", fresh, autoCheck: autoCheck !== false, skipped: !refresh && autoCheck === false };
}

export function verifiedInstaller(snapshot, { platform = process.platform, arch = process.arch } = {}) {
  if (snapshot?.success !== true || snapshot.error || snapshot.updateAvailable !== true || snapshot.source !== `github:${UPDATE_REPOSITORY}`) {
    throw updateError("A successful update check from the official repository is required.", 409);
  }
  const version = String(snapshot.latestAllowedVersion || "");
  const name = String(snapshot.downloadName || "");
  const sha256 = String(snapshot.downloadSha256 || "").toLowerCase();
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version) || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw updateError("This release does not include a verified installer for your computer.", 409);
  }
  const system = { darwin: "macos", win32: "windows", linux: "linux" }[platform];
  const cpu = { x64: "x64", arm64: "arm64" }[arch];
  const suffixes = { darwin: [".dmg"], win32: ["-setup.exe", ".msi"], linux: [".deb", ".AppImage"] }[platform] || [];
  const stem = `autohand-squad-${version}-${system}-${cpu}`;
  if (!system || !cpu || !suffixes.some((suffix) => name === `${stem}${suffix}`)) {
    throw updateError("The release installer does not match this computer.", 409);
  }
  let url;
  try { url = new URL(String(snapshot.downloadUrl || "")); }
  catch { throw updateError("The release installer URL is missing or invalid.", 409); }
  const paths = [version, `v${version}`].map((tag) => `/${UPDATE_REPOSITORY}/releases/download/${tag}/${name}`);
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port || url.username || url.password || url.search || url.hash || !paths.includes(url.pathname)) {
    throw updateError("The installer must come from the official Squad repository.", 409);
  }
  return { name, sha256, url: url.href, version };
}

function allowedAssetRedirect(url) {
  return url.protocol === "https:" && !url.username && !url.password && !url.port && ["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(url.hostname);
}

async function installerResponse(fetchImpl, initialUrl, signal) {
  let url = new URL(initialUrl);
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await fetchImpl(url.href, { redirect: "manual", signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw updateError("The installer download returned an invalid redirect.", 502);
      url = new URL(location, url);
      if (!allowedAssetRedirect(url)) throw updateError("The installer download redirected outside GitHub.", 502);
      continue;
    }
    if (!response.ok || !response.body) throw updateError(`Installer download failed (HTTP ${response.status}).`, 502);
    return response;
  }
  throw updateError("The installer download redirected too many times.", 502);
}

/** Fixed executables and argument arrays only; no shell or supplied command. */
export async function openDesktopTarget(target, { platform = process.platform, spawnImpl = spawn } = {}) {
  if (target !== RELEASES_URL && !isAbsolute(target)) throw updateError("Invalid installer path.");
  let executable;
  let args;
  if (platform === "darwin") { executable = "open"; args = [target]; }
  else if (platform === "win32") {
    if (target === RELEASES_URL) { executable = "explorer.exe"; args = [target]; }
    else if (target.endsWith(".msi")) { executable = "msiexec.exe"; args = ["/i", target]; }
    else { executable = target; args = []; }
  } else if (platform === "linux") { executable = "xdg-open"; args = [target.endsWith(".AppImage") ? dirname(target) : target]; }
  else throw updateError("Opening installers is not supported on this platform.");
  await new Promise((resolve, reject) => {
    const waitForExit = platform !== "win32";
    const child = spawnImpl(executable, args, { shell: false, stdio: "ignore", detached: true, windowsHide: true, ...(waitForExit ? { timeout: 15_000 } : {}) });
    child.once("error", reject);
    child.once("spawn", () => { child.unref(); if (!waitForExit) resolve(); });
    if (waitForExit) child.once("close", (code) => code === 0 ? resolve() : reject(updateError("The system could not open the installer or releases page.", 502)));
  });
}

export async function upgradeDesktop({ appStateDir, checkFresh, platform = process.platform, arch = process.arch, fetchImpl = fetch, openImpl = openDesktopTarget, maxBytes = MAX_INSTALLER_BYTES, timeoutMs = DOWNLOAD_TIMEOUT_MS }) {
  const status = await checkFresh();
  if (!status.fresh || !status.daemonReachable || status.status !== "available" || status.checkError) {
    throw updateError(status.checkError || "Check for an available update while the local service is running.", 409);
  }
  const installer = verifiedInstaller(status.snapshot, { platform, arch });
  const updatesDir = join(appStateDir, "updates");
  await mkdir(updatesDir, { recursive: true, mode: 0o700 });
  const temporaryDir = await mkdtemp(join(updatesDir, ".download-"));
  const temporaryPath = join(temporaryDir, installer.name);
  const finalPath = join(updatesDir, installer.name);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await installerResponse(fetchImpl, installer.url, controller.signal);
    const expectedSize = Number(response.headers.get("content-length"));
    if (expectedSize > maxBytes) throw updateError("The installer exceeds the allowed download size.", 413);
    const file = await open(temporaryPath, "wx", 0o600);
    const hash = createHash("sha256");
    let bytes = 0;
    try {
      for await (const chunk of response.body) {
        controller.signal.throwIfAborted();
        bytes += chunk.byteLength;
        if (bytes > maxBytes) throw updateError("The installer exceeds the allowed download size.", 413);
        hash.update(chunk);
        await file.writeFile(chunk);
      }
      await file.sync();
    } finally { await file.close(); }
    if (!bytes || hash.digest("hex") !== installer.sha256) throw updateError("Installer verification failed. Nothing was opened; check for upgrades and try again.", 422);
    await rename(temporaryPath, finalPath);
    clearTimeout(timer);
    try { await openImpl(finalPath, { platform }); }
    catch (error) { throw updateError(`The verified installer was saved at ${finalPath}, but could not be opened: ${error.message || "system opener failed"}`, 502); }
    const message = installer.name.endsWith(".AppImage")
      ? "The verified AppImage is downloaded and its folder is open. Finish your work, then replace your current AppImage with this file."
      : "The verified installer is open. Finish your work, follow the installer instructions, then reopen Autohand Squad to use the upgrade.";
    return { version: installer.version, path: finalPath, name: installer.name, verified: true, opened: true, message };
  } catch (error) {
    if (controller.signal.aborted) throw updateError("Installer download timed out. Nothing was opened; try again.", 504);
    throw error;
  } finally { clearTimeout(timer); await rm(temporaryDir, { recursive: true, force: true }); }
}
