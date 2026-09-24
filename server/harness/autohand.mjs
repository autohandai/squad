// Autohand Code adapter. Execution stays on the existing SDK/CLI path inside
// server.mjs; this module owns the readiness contract so `/api/harnesses`
// reports every harness the same way.

import { compareVersions, findExecutable, parseVersion, probe, redactHome } from "./discovery.mjs";

export const id = "autohand";
export const label = "Autohand Code";
export const vendor = "Autohand";
export const executableName = "autohand";
export const minimumVersion = "0.7.0";

export const capabilities = {
  streaming: true,
  toolEvents: true,
  resume: false,
  interrupt: true,
  modelOverride: true,
  images: true,
  permissionModes: ["restricted", "interactive", "unrestricted", "external"],
};

export const setup = {
  install: "Bundled with Autohand Squad; reinstall the app if the bundled CLI is missing.",
  login: "autohand login",
  docs: "https://docs.autohand.ai/agent-sdk/typescript.html",
};

/**
 * `context` is injected by server.mjs: { bundledPath, authReady, version }.
 */
export async function detect({ explicitPath = "", context = {} } = {}) {
  const executable = findExecutable(executableName, { explicitPath }) || String(context.bundledPath || "");
  if (!executable) {
    return {
      status: "not-detected",
      version: "",
      executable: "",
      detail: "No bundled or system Autohand CLI was found.",
      setup: setup.install,
    };
  }
  let version = String(context.version || "").trim();
  if (!version || explicitPath) {
    const result = probe(executable, ["--version"], { timeoutMs: 10000 });
    version = result.ok ? parseVersion(result.stdout) : "";
    if (!result.ok) {
      return {
        status: "unsupported",
        version: "",
        executable: redactHome(executable),
        executablePath: executable,
        detail: `Autohand CLI did not report a version: ${result.error}`,
        setup: setup.install,
      };
    }
  }
  if (version && compareVersions(version, minimumVersion) < 0) {
    return {
      status: "unsupported",
      version,
      executable: redactHome(executable),
      executablePath: executable,
      detail: `Autohand CLI ${version} is older than ${minimumVersion}.`,
      setup: setup.install,
    };
  }
  if (context.authReady === false) {
    return {
      status: "setup-required",
      version,
      executable: redactHome(executable),
      executablePath: executable,
      detail: "Autohand is installed but not signed in.",
      setup: setup.login,
      signIn: { label: "Sign in with your Autohand account", alternative: "or add an Autohand AI API key in Settings" },
    };
  }
  return {
    status: "ready",
    version,
    executable: redactHome(executable),
    executablePath: executable,
    source: executable === context.bundledPath ? "bundled" : explicitPath ? "explicit" : "system",
    detail: context.accountEmail
      ? `Autohand ${version || ""} is signed in as ${context.accountEmail}.`.replace("  ", " ")
      : `Autohand ${version || ""} is ready.`.replace("  ", " "),
    setup: "",
    account: { signedIn: context.authReady !== false, email: context.accountEmail || "", label: context.accountEmail || "" },
  };
}
