#!/usr/bin/env node
// Local desktop builds need a complete app-bundle signature, not just the
// arm64 linker's executable signature. Keep configured Developer ID signing;
// otherwise use Tauri's ad-hoc identity for local macOS builds.
//
// AUTOHAND_SQUAD_ICLOUD=1 also builds Squad iCloud.app (ADR-0255) and nests it
// at Contents/Helpers/, signed before Tauri signs the outer app. Unset, the
// build is exactly what it was before the iCloud route existed.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ICLOUD_HELPER, buildICloudHelper } from "./build-icloud-helper.mjs";

const nativeEnv = { ...process.env };
if (process.platform === "darwin" && !nativeEnv.APPLE_SIGNING_IDENTITY?.trim()) {
  nativeEnv.APPLE_SIGNING_IDENTITY = "-";
}
const args = process.argv.slice(2);
let helper = null;
if (process.platform === "darwin" && process.env.AUTOHAND_SQUAD_ICLOUD === "1") {
  helper = await buildICloudHelper({ signIdentity: process.env.AUTOHAND_CODESIGN_IDENTITY?.trim() || nativeEnv.APPLE_SIGNING_IDENTITY });
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
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
  if (code === 0 && helper) process.exitCode = checkNestedHelper(helper) ? 0 : 1;
});

/**
 * Tauri signs code it finds under Contents/Helpers itself, and whether that
 * keeps the helper's own entitlements was not known when this was written
 * (ADR-0255). So check the built app: the nested helper must still carry the
 * iCloud container when it was built entitled, and the whole app must verify.
 */
function checkNestedHelper(built) {
  const root = fileURLToPath(new URL("../src-tauri/target/", import.meta.url));
  const candidates = [join(root, "release/bundle/macos"), ...readdirSync(root).map((triple) => join(root, triple, "release/bundle/macos"))];
  const bundleDir = candidates.find((dir) => existsSync(join(dir, "Autohand Squad.app")));
  if (!bundleDir) { console.error("Built app not found; the nested iCloud helper was not checked."); return false; }
  const app = join(bundleDir, "Autohand Squad.app"), nested = join(app, "Contents", "Helpers", ICLOUD_HELPER.bundleName);
  if (!existsSync(nested)) { console.error(`${ICLOUD_HELPER.bundleName} is missing from Contents/Helpers.`); return false; }
  const entitlements = spawnSync("/usr/bin/codesign", ["-d", "--entitlements", ":-", nested], { encoding: "utf8" }).stdout || "";
  if (built.entitled && !entitlements.includes(ICLOUD_HELPER.container)) {
    console.error(`Tauri re-signed ${ICLOUD_HELPER.bundleName} without its iCloud entitlements.`);
    return false;
  }
  const verify = spawnSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", app], { encoding: "utf8" });
  if (verify.status !== 0) { console.error(`The app does not verify with the nested helper: ${verify.stderr.trim()}`); return false; }
  console.log(`Nested ${ICLOUD_HELPER.bundleName} verified (${built.entitled ? "iCloud entitlements intact" : "not entitled"}).`);
  return true;
}
