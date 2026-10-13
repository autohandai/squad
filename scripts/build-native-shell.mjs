#!/usr/bin/env node
// Local desktop builds need a complete app-bundle signature, not just the
// arm64 linker's executable signature. Keep configured Developer ID signing;
// otherwise use Tauri's ad-hoc identity for local macOS builds.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const nativeEnv = { ...process.env };
if (process.platform === "darwin" && !nativeEnv.APPLE_SIGNING_IDENTITY?.trim()) {
  nativeEnv.APPLE_SIGNING_IDENTITY = "-";
}
const cli = fileURLToPath(new URL("../node_modules/@tauri-apps/cli/tauri.js", import.meta.url));
const child = spawn(process.execPath, [cli, "build", ...process.argv.slice(2)], {
  env: nativeEnv,
  stdio: "inherit",
});
child.once("error", (error) => {
  console.error(`Could not build Squad's native app: ${error.message}`);
  process.exitCode = 1;
});
child.once("exit", (code) => { process.exitCode = code ?? 1; });
