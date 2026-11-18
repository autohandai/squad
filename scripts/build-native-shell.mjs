#!/usr/bin/env node
// Local desktop builds need a complete app-bundle signature, not just the
// arm64 linker's executable signature. Keep configured Developer ID signing;
// otherwise use Tauri's ad-hoc identity for local macOS builds.
//
// AUTOHAND_SQUAD_ICLOUD=1 also builds Squad iCloud.app (ADR-0255) and nests it
// at Contents/Helpers/, signed before Tauri signs the outer app. Unset, the
// build is exactly what it was before the iCloud route existed.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ICLOUD_HELPER, buildICloudHelper } from "./build-icloud-helper.mjs";

const nativeEnv = { ...process.env };
if (process.platform === "darwin" && !nativeEnv.APPLE_SIGNING_IDENTITY?.trim()) {
  nativeEnv.APPLE_SIGNING_IDENTITY = "-";
}
const args = process.argv.slice(2);
if (process.platform === "darwin" && process.env.AUTOHAND_SQUAD_ICLOUD === "1") {
  const helper = await buildICloudHelper({ signIdentity: process.env.AUTOHAND_CODESIGN_IDENTITY?.trim() || nativeEnv.APPLE_SIGNING_IDENTITY });
  console.log(`Nesting ${ICLOUD_HELPER.bundleName} (${helper.entitled ? "iCloud entitled" : "not entitled"}, ${helper.signing}).`);
  // Paths are relative to src-tauri. Tauri copies the signed bundle as is and
  // then signs the outer app, whose seal covers it (the ADR-0248 order).
  args.push("--config", JSON.stringify({ bundle: { macOS: { files: { [`Helpers/${ICLOUD_HELPER.bundleName}`]: `helpers/${ICLOUD_HELPER.bundleName}` } } } }));
}
const cli = fileURLToPath(new URL("../node_modules/@tauri-apps/cli/tauri.js", import.meta.url));
const child = spawn(process.execPath, [cli, "build", ...args], {
  env: nativeEnv,
  stdio: "inherit",
});
child.once("error", (error) => {
  console.error(`Could not build Squad's native app: ${error.message}`);
  process.exitCode = 1;
});
child.once("exit", (code) => { process.exitCode = code ?? 1; });
