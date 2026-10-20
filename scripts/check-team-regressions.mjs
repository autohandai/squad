#!/usr/bin/env node
// Related integration checks for changes to the internal Squad operations.
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const checks = [
  "check-member-profiles.mjs", "check-member-config.mjs", "check-prompt-stability.mjs",
  "check-queues.mjs", "check-run-channel-actions.mjs", "check-work-plans.mjs",
  "check-responders.mjs", "check-chats.mjs", "check-claude-sdk.mjs",
  "check-team-builder.mjs", "check-member-roster.mjs", "check-member-by-chat-browser.mjs",
];
const directory = resolve(".codex-artifacts/team-channels/regressions");
await mkdir(directory, { recursive: true });
const previous = process.argv.includes("--failed") ? JSON.parse(await readFile(resolve(directory, "results.json"), "utf8")) : [];
const selected = process.argv.includes("--failed") ? checks.filter(script => previous.some(result => result.script === script && result.code !== 0)) : checks;
const results = previous.filter(result => !selected.includes(result.script));
for (const script of selected) {
  const startedAt = new Date().toISOString();
  let output = "";
  const child = spawn(process.execPath, [resolve("scripts", script)], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, AUTOHAND_REQUIRE_BROWSER: "1" } });
  child.stdout.on("data", data => { output += data; });
  child.stderr.on("data", data => { output += data; });
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  await writeFile(resolve(directory, script + ".log"), output);
  results.push({ script, code, startedAt, finishedAt: new Date().toISOString() });
  await writeFile(resolve(directory, "results.json"), JSON.stringify(results, null, 2) + "\n");
  console.log(`${code === 0 ? "PASS" : "FAIL"} ${script}`);
  if (code !== 0) console.error(output.slice(-5000));
}
process.exitCode = results.some(result => result.code !== 0) ? 1 : 0;
