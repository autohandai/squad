// Browser sign-in flows for the agent harnesses.
//
// Each harness owns its own account: Autohand (`autohand login`), Codex
// (`codex login`, ChatGPT OAuth) and Claude Code (`claude auth login`,
// claude.ai). The bridge never handles credentials itself: it starts the
// vendor's own login command, captures the URL it prints so the UI can show
// or reopen it, waits for the command to exit, and then re-checks readiness.

import { spawn } from "node:child_process";
import { guiSafeEnv } from "./discovery.mjs";

const URL_PATTERN = /https?:\/\/[^\s'"<>)\]]+/;
const CODE_PATTERN = /\b([A-Z0-9]{4}-[A-Z0-9]{4,}|[A-Z0-9]{8,9})\b/;

export const LOGIN_COMMANDS = {
  autohand: { args: ["login"], label: "Sign in with your Autohand account", opensBrowser: false },
  codex: { args: ["login"], label: "Sign in with ChatGPT", opensBrowser: true },
  claude: { args: ["auth", "login"], label: "Sign in with your Claude account", opensBrowser: true },
};

export class HarnessLoginManager {
  constructor({ openUrl } = {}) {
    this.flows = new Map();
    this.openUrl = openUrl || (() => {});
  }

  /** Start (or return the running) login flow for a harness. */
  start(id, { executable, args, env = {}, cwd, opensBrowser } = {}) {
    const preset = LOGIN_COMMANDS[id];
    if (!preset) throw new Error(`No sign-in flow for harness "${id}".`);
    if (!executable) throw new Error(`The ${id} CLI is not installed, so it cannot sign in.`);
    const command = { ...preset, args: Array.isArray(args) && args.length ? args : preset.args, opensBrowser: opensBrowser ?? preset.opensBrowser };
    const existing = this.flows.get(id);
    if (existing && existing.state === "running") return this.publicFlow(existing);

    const flow = {
      id,
      state: "running",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      url: "",
      code: "",
      output: "",
      exitCode: null,
      error: "",
      process: null,
      opened: false,
    };
    this.flows.set(id, flow);

    let child;
    try {
      child = spawn(executable, command.args, {
        cwd,
        env: guiSafeEnv({ ...env, BROWSER: process.env.BROWSER || "" }),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      flow.state = "failed";
      flow.error = error.message;
      flow.finishedAt = new Date().toISOString();
      return this.publicFlow(flow);
    }
    flow.process = child;
    const consume = (chunk) => {
      const text = String(chunk).replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
      flow.output = `${flow.output}${text}`.slice(-8000);
      if (!flow.url) {
        const match = text.match(URL_PATTERN);
        if (match) flow.url = match[0].replace(/[.,]+$/, "");
      }
      if (!flow.code) {
        const match = text.match(CODE_PATTERN);
        if (match && /code/i.test(text)) flow.code = match[1];
      }
      if (flow.url && !flow.opened && !command.opensBrowser) {
        flow.opened = true;
        try {
          this.openUrl(flow.url);
        } catch {
          // The URL is still shown in the UI.
        }
      }
    };
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", consume);
    child.stderr?.on("data", consume);
    child.on("error", (error) => {
      flow.state = "failed";
      flow.error = error.message;
      flow.finishedAt = new Date().toISOString();
    });
    child.on("close", (code) => {
      flow.exitCode = code;
      flow.finishedAt = new Date().toISOString();
      if (flow.state === "running") {
        flow.state = code === 0 ? "done" : "failed";
        if (code !== 0 && !flow.error) flow.error = `${id} login exited with code ${code}.`;
      }
      flow.process = null;
    });
    return this.publicFlow(flow);
  }

  status(id) {
    const flow = this.flows.get(id);
    return flow ? this.publicFlow(flow) : { id, state: "idle" };
  }

  cancel(id) {
    const flow = this.flows.get(id);
    if (!flow || flow.state !== "running") return false;
    flow.state = "cancelled";
    flow.finishedAt = new Date().toISOString();
    try {
      flow.process?.kill("SIGTERM");
    } catch {
      // Already gone.
    }
    return true;
  }

  cancelAll() {
    for (const id of this.flows.keys()) this.cancel(id);
  }

  publicFlow(flow) {
    return {
      id: flow.id,
      state: flow.state,
      label: LOGIN_COMMANDS[flow.id]?.label || "Sign in",
      startedAt: flow.startedAt,
      finishedAt: flow.finishedAt,
      url: flow.url,
      code: flow.code,
      error: flow.error,
      exitCode: flow.exitCode,
      outputTail: flow.output.slice(-600),
    };
  }
}
