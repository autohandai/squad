// Native OS notifications from the bridge process. macOS uses
// terminal-notifier when it is on PATH (its -open flag makes the click open
// the app), else osascript's `display notification`; Windows uses a
// PowerShell toast (BurntToast when installed, else a NotifyIcon balloon);
// Linux uses notify-send. Nothing here throws: the result says whether the
// notification was handed to the OS and by which method. See ADR-0019.

import { spawn as nodeSpawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

export const APP_NAME = "Autohand Squad";
const TITLE_LIMIT = 120;
const BODY_LIMIT = 240;
const WAIT_LIMIT_MS = 10_000;

// Homebrew and MacPorts prefixes: the bridge started by the desktop shell
// often runs with a minimal PATH that omits them.
const EXTRA_MAC_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"];

/** Drop control characters, collapse whitespace, cap the length. */
export function sanitizeText(value, limit) {
  const text = String(value ?? "")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/** AppleScript string literal body: backslash and double quote are escaped. */
export function escapeAppleScript(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** PowerShell single-quoted literal body: only the quote itself is special. */
export function escapePowerShell(value) {
  return String(value ?? "").replace(/'/g, "''");
}

/** notify-send bodies are Pango markup on most daemons; neutralise it. */
export function escapeMarkup(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Only http(s) URLs are handed to the OS as click targets. */
export function safeUrl(value) {
  const text = String(value ?? "").trim();
  if (!/^https?:\/\/[^\s"'<>]+$/i.test(text)) return "";
  return text;
}

/** Whether an executable is reachable, on PATH or in the extra prefixes. */
export function commandOnPath(name, { env = process.env, platform = process.platform } = {}) {
  const dirs = String(env.PATH || env.Path || "").split(delimiter).filter(Boolean);
  if (platform === "darwin") dirs.push(...EXTRA_MAC_DIRS);
  const candidates = platform === "win32" ? [name, `${name}.exe`, `${name}.cmd`] : [name];
  for (const dir of dirs) {
    for (const candidate of candidates) {
      try {
        accessSync(join(dir, candidate), constants.X_OK);
        return true;
      } catch {
        // keep looking
      }
    }
  }
  return false;
}

function windowsScript({ title, body, url }) {
  const t = escapePowerShell(title);
  const b = escapePowerShell(body);
  const u = escapePowerShell(url);
  return [
    "$ErrorActionPreference = 'Stop'",
    `$t = '${t}'`,
    `$b = '${b}'`,
    `$u = '${u}'`,
    "if (Get-Module -ListAvailable -Name BurntToast) {",
    "  Import-Module BurntToast",
    "  if ($u) { New-BurntToastNotification -Text $t, $b -Button (New-BTButton -Content 'Open' -Arguments $u) } else { New-BurntToastNotification -Text $t, $b }",
    "  Write-Output 'burnttoast'",
    "} else {",
    "  Add-Type -AssemblyName System.Windows.Forms",
    "  Add-Type -AssemblyName System.Drawing",
    "  $n = New-Object System.Windows.Forms.NotifyIcon",
    "  $n.Icon = [System.Drawing.SystemIcons]::Information",
    "  $n.Visible = $true",
    "  $n.ShowBalloonTip(8000, $t, $b, [System.Windows.Forms.ToolTipIcon]::None)",
    "  Write-Output 'balloon'",
    "  Start-Sleep -Seconds 5",
    "  $n.Dispose()",
    "}",
  ].join("\n");
}

/** Pick the command for this platform. Exported so the check can inspect it. */
export function commandFor({ title, body, url: rawUrl }, { platform = process.platform, hasCommand = (name) => commandOnPath(name, { platform }) } = {}) {
  const appleTitle = title || APP_NAME;
  const url = safeUrl(rawUrl);
  if (platform === "darwin") {
    if (hasCommand("terminal-notifier")) {
      const args = ["-title", appleTitle, "-message", body || " ", "-group", "autohand-squad"];
      if (url) args.push("-open", url);
      return { method: "terminal-notifier", command: "terminal-notifier", args };
    }
    const script = `display notification "${escapeAppleScript(body)}" with title "${escapeAppleScript(appleTitle)}"`;
    return { method: "osascript", command: "osascript", args: ["-e", script] };
  }
  if (platform === "win32") {
    const command = hasCommand("pwsh") ? "pwsh" : "powershell";
    return {
      method: "powershell",
      command,
      args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", windowsScript({ title: appleTitle, body, url })],
    };
  }
  if (platform === "linux" || platform === "freebsd" || platform === "openbsd") {
    if (!hasCommand("notify-send")) return { method: "unsupported", command: "", args: [], error: "notify-send is not installed" };
    return {
      method: "notify-send",
      command: "notify-send",
      args: [`--app-name=${APP_NAME}`, "--expire-time=8000", appleTitle, escapeMarkup(body)],
    };
  }
  return { method: "unsupported", command: "", args: [], error: `no native notifier for ${platform}` };
}

function runCommand(spawn, command, args, { timeoutMs = WAIT_LIMIT_MS } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...result, stdout: stdout.trim() });
    };
    const timer = setTimeout(() => done({ ok: true, timedOut: true }), timeoutMs);
    let child;
    try {
      child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    } catch (error) {
      done({ ok: false, error: error?.message || String(error) });
      return;
    }
    if (!child || typeof child.on !== "function") {
      done({ ok: false, error: "spawn returned no process" });
      return;
    }
    child.stdout?.on?.("data", (chunk) => {
      stdout += String(chunk);
    });
    child.on("error", (error) => done({ ok: false, error: error?.message || String(error) }));
    child.on("close", (code) => done(code === 0 ? { ok: true } : { ok: false, error: `${command} exited with ${code}` }));
  });
}

/**
 * Post a native notification. Resolves `{ posted, method }` plus `error`
 * when it could not be posted. `spawn`, `platform` and `hasCommand` are
 * injectable so a check can dry-run every platform branch.
 */
export async function postNativeNotification(notification, options) {
  try {
    const { title, body, url } = notification && typeof notification === "object" ? notification : {};
    const { platform = process.platform, spawn = nodeSpawn, hasCommand, timeoutMs } = options && typeof options === "object" ? options : {};
    const payload = {
      title: sanitizeText(title, TITLE_LIMIT),
      body: sanitizeText(body, BODY_LIMIT),
      url: safeUrl(url),
    };
    const plan = commandFor(payload, { platform, hasCommand: hasCommand || ((name) => commandOnPath(name, { platform })) });
    if (!plan.command) return { posted: false, method: plan.method, error: plan.error || "unsupported platform" };
    const result = await runCommand(spawn, plan.command, plan.args, { timeoutMs });
    if (!result.ok) return { posted: false, method: plan.method, error: result.error };
    const method = plan.method === "powershell" && result.stdout ? `powershell-${result.stdout.split(/\s+/).pop()}` : plan.method;
    return { posted: true, method };
  } catch (error) {
    return { posted: false, method: "error", error: error?.message || String(error) };
  }
}
