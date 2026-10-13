// "Show in Finder" for the data folder (ADR-0105). Fixed executables and
// argument arrays only, never a shell and never a path supplied by the
// request: the route resolves the folder itself and only passes it here.

import { spawn } from "node:child_process";
import { posix, win32 } from "node:path";

export function revealCommand(target, platform = process.platform) {
  const absolute = platform === "win32" ? win32.isAbsolute(String(target || "")) : posix.isAbsolute(String(target || ""));
  if (!absolute) throw new Error("Only an absolute folder path can be revealed.");
  if (platform === "darwin") return { executable: "open", args: [target] };
  if (platform === "win32") return { executable: "explorer.exe", args: [target] };
  if (platform === "linux") return { executable: "xdg-open", args: [target] };
  throw new Error("Revealing folders is not supported on this platform.");
}

export function revealActionLabel(platform = process.platform) {
  if (platform === "darwin") return "Show in Finder";
  if (platform === "win32") return "Show in Explorer";
  return "Show folder";
}

export async function revealFolder(target, { platform = process.platform, spawnImpl = spawn } = {}) {
  const { executable, args } = revealCommand(target, platform);
  await new Promise((resolve, reject) => {
    const child = spawnImpl(executable, args, { shell: false, stdio: "ignore", detached: true, windowsHide: true });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
  return { opened: true, path: target, executable };
}
