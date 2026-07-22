import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { appendFile, copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { arch, homedir, platform as osPlatform, release as osRelease, tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import process from "node:process";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const item = process.argv[index];
  if (item.startsWith("--")) {
    const next = process.argv[index + 1];
    args.set(item.slice(2), next && !next.startsWith("--") ? next : true);
  }
}

const isDev = args.get("dev") === true;
const host = String(args.get("host") || "127.0.0.1");
const port = Number(args.get("port") || 19821);
const rootDir = process.cwd();
const isPackagedRuntime = Boolean(process.env.AUTOHAND_SQUAD_APP_STATE_DIR);
const packageMetadata = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
const distDir = join(rootDir, "dist");
const homeDir = resolve(homedir());
const squadMemberIdPrefix = "asq_";
const legacySquadMemberIdPrefixes = ["wk_"];
const squadWorkspaceRoot = join(homeDir, ".autohandsquad");
const legacySquadWorkspaceRoots = [join(homeDir, ".qoderwake"), join(homeDir, ".autohand-squad")];
const appStateDir = process.env.AUTOHAND_SQUAD_APP_STATE_DIR
  ? resolve(process.env.AUTOHAND_SQUAD_APP_STATE_DIR)
  : join(rootDir, ".autohand");
const isolatedAgentsDir = join(appStateDir, "agents");
const runLogsDir = join(appStateDir, "run-logs");
const providerSettingsPath = join(appStateDir, "provider-settings.json");
const maxRunLogLines = 600;
const childTerminationGraceMs = 2500;
const autohandStateRoot = process.env.AUTOHAND_HOME
  ? resolve(process.env.AUTOHAND_HOME)
  : join(homeDir, ".autohand");
const userConfigPath = process.env.AUTOHAND_USER_CONFIG_PATH
  ? resolve(process.env.AUTOHAND_USER_CONFIG_PATH)
  : join(autohandStateRoot, "config.json");
const squadStateDir = process.env.AUTOHAND_SQUAD_HOME
  ? resolve(process.env.AUTOHAND_SQUAD_HOME)
  : join(autohandStateRoot, "squad");
const squadConfigPath = join(squadStateDir, "config.json");
const liveStatusPath = join(squadStateDir, "web-status.json");
const memoryInboxPath = join(squadStateDir, "memory-inbox.json");
const channelsStatePath = join(squadStateDir, "channels.json");
const squadDeviceIdPath = join(squadStateDir, "device-id");
const feedbackBackupDir = join(squadStateDir, "feedback");
const feedbackApiBaseUrl = (process.env.AUTOHAND_SQUAD_API_BASE_URL || process.env.AUTOHAND_API_URL || "https://api.autohand.ai").replace(/\/+$/, "");
const runs = new Map();
let server = null;
let shuttingDown = false;
const skilledBaseUrl = "https://skilled.autohand.ai";
const skilledCatalogUrl = `${skilledBaseUrl}/skills-index.json`;
const defaultSkillsRepo = "autohandai/community-skills";
const localCommunitySkillsDir = process.env.AUTOHAND_SKILLS_REPO_DIR
  ? resolve(process.env.AUTOHAND_SKILLS_REPO_DIR)
  : resolve(rootDir, "../../..", "community-skills");
const localAgentSdkEntry = process.env.AUTOHAND_AGENT_SDK_ENTRY
  ? resolve(process.env.AUTOHAND_AGENT_SDK_ENTRY)
  : resolve(rootDir, "../../../agentsdk/tin-wrapper/typescript/dist/index.js");
const skillCatalogCache = { loadedAt: 0, data: null };
const sdkImportCache = { promise: null };
const projectLimitUpperBound = 5;
const maxProjectsPerMember = normalizeProjectLimit(process.env.AUTOHAND_SQUAD_MAX_PROJECTS_PER_MEMBER);
const handoffRetryMode = normalizeHandoffRetryMode(process.env.AUTOHAND_SQUAD_HANDOFF_RETRY_MODE);
const providerDefinitions = [
  { id: "openrouter", label: "OpenRouter", kind: "cloud", baseUrl: "https://openrouter.ai/api/v1", model: "openrouter/auto", requiresApiKey: true },
  { id: "openai", label: "OpenAI", kind: "cloud", baseUrl: "https://api.openai.com/v1", model: "gpt-5", requiresApiKey: true },
  { id: "ollama", label: "Ollama", kind: "local", baseUrl: "http://127.0.0.1:11434", model: "llama3.1", requiresApiKey: false },
  { id: "bedrock", label: "Amazon Bedrock", kind: "cloud", baseUrl: "", model: "", requiresApiKey: false },
  { id: "llmgateway", label: "LLM Gateway", kind: "cloud", baseUrl: "", model: "", requiresApiKey: true },
  { id: "deepseek", label: "DeepSeek", kind: "cloud", baseUrl: "https://api.deepseek.com", model: "deepseek-chat", requiresApiKey: true },
  { id: "zai", label: "Z.ai", kind: "cloud", baseUrl: "https://api.z.ai/api/paas/v4", model: "glm-4.5", requiresApiKey: true },
  { id: "nvidia", label: "NVIDIA", kind: "cloud", baseUrl: "https://integrate.api.nvidia.com/v1", model: "", requiresApiKey: true },
  { id: "cerebras", label: "Cerebras", kind: "cloud", baseUrl: "https://api.cerebras.ai/v1", model: "", requiresApiKey: true },
];
const providerDefinitionMap = new Map(providerDefinitions.map((provider) => [provider.id, provider]));
const skillAliases = new Map(
  Object.entries({
    "a11y-check": "web-design-guidelines",
    "accessibility-audit": "web-design-guidelines",
    "acceptance-criteria": "task-planning",
    "agent-workflows": "agentic-development-principles",
    "api-contracts": "api-design-restful",
    "api-integration": "api-design-restful",
    "api-reference": "api-documentation",
    "app-store-readiness": "swiftui-expert-skill",
    "blocker-triage": "task-planning",
    "browser-harness": "agent-browser",
    "browser-proof": "agent-browser",
    "change-validation-planner": "testing-strategies",
    "ci-cd": "deployment-automation",
    "compliance-controls": "security-best-practices",
    "content-brief": "content-strategy",
    "dashboard-audit": "looker-studio-bigquery",
    "data-modeling": "database-schema-design",
    "delivery-health": "task-estimation",
    "design-system": "react-component-architecture",
    "design-systems": "tailwind-ui-patterns",
    "developer-docs": "documentation-writing",
    "developer-experience": "cli-tool-development",
    "device-compatibility": "frontend-responsive-design-standards",
    "environment-config": "environment-setup",
    "evaluation-harness": "agent-evaluation",
    "frontend-backend-contracts": "api-design-restful",
    "github-developer-communication": "git-workflow-mastery",
    "insight-summary": "data-analysis",
    "interaction-design": "ui-ux-pro-max",
    "journey-mapping": "ui-ux-pro-max",
    "metric-framing": "data-analysis",
    "migrations": "database-schema-design",
    "mobile-ui": "swiftui-expert-skill",
    "model-integration": "microsoft-foundry",
    "offline-sync": "vercel-react-native-skills",
    "positioning": "product-marketing-context",
    "prioritization": "brainstorming",
    "product-slices": "writing-plans",
    "prompt-systems": "agentic-workflow",
    "prototype-review": "frontend-design",
    "regression-checks": "testing-strategies",
    "release-health": "monitoring-observability",
    "release-notes": "changelog-maintenance",
    "requirements": "writing-plans",
    "responsive": "frontend-responsive-design-standards",
    "responsive-design": "frontend-responsive-design-standards",
    "retrospectives": "brainstorming",
    "risk-review": "documentation-writing",
    "runbooks": "technical-writing",
    "runtime-standards": "environment-setup",
    "secure-code-review": "security-best-practices",
    "secrets-audit": "implementing-secrets-scanning-in-ci-cd",
    "service-reliability": "monitoring-observability",
    "service-templates": "documentation-writing",
    "sprint-planning": "task-planning",
    "sql-review": "database-schema-design",
    "system-design": "api-design-restful",
    "test-case-template": "testing-strategies",
    "threat-modeling": "performing-threat-modeling-with-owasp-threat-dragon",
    "tooling-automation": "workflow-automation",
    "trend-review": "seo-audit",
    "tutorials": "user-guide-writing",
    "workflow-design": "workflow-automation",
  })
);

const vite = isDev
  ? await import("vite").then(({ createServer: createViteServer }) => createViteServer({
      root: rootDir,
      appType: "spa",
      server: {
        middlewareMode: true,
        hmr: {
          host,
          port: Number(args.get("hmr-port") || port + 100),
        },
      },
    }))
  : null;

function commandOutput(command, commandArgs = []) {
  const result = spawnSync(command, commandArgs, {
    cwd: rootDir,
    encoding: "utf8",
    timeout: 5000,
    windowsHide: true,
  });
  return result.status === 0 ? result.stdout.trim() : "";
}

class SdkBridgeStartupError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "SdkBridgeStartupError";
    this.cause = cause;
  }
}

// Raised before spawning the Autohand CLI when the resolved auth token is
// missing or expired. The CLI runs an interactive `ensureAuthenticated` before
// dispatching `--mode rpc`, and on a non-TTY pipe that drops into a *blocking*
// device-login that prints to stdout (corrupting the JSON-RPC channel) and never
// returns — which the SDK surfaces only as an endless "waiting for the provider"
// stall. Failing fast here turns that silent hang into an actionable message.
class AutohandAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = "AutohandAuthError";
  }
}

// Raised by the first-event watchdog when the CLI accepts the prompt but never
// produces a first event (it exited, rejected auth with an unmatched JSON-RPC
// error, or never reached the provider). Distinct from SdkBridgeStartupError so
// it surfaces to the user instead of triggering a futile CLI fallback that would
// hit the same problem.
class AutohandStallError extends Error {
  constructor(message) {
    super(message);
    this.name = "AutohandStallError";
  }
}

class ChatRuntimeError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ChatRuntimeError";
    this.details = details;
  }
}

function childHasExited(child) {
  return !child || child.exitCode !== null || child.signalCode !== null;
}

function signalChildProcess(child, signal) {
  if (childHasExited(child)) return false;
  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch {
      // Older children may not have been spawned as process-group leaders.
      // Fall back to signaling the direct child below.
    }
  }
  try {
    return child.kill(signal);
  } catch {
    return false;
  }
}

function terminateChildProcess(child, { forceAfterMs = childTerminationGraceMs, onForce } = {}) {
  if (childHasExited(child)) return;
  signalChildProcess(child, "SIGTERM");
  const forceTimer = setTimeout(() => {
    if (childHasExited(child)) return;
    onForce?.();
    signalChildProcess(child, "SIGKILL");
  }, forceAfterMs);
  child.once("close", () => clearTimeout(forceTimer));
}

async function loadAgentSdk() {
  if (!sdkImportCache.promise) {
    sdkImportCache.promise = (async () => {
      try {
        return await import("@autohandai/agent-sdk");
      } catch (packageError) {
        if (!existsSync(localAgentSdkEntry)) {
          throw packageError;
        }
        return import(pathToFileURL(localAgentSdkEntry).href);
      }
    })();
  }
  return sdkImportCache.promise;
}

const cliHelpCache = { text: null };

function bundledAutohandCliName() {
  return new Map([
    ["darwin/arm64", "autohand-macos-arm64"],
    ["darwin/x64", "autohand-macos-x64"],
    ["linux/x64", "autohand-linux-x64"],
    ["win32/x64", "autohand-windows-x64.exe"],
  ]).get(`${osPlatform()}/${arch()}`) || "";
}

function resolveAutohandBinary() {
  const explicit = String(process.env.AUTOHAND_SQUAD_AUTOHAND_BIN || "").trim();
  if (explicit && existsSync(explicit)) return explicit;

  const bundledName = bundledAutohandCliName();
  if (bundledName) {
    const bundled = join(
      rootDir,
      "node_modules",
      "@autohandai",
      "agent-sdk",
      "cli",
      bundledName,
    );
    if (existsSync(bundled)) return bundled;
  }

  const finder = osPlatform() === "win32" ? "where" : "which";
  return commandOutput(finder, ["autohand"])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || "";
}

function autohandHelpText() {
  if (cliHelpCache.text === null) {
    const autohandPath = resolveAutohandBinary();
    cliHelpCache.text = autohandPath ? commandOutput(autohandPath, ["--help"]) : "";
  }
  return cliHelpCache.text;
}

function autohandSupportsFlag(flag) {
  return autohandHelpText().includes(flag);
}

function getRuntime() {
  const autohandPath = resolveAutohandBinary();
  const version = autohandPath ? commandOutput(autohandPath, ["--version"]) : "";
  return {
    autohandPath,
    version,
    squadVersion: packageMetadata.version || "0.0.0",
    available: Boolean(autohandPath),
    defaultWorkspace: getDefaultWorkspace(),
    workspaceRoot: homeDir,
    squadWorkspaceRoot,
    legacySquadWorkspaceRoots,
    limits: {
      maxProjectsPerMember,
    },
    features: {
      workspaceFileMentions: true,
    },
    handoffs: {
      recommendationConfirmationRequired: false,
      retryMode: handoffRetryMode,
    },
    account: readRuntimeAccount(),
    serverStartedAt,
  };
}

const serverStartedAt = new Date().toISOString();

function readJsonFileSync(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function authEmail(auth) {
  if (!auth || typeof auth !== "object") return "";
  return String(auth.email || auth.accountEmail || auth.user?.email || "").trim();
}

function readRuntimeAccount() {
  const squadConfig = readJsonFileSync(squadConfigPath);
  const userAuth = readAutohandAuth(userConfigPath);
  const squadEmail = String(squadConfig?.accountEmail || "").trim();
  const userEmail = authEmail(userAuth);
  const squadSignedIn = Boolean(String(squadConfig?.apiAuthToken || "").trim());
  const userSignedIn = autohandAuthUsable(userAuth);
  return {
    signedIn: squadSignedIn || userSignedIn,
    email: squadEmail || userEmail,
    source: squadSignedIn ? "squad-runtime" : userSignedIn ? "autohand-cli" : "none",
  };
}

function executableName(binaryName) {
  return osPlatform() === "win32" ? `${binaryName}.exe` : binaryName;
}

function locateSquadTrayBinary() {
  const explicit = process.env.AUTOHAND_SQUAD_TRAY;
  if (explicit && existsSync(explicit)) return explicit;
  const name = executableName("autohand-squad-tray");
  const candidates = [
    join(squadStateDir, "bin", name),
    join(rootDir, "daemon", "target", "debug", name),
    join(rootDir, "daemon", "target", "release", name),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || "";
}

function requestSquadBrowserLogin() {
  const trayBinary = locateSquadTrayBinary();
  if (!trayBinary) {
    throw new Error("Autohand Squad tray binary was not found. Use the menu bar Login action or rebuild the runtime, then retry.");
  }

  const child = spawn(trayBinary, ["--action", "login"], {
    cwd: rootDir,
    stdio: "ignore",
    windowsHide: true,
    env: {
      ...process.env,
      AUTOHAND_SQUAD_HOME: squadStateDir,
    },
  });
  return {
    started: true,
    message: "Opened the existing Autohand Squad browser login flow.",
  };
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "connection": "close",
  });
  res.end(body);
}

function startEventStream(res) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store, no-transform",
    "connection": "keep-alive",
    "x-accel-buffering": "no",
  });
  res.write(": connected\n\n");
  return {
    send(event, data = {}) {
      if (res.destroyed || res.writableEnded) return;
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    },
    end() {
      if (!res.destroyed && !res.writableEnded) {
        res.end();
      }
    },
  };
}

function readBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxBytes) {
        reject(new Error("request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("invalid json"));
      }
    });
    req.on("error", reject);
  });
}

function isInsideHome(path) {
  const diff = relative(homeDir, path);
  return diff === "" || (!diff.startsWith("..") && !isAbsolute(diff));
}

function isHomeDir(path) {
  return resolve(path) === homeDir;
}

function isPathInside(path, root) {
  const diff = relative(root, path);
  return diff === "" || (!diff.startsWith("..") && !isAbsolute(diff));
}

function isRunnableWorkspace(path) {
  return isInsideHome(path) && !isHomeDir(path);
}

function normalizeSquadWorkspacePath(path) {
  const resolvedPath = resolve(path);
  for (const legacyRoot of legacySquadWorkspaceRoots) {
    if (isPathInside(resolvedPath, legacyRoot)) {
      return join(squadWorkspaceRoot, relative(legacyRoot, resolvedPath));
    }
  }
  return resolvedPath;
}

function isSquadManagedWorkspace(path) {
  if (!isPathInside(path, squadWorkspaceRoot)) return false;
  const parts = relative(squadWorkspaceRoot, path).split(/[/\\]+/).filter(Boolean);
  return parts[0] === "data" && parts[1] === "workers" && Boolean(parts[2]);
}

async function ensureSquadManagedWorkspace(path) {
  if (isSquadManagedWorkspace(path) && !existsSync(path)) {
    await mkdir(path, { recursive: true });
  }
}

function getDefaultWorkspace() {
  const candidates = [
    ...(isPackagedRuntime ? [] : [rootDir]),
    join(homeDir, "Documents", "autohand"),
    join(homeDir, "Documents"),
  ];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isDirectory() && isRunnableWorkspace(candidate)) || "";
}

async function cleanWorkspace(workspace) {
  if (typeof workspace !== "string" || !workspace.trim()) {
    throw new Error("workspace is required; choose a local project folder or git repo");
  }
  const value = workspace.trim();
  const requested = resolve(value.replace(/\/+$/, "") || value);
  const resolved = normalizeSquadWorkspacePath(requested);
  await ensureSquadManagedWorkspace(resolved);
  if (!isInsideHome(resolved)) {
    throw new Error("workspace must be a folder inside the user directory");
  }
  if (isHomeDir(resolved)) {
    throw new Error("the home directory is blocked by Autohand CLI; choose a project folder or git repo");
  }
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    throw new Error("workspace folder does not exist");
  }
  return resolved;
}

const ignoredWorkspaceDirs = new Set([
  ".cache",
  ".git",
  ".local",
  ".npm",
  ".pnpm-store",
  "Applications",
  "cachedir_joblib",
  "Library",
  "Movies",
  "Music",
  "node_modules",
  "dist",
  "build",
  "target",
  "vendor",
]);

const ignoredFileDirs = new Set([
  ...ignoredWorkspaceDirs,
  ".git",
  ".turbo",
  ".vite",
  "coverage",
  "dist",
  "node_modules",
]);

const fileSuggestionLimit = 12;

const workspaceMarkers = [
  ".git",
  "AGENTS.md",
  "bun.lock",
  "Cargo.toml",
  "Gemfile",
  "go.mod",
  "package.json",
  "Package.swift",
  "pnpm-workspace.yaml",
  "pyproject.toml",
  "tsconfig.json",
  "vite.config.js",
];

const priorityWorkspaceDirs = new Set([
  "apps",
  "autohand",
  "Code",
  "code",
  "Developer",
  "dev",
  "Documents",
  "packages",
  "Projects",
  "projects",
  "prototypes",
  "repos",
  "web",
  "workspace",
  "workspaces",
]);

function shouldSkipWorkspaceDir(name) {
  return name.startsWith(".") || ignoredWorkspaceDirs.has(name);
}

async function listWorkspaces() {
  const maxDepth = 7;
  const maxScannedDirs = 6000;
  const queue = [{ path: homeDir, depth: 0 }];
  const seen = new Set([homeDir]);
  const byPath = new Map();
  let scannedDirs = 0;

  function addWorkspace(path, depth, label = relative(homeDir, path), kind = "folder") {
    if (!isRunnableWorkspace(path) || byPath.has(path)) return;
    byPath.set(path, {
      label,
      name: basename(path),
      path,
      depth,
      kind,
      launchable: true,
    });
  }

  if (!isPackagedRuntime && isRunnableWorkspace(rootDir)) {
    addWorkspace(rootDir, relative(homeDir, rootDir).split(/[/\\]/).length, relative(homeDir, rootDir), "current");
  }

  while (queue.length && scannedDirs < maxScannedDirs) {
    const current = queue.shift();
    scannedDirs += 1;
    let entries = [];
    try {
      entries = await readdir(current.path, { withFileTypes: true });
    } catch {
      continue;
    }

    const entryNames = new Set(entries.map((entry) => entry.name));
    const relPath = relative(homeDir, current.path);
    const isProjectFolder =
      current.depth <= 2 ||
      workspaceMarkers.some((marker) => entryNames.has(marker)) ||
      entries.some((entry) => entry.name.endsWith(".xcodeproj") || entry.name.endsWith(".xcworkspace"));

    if (current.depth > 0 && isProjectFolder) {
      const kind = entryNames.has(".git") ? "git repo" : workspaceMarkers.some((marker) => entryNames.has(marker)) ? "project" : "folder";
      addWorkspace(current.path, current.depth, relPath, kind);
    }

    const dirs = entries
      .filter((entry) => entry.isDirectory() && !shouldSkipWorkspaceDir(entry.name))
      .sort((a, b) => {
        const priorityDelta =
          Number(priorityWorkspaceDirs.has(b.name)) - Number(priorityWorkspaceDirs.has(a.name));
        return priorityDelta || a.name.localeCompare(b.name);
      });

    for (const entry of dirs) {
      const fullPath = join(current.path, entry.name);
      if (seen.has(fullPath)) continue;
      seen.add(fullPath);
      if (current.depth + 1 <= maxDepth) {
        queue.push({ path: fullPath, depth: current.depth + 1 });
      }
    }
  }

  const currentWorkspace = isPackagedRuntime ? null : byPath.get(rootDir);
  const sorted = Array.from(byPath.values()).sort((a, b) => a.label.localeCompare(b.label));
  return currentWorkspace
    ? [currentWorkspace, ...sorted.filter((workspace) => workspace.path !== rootDir)]
    : sorted;
}

async function listWorkspaceFiles(workspace, query = "") {
  const resolvedWorkspace = await cleanWorkspace(workspace);
  const normalizedQuery = String(query || "").trim().toLowerCase().slice(0, 120);
  const gitFiles = listGitWorkspaceFiles(resolvedWorkspace);
  const files = gitFiles || await listFallbackWorkspaceFiles(resolvedWorkspace);
  return files
    .filter((file) => {
      const normalizedFile = file.toLowerCase();
      return !normalizedQuery || normalizedFile.includes(normalizedQuery);
    })
    .slice(0, fileSuggestionLimit)
    .map((file) => ({
      type: "file",
      path: file,
      label: file,
      detail: "Workspace file",
    }));
}

function listGitWorkspaceFiles(workspace) {
  const rootResult = spawnSync("git", ["-C", workspace, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
    timeout: 2000,
  });
  if (rootResult.status !== 0) return null;

  const repoRoot = rootResult.stdout.trim();
  if (!repoRoot || !isPathInside(workspace, repoRoot)) return null;

  const filesResult = spawnSync("git", ["-C", repoRoot, "ls-files", "-co", "--exclude-standard"], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: 4000,
  });
  if (filesResult.status !== 0) return null;

  const workspacePrefix = toPosixPath(relative(repoRoot, workspace));
  const prefix = workspacePrefix && workspacePrefix !== "." ? `${workspacePrefix}/` : "";
  return filesResult.stdout
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter(Boolean)
    .filter((file) => !prefix || file.startsWith(prefix))
    .map((file) => (prefix ? file.slice(prefix.length) : file))
    .filter((file) => file && !file.split("/").some((part) => ignoredFileDirs.has(part)))
    .sort((a, b) => a.localeCompare(b));
}

async function listFallbackWorkspaceFiles(workspace) {
  const ignoreRules = await readRootGitignoreRules(workspace);
  const queue = [{ path: workspace, depth: 0 }];
  const files = [];
  let scannedDirs = 0;

  while (queue.length && scannedDirs < 2000 && files.length < 800) {
    const current = queue.shift();
    scannedDirs += 1;
    let entries = [];
    try {
      entries = await readdir(current.path, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const fullPath = join(current.path, entry.name);
      const relativePath = toPosixPath(relative(workspace, fullPath));
      if (!relativePath || shouldIgnoreWorkspaceFile(relativePath, entry.isDirectory(), ignoreRules)) continue;

      if (entry.isDirectory()) {
        if (current.depth < 6) queue.push({ path: fullPath, depth: current.depth + 1 });
        continue;
      }
      if (entry.isFile()) files.push(relativePath);
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

async function readRootGitignoreRules(workspace) {
  try {
    const content = await readFile(join(workspace, ".gitignore"), "utf8");
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => ({
        negated: line.startsWith("!"),
        pattern: line.replace(/^!/, "").replace(/^\/+/, ""),
      }))
      .filter((rule) => rule.pattern);
  } catch {
    return [];
  }
}

function shouldIgnoreWorkspaceFile(relativePath, isDirectory, rules) {
  const parts = relativePath.split("/");
  if (parts.some((part) => ignoredFileDirs.has(part))) return true;

  let ignored = false;
  for (const rule of rules) {
    if (matchesGitignoreRule(relativePath, isDirectory, rule.pattern)) {
      ignored = !rule.negated;
    }
  }
  return ignored;
}

function matchesGitignoreRule(relativePath, isDirectory, pattern) {
  const normalized = pattern.replace(/\\/g, "/");
  if (!normalized) return false;

  if (normalized.endsWith("/")) {
    const dirPattern = normalized.slice(0, -1);
    return isDirectory
      ? relativePath === dirPattern || relativePath.startsWith(`${dirPattern}/`) || relativePath.split("/").includes(dirPattern)
      : relativePath.startsWith(`${dirPattern}/`) || relativePath.split("/").includes(dirPattern);
  }

  if (!normalized.includes("/") && !normalized.includes("*")) {
    return relativePath.split("/").includes(normalized) || relativePath.endsWith(`/${normalized}`);
  }

  if (!normalized.includes("*")) {
    return relativePath === normalized || relativePath.startsWith(`${normalized}/`);
  }

  const escaped = normalized
    .split("*")
    .map((part) => part.replace(/[|\\{}()[\]^$+?.]/g, "\\$&"))
    .join(".*");
  return new RegExp(`(^|/)${escaped}($|/)`).test(relativePath);
}

function toPosixPath(value) {
  return String(value || "").replace(/\\/g, "/");
}

function sanitizeAgentId(input) {
  const value = String(input || "default").trim().toLowerCase();
  const safe = value.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  const legacyPrefix = legacySquadMemberIdPrefixes.find((prefix) => safe.startsWith(prefix));
  return legacyPrefix ? `${squadMemberIdPrefix}${safe.slice(legacyPrefix.length)}` : safe || "default";
}

function sanitizeSkillId(input) {
  const raw = String(input || "")
    .trim()
    .replace(/^@?skill\//i, "")
    .replace(/^https:\/\/skilled\.autohand\.ai\/skill\//i, "")
    .toLowerCase();
  const safe = raw.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return skillAliases.get(safe) || safe;
}

function uniqueSkillIds(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const skills = [];
  for (const item of input) {
    const id = sanitizeSkillId(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    skills.push(id);
  }
  return skills;
}

function safePathSegment(input) {
  const value = String(input || "").trim();
  if (!value || value.includes("\0") || isAbsolute(value)) return "";
  const normalized = normalize(value).replace(/^[/\\]+/, "");
  if (normalized === "." || normalized.startsWith("..") || normalized.split(/[/\\]/).includes("..")) {
    return "";
  }
  return normalized;
}

function safeJoin(basePath, relativePath) {
  const safeRelativePath = safePathSegment(relativePath);
  if (!safeRelativePath) {
    throw new Error(`unsafe skill path: ${relativePath}`);
  }
  const base = resolve(basePath);
  const target = resolve(base, safeRelativePath);
  const diff = relative(base, target);
  if (diff.startsWith("..") || isAbsolute(diff)) {
    throw new Error(`unsafe skill path: ${relativePath}`);
  }
  return target;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readJsonFile(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function loadSkillCatalog() {
  const now = Date.now();
  if (skillCatalogCache.data && now - skillCatalogCache.loadedAt < 5 * 60 * 1000) {
    return skillCatalogCache.data;
  }

  const catalogCandidates = [
    async () => {
      const response = await fetchWithTimeout(skilledCatalogUrl, {}, 10000);
      if (!response.ok) throw new Error(`catalog returned ${response.status}`);
      return response.json();
    },
    async () => readJsonFile(join(localCommunitySkillsDir, "registry.json")),
    async () => {
      const response = await fetchWithTimeout(
        "https://raw.githubusercontent.com/autohandai/community-skills/HEAD/registry.json",
        {},
        10000
      );
      if (!response.ok) throw new Error(`registry returned ${response.status}`);
      return response.json();
    },
  ];

  for (const loadCatalog of catalogCandidates) {
    try {
      const catalog = await loadCatalog();
      if (catalog && Array.isArray(catalog.skills)) {
        skillCatalogCache.data = catalog;
        skillCatalogCache.loadedAt = now;
        return catalog;
      }
    } catch {
      // Try the next catalog source; the local clone keeps agent creation usable offline.
    }
  }

  return { skills: [] };
}

function normalizeSkillFileList(skill) {
  const files = Array.isArray(skill.files) && skill.files.length ? skill.files : ["SKILL.md"];
  const safeFiles = files.map(safePathSegment).filter(Boolean);
  return safeFiles.includes("SKILL.md") ? safeFiles : ["SKILL.md", ...safeFiles];
}

async function readLocalSkillFiles(skill) {
  if (!existsSync(localCommunitySkillsDir)) return null;
  const directory = safePathSegment(skill.directory || skill.id);
  if (!directory) return null;
  const skillRoot = safeJoin(localCommunitySkillsDir, directory);
  if (!existsSync(skillRoot)) return null;

  const files = new Map();
  for (const file of normalizeSkillFileList(skill)) {
    const filePath = safeJoin(skillRoot, file);
    if (!existsSync(filePath)) return null;
    files.set(file, await readFile(filePath, "utf8"));
  }
  return files;
}

function skillRepo(skill) {
  const source = String(skill.source || "").trim();
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source) ? source : defaultSkillsRepo;
}

function githubRawUrl(repo, branch, filePath) {
  const encodedPath = filePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `https://raw.githubusercontent.com/${repo}/${branch}/${encodedPath}`;
}

async function fetchRemoteSkillFiles(skill) {
  const directory = safePathSegment(skill.directory || skill.id);
  if (!directory) {
    throw new Error("skill has no safe directory");
  }

  const repo = skillRepo(skill);
  const files = normalizeSkillFileList(skill);
  const branches = ["HEAD", "main", "master"];
  let lastError = null;

  for (const branch of branches) {
    const fetchedFiles = new Map();
    try {
      for (const file of files) {
        const response = await fetchWithTimeout(githubRawUrl(repo, branch, `${directory}/${file}`), {}, 15000);
        if (!response.ok) throw new Error(`${file} returned ${response.status}`);
        fetchedFiles.set(file, await response.text());
      }
      return fetchedFiles;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("could not fetch skill files");
}

async function getSkillFiles(skill) {
  const localFiles = await readLocalSkillFiles(skill);
  if (localFiles) return localFiles;
  return fetchRemoteSkillFiles(skill);
}

function skillSummary(skill) {
  return {
    id: skill.id,
    name: skill.name || skill.id,
    category: skill.category || "",
    author: skill.author || "",
    source: skill.source || defaultSkillsRepo,
    url: skill.url || `${skilledBaseUrl}/skill/${skill.id}`,
  };
}

async function installAgentSkills(agent, agentHome, agentId) {
  const requestedSkills = uniqueSkillIds(agent.skills);
  const skillsDir = join(agentHome, "skills");
  const displaySkillsDir = `.autohand/agents/${agentId}/skills`;
  await mkdir(skillsDir, { recursive: true });

  if (!requestedSkills.length) {
    const emptyInstall = {
      source: skilledBaseUrl,
      repository: defaultSkillsRepo,
      path: skillsDir,
      displayPath: displaySkillsDir,
      requested: [],
      installed: [],
      failed: [],
      updatedAt: new Date().toISOString(),
    };
    await writeFile(join(skillsDir, "installed-skills.json"), JSON.stringify(emptyInstall, null, 2), "utf8");
    return emptyInstall;
  }

  const catalog = await loadSkillCatalog();
  const catalogById = new Map(catalog.skills.map((skill) => [skill.id, skill]));
  const install = {
    source: skilledBaseUrl,
    repository: defaultSkillsRepo,
    path: skillsDir,
    displayPath: displaySkillsDir,
    requested: requestedSkills,
    installed: [],
    failed: [],
    updatedAt: new Date().toISOString(),
  };

  for (const skillId of requestedSkills) {
    const skill = catalogById.get(skillId);
    if (!skill) {
      install.failed.push({ id: skillId, status: "missing", reason: "not found in Skilled catalog" });
      continue;
    }

    const targetDir = join(skillsDir, skillId);
    const skillPath = join(targetDir, "SKILL.md");
    const summary = skillSummary(skill);
    if (existsSync(skillPath)) {
      install.installed.push({ ...summary, status: "present", path: skillPath });
      continue;
    }

    try {
      const files = await getSkillFiles(skill);
      for (const [relativePath, content] of files) {
        const targetPath = safeJoin(targetDir, relativePath);
        await mkdir(dirname(targetPath), { recursive: true });
        await writeFile(targetPath, content, "utf8");
      }
      install.installed.push({ ...summary, status: "installed", path: skillPath });
    } catch (error) {
      install.failed.push({
        id: skillId,
        status: "failed",
        reason: error instanceof Error ? error.message : "could not install skill",
      });
    }
  }

  await writeFile(join(skillsDir, "installed-skills.json"), JSON.stringify(install, null, 2), "utf8");
  return install;
}

function defaultAgentConfig(workspace) {
  return {
    provider: "openrouter",
    openrouter: {
      apiKey: "",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "openrouter/auto",
    },
    workspace: {
      defaultRoot: workspace,
      allowDangerousOps: false,
    },
    ui: {
      theme: "dark",
      autoConfirm: false,
      silentToolOutput: false,
      completionReportEnabled: true,
      activityVerbsEnabled: true,
      promptSuggestions: true,
    },
    telemetry: {
      enabled: false,
    },
    autoReport: {
      enabled: true,
    },
    agent: {
      toolSelectionCache: true,
      idleLogoutEnabled: false,
    },
  };
}

function providerTemplate(providerId) {
  const definition = providerDefinitionMap.get(providerId) || providerDefinitions[0];
  return {
    id: definition.id,
    enabled: definition.id === "openrouter",
    apiKey: "",
    baseUrl: definition.baseUrl || "",
    model: definition.model || "",
    region: "",
    profile: "",
  };
}

function normalizedProviderId(value, fallback = "openrouter") {
  const providerId = String(value || "").trim().toLowerCase();
  return providerDefinitionMap.has(providerId) ? providerId : fallback;
}

function normalizeProviderRecord(providerId, source = {}, previous = null) {
  const template = providerTemplate(providerId);
  const current = source && typeof source === "object" ? source : {};
  const prior = previous && typeof previous === "object" ? previous : {};
  const rawApiKey = current.apiKey;
  const apiKey =
    rawApiKey === undefined || rawApiKey === null || rawApiKey === ""
      ? String(prior.apiKey || template.apiKey || "")
      : String(rawApiKey);

  return {
    ...template,
    ...prior,
    ...current,
    id: providerId,
    enabled: current.enabled === undefined ? prior.enabled === true || template.enabled === true : current.enabled === true,
    apiKey,
    baseUrl: String(current.baseUrl ?? prior.baseUrl ?? template.baseUrl ?? "").trim(),
    model: String(current.model ?? prior.model ?? template.model ?? "").trim(),
    region: String(current.region ?? prior.region ?? template.region ?? "").trim(),
    profile: String(current.profile ?? prior.profile ?? template.profile ?? "").trim(),
  };
}

function normalizeProviderSettings(input = {}, previous = null) {
  const source = input && typeof input === "object" ? input : {};
  const prior = previous && typeof previous === "object" ? previous : {};
  const sourceProviders = source.providers && typeof source.providers === "object" ? source.providers : {};
  const priorProviders = prior.providers && typeof prior.providers === "object" ? prior.providers : {};
  const providers = {};

  for (const definition of providerDefinitions) {
    providers[definition.id] = normalizeProviderRecord(
      definition.id,
      sourceProviders[definition.id],
      priorProviders[definition.id]
    );
  }

  const defaultProvider = normalizedProviderId(source.defaultProvider || prior.defaultProvider);
  if (providers[defaultProvider]) {
    providers[defaultProvider].enabled = true;
  }

  return {
    version: 1,
    defaultProvider,
    providers,
    updatedAt: String(source.updatedAt || prior.updatedAt || new Date().toISOString()),
  };
}

function providerSettingsFromAutohandConfig(config) {
  if (!config || typeof config !== "object") return normalizeProviderSettings();
  const providers = {};
  for (const definition of providerDefinitions) {
    const providerConfig = config[definition.id] && typeof config[definition.id] === "object" ? config[definition.id] : {};
    providers[definition.id] = normalizeProviderRecord(definition.id, {
      ...providerConfig,
      enabled: definition.id === config.provider || Boolean(providerConfig.apiKey || providerConfig.baseUrl || providerConfig.model),
      apiKey: providerConfig.apiKey || providerConfig.api_key || "",
      baseUrl: providerConfig.baseUrl || providerConfig.base_url || definition.baseUrl || "",
      model: providerConfig.model || definition.model || "",
      region: providerConfig.region || "",
      profile: providerConfig.profile || "",
    });
  }
  return normalizeProviderSettings({
    defaultProvider: normalizedProviderId(config.provider),
    providers,
  });
}

async function readProviderSettings({ includeSecrets = false } = {}) {
  let settings = null;
  if (existsSync(providerSettingsPath)) {
    try {
      settings = normalizeProviderSettings(JSON.parse(await readFile(providerSettingsPath, "utf8")));
    } catch {
      settings = normalizeProviderSettings();
    }
  } else if (existsSync(userConfigPath)) {
    try {
      settings = providerSettingsFromAutohandConfig(JSON.parse(await readFile(userConfigPath, "utf8")));
    } catch {
      settings = normalizeProviderSettings();
    }
    await writeProviderSettings(settings);
  } else {
    settings = normalizeProviderSettings();
    await writeProviderSettings(settings);
  }

  return includeSecrets ? settings : publicProviderSettings(settings);
}

async function writeProviderSettings(settings) {
  const normalized = normalizeProviderSettings({ ...settings, updatedAt: new Date().toISOString() });
  await mkdir(appStateDir, { recursive: true });
  await writeFile(providerSettingsPath, JSON.stringify(normalized, null, 2), "utf8");
  return normalized;
}

function publicProviderSettings(settings) {
  const normalized = normalizeProviderSettings(settings);
  const providers = {};
  for (const [providerId, provider] of Object.entries(normalized.providers)) {
    providers[providerId] = {
      ...provider,
      apiKey: "",
      apiKeyConfigured: Boolean(provider.apiKey),
      requiresApiKey: providerDefinitionMap.get(providerId)?.requiresApiKey === true,
      label: providerDefinitionMap.get(providerId)?.label || providerId,
      kind: providerDefinitionMap.get(providerId)?.kind || "cloud",
    };
  }
  return {
    ...normalized,
    definitions: providerDefinitions,
    providers,
  };
}

async function saveProviderSettingsPatch(input = {}) {
  const current = await readProviderSettings({ includeSecrets: true });
  const next = normalizeProviderSettings(input, current);
  return publicProviderSettings(await writeProviderSettings(next));
}

function providerConfigured(provider) {
  if (!provider?.enabled) return false;
  const definition = providerDefinitionMap.get(provider.id);
  if (!definition) return false;
  if (definition.requiresApiKey && !provider.apiKey) return false;
  if (!provider.model) return false;
  return true;
}

async function testProviderSettings(input = {}) {
  const current = await readProviderSettings({ includeSecrets: true });
  const settings =
    input && typeof input.providerSettings === "object"
      ? normalizeProviderSettings(input.providerSettings, current)
      : current;
  const providerId = normalizedProviderId(input.provider || settings.defaultProvider);
  const provider = settings.providers[providerId];
  if (!provider?.enabled) {
    throw new Error(`${providerDefinitionMap.get(providerId)?.label || providerId} is not enabled.`);
  }
  if (!providerConfigured(provider)) {
    const definition = providerDefinitionMap.get(providerId);
    const missing = [
      definition?.requiresApiKey && !provider.apiKey ? "API key" : "",
      !provider.model ? "default model" : "",
    ].filter(Boolean);
    throw new Error(`${definition?.label || providerId} is missing ${missing.join(" and ") || "required fields"}.`);
  }
  return {
    provider: providerId,
    model: provider.model,
    status: "configured",
    message: `${providerDefinitionMap.get(providerId)?.label || providerId} is configured for new runs.`,
  };
}

function normalizeModelAssignment(assignment) {
  const source = assignment && typeof assignment === "object" ? assignment : {};
  const mode = source.mode === "override" ? "override" : "inherit";
  const provider = normalizedProviderId(source.provider);
  const model = String(source.model || "").trim();
  return mode === "override" ? { mode, provider, model } : { mode: "inherit" };
}

function modelAssignmentFromAgent(agent) {
  if (agent?.modelAssignment && typeof agent.modelAssignment === "object") {
    return normalizeModelAssignment(agent.modelAssignment);
  }
  const permissions = normalizeAgentPermissions(agent);
  if (permissions.modelSecurityEnabled && permissions.modelSecurity.model) {
    return {
      mode: "override",
      provider: permissions.modelSecurity.provider,
      model: permissions.modelSecurity.model,
    };
  }
  return { mode: "inherit" };
}

async function resolveProviderForAgent(agent) {
  const settings = await readProviderSettings({ includeSecrets: true });
  const assignment = modelAssignmentFromAgent(agent);
  const providerId = assignment.mode === "override" ? assignment.provider : settings.defaultProvider;
  const provider = settings.providers[providerId];
  const definition = providerDefinitionMap.get(providerId);

  if (!provider || !definition) {
    throw new Error(`Provider ${providerId} is not available in Settings.`);
  }
  if (!provider.enabled) {
    throw new Error(`${definition.label} is assigned to this agent, but it is not enabled in Settings.`);
  }
  if (definition.requiresApiKey && !provider.apiKey) {
    throw new Error(`${definition.label} is assigned to this agent, but its API key is missing in Settings.`);
  }

  const model = assignment.mode === "override" ? assignment.model : provider.model;
  if (!model) {
    throw new Error(`${definition.label} needs a default model before this agent can run.`);
  }

  return {
    assignment,
    provider: providerId,
    label: definition.label,
    model,
    baseUrl: provider.baseUrl || "",
    apiKey: provider.apiKey || "",
    region: provider.region || "",
    profile: provider.profile || "",
    source: assignment.mode === "override" ? "agent" : "workspace",
  };
}

function providerConfigForResolved(resolvedProvider) {
  const config = {};
  if (resolvedProvider.apiKey) config.apiKey = resolvedProvider.apiKey;
  if (resolvedProvider.baseUrl) config.baseUrl = resolvedProvider.baseUrl;
  if (resolvedProvider.model) config.model = resolvedProvider.model;
  if (resolvedProvider.region) config.region = resolvedProvider.region;
  if (resolvedProvider.profile) config.profile = resolvedProvider.profile;
  return config;
}

function publicResolvedProvider(resolvedProvider) {
  if (!resolvedProvider) return null;
  return {
    provider: resolvedProvider.provider,
    label: resolvedProvider.label,
    model: resolvedProvider.model,
    baseUrl: resolvedProvider.baseUrl,
    source: resolvedProvider.source,
  };
}

const permissionModes = new Set(["interactive", "restricted", "unrestricted", "external"]);
const toolPolicyModes = new Set(["allow", "ask", "block"]);
const fileGuardTargetTools = [
  "read_file",
  "write_file",
  "append_file",
  "apply_patch",
  "search_replace",
  "notebook_edit",
  "delete_path",
];
const modelSecurityProviders = new Set([
  "openrouter",
  "openai",
  "llmgateway",
  "ollama",
  "bedrock",
  "deepseek",
  "zai",
  "nvidia",
  "cerebras",
]);

function normalizeProjectLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return projectLimitUpperBound;
  return Math.min(projectLimitUpperBound, Math.max(1, Math.floor(parsed)));
}

function normalizeHandoffRetryMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  if (["manual", "manual-retry", "user", "user-driven"].includes(mode)) return "manual";
  if (["disabled", "disable", "off", "none", "never"].includes(mode)) return "disabled";
  return "checkpoint";
}

function uniqueStrings(values) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function normalizeAgentProjects(agent, fallbackWorkspace = "", includeFallback = false) {
  const sourceProjects = Array.isArray(agent?.projects) ? agent.projects : [];
  const candidates = includeFallback && fallbackWorkspace ? [{ path: fallbackWorkspace }, ...sourceProjects] : sourceProjects;
  const source = candidates.length ? candidates : fallbackWorkspace ? [{ path: fallbackWorkspace }] : [];
  const seen = new Set();
  const projects = [];

  for (const item of source) {
    const rawPath = typeof item === "string" ? item : item?.path;
    if (typeof rawPath !== "string" || !rawPath.trim()) continue;

    const resolvedPath = normalizeSquadWorkspacePath(resolve(rawPath.replace(/\/+$/, "") || rawPath));
    if (seen.has(resolvedPath) || !isRunnableWorkspace(resolvedPath)) continue;
    if (!existsSync(resolvedPath) || !statSync(resolvedPath).isDirectory()) continue;

    seen.add(resolvedPath);
    projects.push({
      id: String(item?.id || `project_${Buffer.from(resolvedPath).toString("base64url").slice(0, 24)}`),
      name: String(item?.name || basename(resolvedPath)),
      label: String(item?.label || relative(homeDir, resolvedPath) || basename(resolvedPath)),
      path: resolvedPath,
      kind: String(item?.kind || (existsSync(join(resolvedPath, ".git")) ? "git repo" : "project")),
      addedAt: String(item?.addedAt || ""),
    });

    if (projects.length >= maxProjectsPerMember) break;
  }

  return projects;
}

function normalizeAgentPermissions(agent) {
  const permissions = agent?.permissions && typeof agent.permissions === "object" ? agent.permissions : {};
  const builtInPolicies = permissions.builtInPolicies && typeof permissions.builtInPolicies === "object"
    ? Object.fromEntries(
        Object.entries(permissions.builtInPolicies)
          .filter(([tool, mode]) => tool && toolPolicyModes.has(mode))
          .map(([tool, mode]) => [tool, mode])
      )
    : {};
  const modelSecurity = permissions.modelSecurity && typeof permissions.modelSecurity === "object" ? permissions.modelSecurity : {};
  const provider = modelSecurityProviders.has(modelSecurity.provider) ? modelSecurity.provider : "openrouter";
  const model = String(modelSecurity.model || "").trim();

  return {
    permissionMode: permissionModes.has(permissions.permissionMode) ? permissions.permissionMode : "interactive",
    rememberSession: permissions.rememberSession !== false,
    builtInToolPolicyEnabled: permissions.builtInToolPolicyEnabled !== false,
    fileGuardEnabled: permissions.fileGuardEnabled !== false,
    modelSecurityEnabled: permissions.modelSecurityEnabled === true,
    builtInPolicies,
    sensitivePaths: uniqueStrings(Array.isArray(permissions.sensitivePaths) ? permissions.sensitivePaths : []),
    allPathsAllowed: permissions.allPathsAllowed === true,
    allUrlsAllowed: permissions.allUrlsAllowed === true,
    modelSecurity: {
      provider,
      model,
      thinkingLevel: ["none", "normal", "extended"].includes(modelSecurity.thinkingLevel)
        ? modelSecurity.thinkingLevel
        : "normal",
      toolChoice: ["auto", "required", "none"].includes(modelSecurity.toolChoice)
        ? modelSecurity.toolChoice
        : "auto",
      requireNativeToolCalling: modelSecurity.requireNativeToolCalling !== false,
      lockModelSelector: modelSecurity.lockModelSelector === true,
      requireConfiguredSearchProvider: modelSecurity.requireConfiguredSearchProvider !== false,
    },
  };
}

function expandPathPattern(pathPattern) {
  const value = String(pathPattern || "").trim();
  if (!value) return [];
  if (value.startsWith("~/")) {
    return [value, join(homeDir, value.slice(2))];
  }
  return [value];
}

function permissionSettingsFromAgent(agent) {
  const permissions = normalizeAgentPermissions(agent);
  const settings = {
    mode: permissions.permissionMode,
    rememberSession: permissions.rememberSession,
    allPathsAllowed: permissions.allPathsAllowed,
    allUrlsAllowed: permissions.allUrlsAllowed,
  };

  if (permissions.builtInToolPolicyEnabled) {
    const entries = Object.entries(permissions.builtInPolicies);
    settings.allowPatterns = entries
      .filter(([, mode]) => mode === "allow")
      .map(([kind]) => ({ kind }));
    settings.availableTools = entries
      .filter(([, mode]) => mode !== "block")
      .map(([kind]) => ({ kind }));
    settings.excludedTools = entries
      .filter(([, mode]) => mode === "block")
      .map(([kind]) => ({ kind }));
    settings.rules = entries
      .filter(([, mode]) => mode === "ask")
      .map(([tool]) => ({ tool, action: "prompt" }));
  }

  if (permissions.fileGuardEnabled && permissions.sensitivePaths.length) {
    const pathPatterns = uniqueStrings(permissions.sensitivePaths.flatMap(expandPathPattern));
    settings.denyList = pathPatterns.flatMap((pathPattern) =>
      fileGuardTargetTools.map((tool) => `${tool}:${pathPattern}`)
    );
  }

  return settings;
}

function modelSecurityConfigFromAgent(agent, config) {
  const permissions = normalizeAgentPermissions(agent);
  if (!permissions.modelSecurityEnabled) {
    return {};
  }
  const { provider, model } = permissions.modelSecurity;
  const providerConfig = config[provider] && typeof config[provider] === "object" ? config[provider] : {};
  return {
    provider,
    [provider]: {
      ...providerConfig,
      ...(model ? { model } : {}),
    },
  };
}

const profileFileDefinitions = [
  {
    section: "identity",
    fileName: "IDENTITY.md",
    title: "Identity",
    meaning: "role, responsibilities, ownership, and expected evidence",
  },
  {
    section: "persona",
    fileName: "PERSONALITY.md",
    aliases: ["PERSONA.md"],
    title: "Personality",
    meaning: "tone, collaboration style, behavioral defaults, and escalation rules",
  },
  {
    section: "bible",
    fileName: "BIBLE.md",
    title: "Bible",
    meaning: "workflow rules, verification expectations, tools, and boundaries",
  },
  {
    section: "brain-card",
    fileName: "BRAIN_CARD.md",
    title: "Brain Card",
    meaning: "structured purpose, workflow, tools, escalation, done standards, review style, and memory policy",
  },
  {
    section: "memory",
    fileName: "MEMORY.md",
    title: "Memory",
    meaning: "durable agent-specific context, saved learnings, and project preferences",
  },
];

const brainCardFieldDefinitions = [
  { id: "purpose", label: "Purpose" },
  { id: "defaultWorkflow", label: "Default workflow" },
  { id: "allowedTools", label: "Allowed tools" },
  { id: "escalationRules", label: "Escalation rules" },
  { id: "definitionOfDone", label: "Definition of done" },
  { id: "reviewStyle", label: "Review style" },
  { id: "memoryPolicy", label: "Memory policy" },
];

function genericBrainCardForAgent(agent, skillInstall) {
  const role = agent.role || "Software engineering agent";
  const skills = Array.isArray(skillInstall?.requested)
    ? skillInstall.requested
    : Array.isArray(agent.skills)
      ? agent.skills
      : [];
  return {
    purpose: agent.description || `Operate as ${role} for the selected local workspace.`,
    defaultWorkflow: [
      "1. Inspect the active workspace and task context before acting.",
      "2. Clarify assumptions when role scope or ownership is ambiguous.",
      "3. Work in small scoped increments using the role's standards.",
      "4. Validate with the strongest local evidence available.",
      "5. Report outcome, evidence, and remaining risk clearly.",
    ].join("\n"),
    allowedTools: [
      "- Autohand CLI inside this squad member's isolated home.",
      "- Local read/search/edit/build/test tools allowed by the current permission policy.",
      skills.length ? skills.map((skill) => `- ${skill}`).join("\n") : "- Installed profile skills when they match the task.",
    ].join("\n"),
    escalationRules: [
      "- Ask before destructive changes, secret access, or crossing repository boundaries.",
      "- Hand off when another squad member has clearer ownership.",
      "- Stop and surface blockers when credentials, runtime services, or product decisions are missing.",
    ].join("\n"),
    definitionOfDone: [
      "- The requested behavior or artifact is complete.",
      "- Role-specific risks have been checked.",
      "- Validation evidence is captured.",
      "- Remaining uncertainty is named.",
    ].join("\n"),
    reviewStyle: agent.instructions || `Review work through the standards expected of a ${role}.`,
    memoryPolicy:
      "Propose durable memory only for stable role preferences, project facts, repeated decisions, or verified constraints. Keep secrets, temporary logs, speculative findings, and one-off session details out of durable memory unless the app promotes them through the memory flow.",
    whyThisAgent: `Choose this squad member when the task needs ${role} judgment and its configured skills.`,
  };
}

function normalizeBrainCard(agent, skillInstall) {
  const source = agent?.brainCard && typeof agent.brainCard === "object" ? agent.brainCard : {};
  const fallback = genericBrainCardForAgent(agent || {}, skillInstall);
  const normalized = {};
  for (const field of brainCardFieldDefinitions) {
    normalized[field.id] = String(source[field.id] || fallback[field.id] || "").trim();
  }
  normalized.whyThisAgent = String(source.whyThisAgent || fallback.whyThisAgent || "").trim();
  return normalized;
}

function brainCardMarkdown(agent, skillInstall) {
  const brainCard = normalizeBrainCard(agent, skillInstall);
  const lines = [
    "# Brain Card",
    "",
    `Agent: ${agent.name || "Squad member"}`,
    `Role: ${agent.role || "Software engineering agent"}`,
  ];
  for (const field of brainCardFieldDefinitions) {
    lines.push("", `## ${field.label}`, "", brainCard[field.id] || "Not configured.");
  }
  lines.push("", "## Why this agent?", "", brainCard.whyThisAgent || "Not configured.");
  return lines.join("\n");
}

function cleanProfileMarkdownFileName(definition, input) {
  const fallback = definition.fileName;
  const baseName = basename(String(input || "").trim());
  if (!baseName || !baseName.toLowerCase().endsWith(".md")) return fallback;
  const lowerName = baseName.toLowerCase();
  const alias = definition.aliases?.find((item) => item.toLowerCase() === lowerName);
  if (alias) return alias;
  return lowerName === fallback.toLowerCase() ? fallback : fallback;
}

function defaultProfileFileContent(agent, definition, workspace, skillInstall) {
  const name = agent.name || "Squad member";
  const role = agent.role || "Software engineering agent";
  const skills = Array.isArray(skillInstall.requested) ? skillInstall.requested : [];
  const projects = normalizeAgentProjects(agent, workspace, true);

  if (definition.section === "identity") {
    return [
      "# Identity",
      `Name: ${name}`,
      `Role: ${role}`,
      agent.description
        ? `Responsibilities:\n${agent.description}`
        : "Responsibilities:\nWork as the configured Autohand Squad member for the selected local workspace.",
      `Default workspace: ${workspace}`,
      projects.length ? `Associated projects:\n${projects.map((project) => `- ${project.label}: ${project.path}`).join("\n")}` : "",
    ].join("\n\n");
  }

  if (definition.section === "persona") {
    return [
      "# Personality",
      agent.instructions || `Act as ${role}. Keep work scoped, ask when role boundaries are unclear, and report evidence clearly.`,
      "Collaboration defaults:\n- Match the role selected in Autohand Squad.\n- Keep local work isolated to this squad member's Autohand home.\n- Use concise, evidence-backed status updates.",
    ].join("\n\n");
  }

  if (definition.section === "bible") {
    return [
      "# Bible",
      "Workflow:\n- Inspect the selected workspace before acting.\n- Keep changes scoped to the user's request.\n- Use installed profile skills when they match the task.\n- Report validation evidence after running local Autohand work.",
      skills.length ? `Profile skills:\n${skills.map((skill) => `- ${skill}`).join("\n")}` : "Profile skills:\n- No skills selected yet.",
    ].join("\n\n");
  }

  if (definition.section === "brain-card") {
    return brainCardMarkdown(agent, skillInstall);
  }

  const memoryItems = Array.isArray(agent.memory) ? agent.memory : [];
  return [
    "# Memory",
    "Durable context for this squad member:",
    memoryItems.length ? memoryItems.map((item) => `- ${item}`).join("\n") : "- Created from Autohand Squad.",
    `Skill source: ${agent.skillSource || skilledBaseUrl}`,
  ].join("\n\n");
}

function normalizeProfileFiles(agent, workspace, skillInstall) {
  const providedFiles = Array.isArray(agent.profileFiles) ? agent.profileFiles : [];
  const providedBySection = new Map();
  for (const file of providedFiles) {
    const section = String(file?.section || "").trim().toLowerCase();
    const content = String(file?.content || "").trim();
    if (!section || !content || content.length > 512 * 1024) continue;
    providedBySection.set(section, file);
  }

  return profileFileDefinitions.map((definition) => {
    if (definition.section === "brain-card") {
      return {
        ...definition,
        fileName: definition.fileName,
        originalFileName: "",
        content: defaultProfileFileContent(agent, definition, workspace, skillInstall),
        source: "generated",
      };
    }
    const provided = providedBySection.get(definition.section);
    const originalFileName = String(provided?.originalFileName || provided?.fileName || "").trim();
    const fileName = cleanProfileMarkdownFileName(definition, originalFileName);
    return {
      ...definition,
      fileName,
      originalFileName,
      content: String(provided?.content || "").trim() || defaultProfileFileContent(agent, definition, workspace, skillInstall),
      source: provided?.source === "upload" ? "upload" : provided?.source === "manual" ? "manual" : "generated",
    };
  });
}

function buildAgentProfileIndex(agent, files, profileDir, displayProfileDir) {
  const name = agent.name || "Squad member";
  const role = agent.role || "Software engineering agent";
  const personaFile = files.find((file) => file.section === "persona");
  const lines = [
    "# AGENTS.md",
    "",
    `This is the profile map for ${name} (${role}).`,
    "It points to this squad member's saved profile Markdown files without embedding their full contents in the system prompt.",
    "Read the specific profile file when the user's request needs that kind of role context.",
    "",
    "## Profile Files",
  ];

  for (const file of files) {
    lines.push(`- \`${join(profileDir, file.fileName)}\` (${displayProfileDir}/${file.fileName}): ${file.meaning}.`);
  }

  lines.push("- `PERSONA.md` is accepted as an alias for `PERSONALITY.md` when present.");

  lines.push(
    "",
    "## Usage",
    "- Use `IDENTITY.md` for role scope, ownership, and responsibility questions.",
    "- Use `PERSONALITY.md` or `PERSONA.md` for tone, collaboration, and behavioral defaults.",
    "- Use `BIBLE.md` for workflow, verification, and operating rules.",
    "- Use `BRAIN_CARD.md` for the structured operating contract: purpose, workflow, tools, escalation, done standards, review style, and memory policy.",
    "- Use `MEMORY.md` for durable context and saved learnings.",
    "- Do not load every profile file by default; choose the smallest relevant file for the task."
  );

  return lines.join("\n");
}

async function writeAgentProfileDocs(agent, agentHome, agentId, workspace, skillInstall) {
  const profileDir = join(agentHome, "profile");
  const displayProfileDir = `.autohand/agents/${agentId}/profile`;
  await mkdir(profileDir, { recursive: true });
  const files = normalizeProfileFiles(agent, workspace, skillInstall);

  for (const file of files) {
    await writeFile(join(profileDir, file.fileName), `${file.content.trim()}\n`, "utf8");
  }

  const agentsPath = join(agentHome, "AGENTS.md");
  await writeFile(
    agentsPath,
    `${buildAgentProfileIndex(agent, files, profileDir, displayProfileDir)}\n`,
    "utf8"
  );

  return {
    path: profileDir,
    displayPath: displayProfileDir,
    agentsPath,
    displayAgentsPath: `.autohand/agents/${agentId}/AGENTS.md`,
    files: files.map((file) => ({
      section: file.section,
      title: file.title,
      fileName: file.fileName,
      originalFileName: file.originalFileName,
      source: file.source,
      path: join(profileDir, file.fileName),
      displayPath: `${displayProfileDir}/${file.fileName}`,
      meaning: file.meaning,
    })),
  };
}

// Read the persisted Autohand auth block from a config file, if present.
function readAutohandAuth(configPath) {
  try {
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    return config && typeof config.auth === "object" && config.auth ? config.auth : null;
  } catch {
    return null;
  }
}

// A token is usable when it exists and is not locally expired. Mirrors the
// Autohand CLI's own `isTokenExpiredLocally` so we agree with the binary on when
// it would otherwise drop into a blocking interactive re-login.
function autohandAuthUsable(auth) {
  if (!auth || !auth.token) return false;
  if (!auth.expiresAt) return true;
  const expiresAt = Date.parse(auth.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt > Date.now();
}

// Throw a clear, actionable error instead of spawning a CLI that would block on
// interactive sign-in. Call before any non-TTY autohand spawn (rpc/CLI run/chat).
function assertAutohandAuth(agentRuntime) {
  if (!agentRuntime?.authReady) {
    throw new AutohandAuthError(
      "Autohand sign-in required or expired. Run `autohand login` in your terminal, then retry."
    );
  }
}

async function ensureAgentRuntime(input, workspace) {
  const agent = input.agent && typeof input.agent === "object" ? input.agent : {};
  const agentId = sanitizeAgentId(agent.id || input.agentId);
  const agentHome = join(isolatedAgentsDir, agentId);
  const configPath = join(agentHome, "config.json");
  const displayConfigPath = `.autohand/agents/${agentId}/config.json`;
  const displayProfileDir = `.autohand/agents/${agentId}/profile`;
  await mkdir(agentHome, { recursive: true });
  await Promise.all([
    mkdir(join(agentHome, "sessions"), { recursive: true }),
    mkdir(join(agentHome, "memory"), { recursive: true }),
    mkdir(join(agentHome, "projects"), { recursive: true }),
    mkdir(join(agentHome, "skills"), { recursive: true }),
  ]);

  const skillInstall = await installAgentSkills(agent, agentHome, agentId);
  const projects = normalizeAgentProjects(agent, workspace, true);
  const brainCard = normalizeBrainCard(agent, skillInstall);
  const profileDocs = await writeAgentProfileDocs(agent, agentHome, agentId, workspace, skillInstall);
  const resolvedProvider = await resolveProviderForAgent(agent);

  if (!existsSync(configPath)) {
    if (existsSync(userConfigPath)) {
      await copyFile(userConfigPath, configPath);
    } else {
      await writeFile(configPath, JSON.stringify(defaultAgentConfig(workspace), null, 2), "utf8");
    }
  }

  try {
    const config = JSON.parse(await readFile(configPath, "utf8"));
    const permissionSettings = permissionSettingsFromAgent(agent);
    const normalizedPermissions = normalizeAgentPermissions(agent);
    const providerSpecificConfig = providerConfigForResolved(resolvedProvider);
    // Keep each member's auth in sync with the user's login. The config is copied
    // from the user's config only on first creation, so a later `autohand login`
    // never reached existing members — their frozen token would expire and the
    // CLI (spawned with --config <agent-config>) would block on an interactive
    // re-login over a non-TTY pipe, stalling the SDK stream. Adopt the user's
    // current token whenever it is usable. If the user has logged out, remove
    // the member's copied token as well so an old isolated profile cannot keep
    // authenticating after the global session is cleared.
    const userAuth = readAutohandAuth(userConfigPath);
    const syncedAuth = autohandAuthUsable(userAuth) ? userAuth : null;
    const nextConfig = {
      ...config,
      ...(syncedAuth ? { auth: syncedAuth } : {}),
      provider: resolvedProvider.provider,
      [resolvedProvider.provider]: {
        ...(config[resolvedProvider.provider] && typeof config[resolvedProvider.provider] === "object"
          ? config[resolvedProvider.provider]
          : {}),
        ...providerSpecificConfig,
      },
      workspace: {
        ...(config.workspace && typeof config.workspace === "object" ? config.workspace : {}),
        defaultRoot: workspace,
        projects,
      },
      agent: {
        ...(config.agent && typeof config.agent === "object" ? config.agent : {}),
        idleLogoutEnabled: false,
        projectLimit: maxProjectsPerMember,
        projects,
        profileSkills: skillInstall.requested,
        skillsRegistry: skilledBaseUrl,
        skillsPath: skillInstall.displayPath,
        profilePath: profileDocs.displayPath,
        profileMap: profileDocs.displayAgentsPath,
        brainCard,
        permissionsUi: normalizedPermissions,
        modelSecurity: normalizedPermissions.modelSecurity,
        modelAssignment: modelAssignmentFromAgent(agent),
        effectiveModel: publicResolvedProvider(resolvedProvider),
      },
      permissions: {
        ...(config.permissions && typeof config.permissions === "object" ? config.permissions : {}),
        ...permissionSettings,
      },
    };
    if (!syncedAuth) delete nextConfig.auth;
    await writeFile(configPath, JSON.stringify(nextConfig, null, 2), "utf8");
  } catch {
    // If the copied config is not JSON, leave it untouched; Autohand will report the parse error.
  }

  const profilePath = join(agentHome, "profile.json");
  await writeFile(
    profilePath,
    JSON.stringify(
      {
        id: agentId,
        staffId: agent.staffId || "",
        name: agent.name || "Squad member",
        role: agent.role || "",
        description: agent.description || "",
        instructions: agent.instructions || "",
        brainCard,
        skills: skillInstall.requested,
        skillSource: skilledBaseUrl,
        skillInstall,
        profileDocs,
        permissions: normalizeAgentPermissions(agent),
        modelAssignment: modelAssignmentFromAgent(agent),
        effectiveModel: publicResolvedProvider(resolvedProvider),
        projects,
        limits: {
          maxProjectsPerMember,
        },
        workspace,
        updatedAt: new Date().toISOString(),
      },
      null,
      2
    ),
    "utf8"
  );

  // Reflects the auth that the spawned CLI will actually load (the agent config
  // we just synced), falling back to the user config. Drives the pre-flight
  // sign-in check so a stale/missing token fails fast instead of stalling.
  const authReady =
    autohandAuthUsable(readAutohandAuth(configPath)) ||
    autohandAuthUsable(readAutohandAuth(userConfigPath));

  return {
    agentId,
    agentHome,
    configPath,
    profilePath,
    displayConfigPath,
    displayProfileDir,
    workspace,
    skillInstall,
    profileDocs,
    brainCard,
    effectiveModel: publicResolvedProvider(resolvedProvider),
    resolvedProvider,
    authReady,
  };
}

async function autohandArgs(input) {
  const mode = input.mode || "prompt";
  const workspace = await cleanWorkspace(input.workspace);
  const prompt = String(input.prompt || "").trim();
  const profile = String(input.profile || "").trim().slice(0, 12000);
  const agentRuntime = await ensureAgentRuntime(input, workspace);
  const permissions = normalizeAgentPermissions(input.agent);
  const associatedProjects = normalizeAgentProjects(input.agent);
  const args = ["--path", workspace, "--config", agentRuntime.configPath];
  const displayArgs = ["--path", workspace, "--config", "<agent-config>"];

  function pushArg(...values) {
    args.push(...values);
    displayArgs.push(...values);
  }

  if (autohandSupportsFlag("--no-idle-logout")) {
    pushArg("--no-idle-logout");
  }

  const effectiveModel = input.model || agentRuntime.resolvedProvider?.model || (permissions.modelSecurityEnabled ? permissions.modelSecurity.model : "");
  if (effectiveModel) {
    pushArg("--model", effectiveModel);
  }
  if (agentRuntime.profileDocs?.path) {
    args.push("--add-dir", agentRuntime.profileDocs.path);
    displayArgs.push("--add-dir", agentRuntime.profileDocs.displayPath || "<agent-profile-dir>");
  }
  for (const project of associatedProjects) {
    if (project.path === workspace) continue;
    args.push("--add-dir", project.path);
    displayArgs.push("--add-dir", project.label || project.path);
  }
  if (profile) {
    args.push("--append-sys-prompt", profile);
    displayArgs.push("--append-sys-prompt", "<agent-profile>");
  }
  if (permissions.permissionMode === "unrestricted") {
    pushArg("--unrestricted");
  } else if (permissions.permissionMode === "restricted" || input.policy === "restricted") {
    pushArg("--restricted");
  } else if (input.policy === "yes") {
    pushArg("--yes");
  }
  if (input.dryRun) pushArg("--dry-run");

  if (mode === "auto") {
    pushArg("--auto-mode", prompt, "--max-runtime", String(input.maxRuntime || 120));
  } else if (mode === "goal") {
    pushArg("--goal", prompt);
  } else if (mode === "permissions") {
    pushArg("--permissions");
  } else {
    pushArg("--prompt", prompt);
  }

  return { args, displayArgs, workspace, prompt, mode, agentRuntime };
}

function autohandClientName(agentRuntime) {
  return `autohand-squad-${agentRuntime.agentId}`;
}

function agentRuntimeEnvVars(agentRuntime) {
  return {
    AUTOHAND_HOME: agentRuntime.agentHome,
    AUTOHAND_CONFIG: agentRuntime.configPath,
    AUTOHAND_CLIENT_NAME: autohandClientName(agentRuntime),
    AUTOHAND_NO_IDLE_LOGOUT: "1",
  };
}

function selectedModelForInput(input, permissions, agentRuntime) {
  return input.model || agentRuntime?.resolvedProvider?.model || (permissions.modelSecurityEnabled && permissions.modelSecurity.model ? permissions.modelSecurity.model : "");
}

function sdkSupportedMode(mode) {
  return mode === "prompt";
}

function sdkTransportEnabled(input, mode) {
  if (!sdkSupportedMode(mode)) return false;
  if (input.transport === "cli") return false;
  return process.env.AUTOHAND_SQUAD_TRANSPORT !== "cli";
}

function sdkRuntimeContext(input, workspace, profile, agentRuntime) {
  const permissions = normalizeAgentPermissions(input.agent);
  const associatedProjects = normalizeAgentProjects(input.agent);
  const model = selectedModelForInput(input, permissions, agentRuntime);
  const addDir = [];
  const displayAddDir = [];

  if (agentRuntime.profileDocs?.path) {
    addDir.push(agentRuntime.profileDocs.path);
    displayAddDir.push(agentRuntime.profileDocs.displayPath || "<agent-profile-dir>");
  }

  for (const project of associatedProjects) {
    if (project.path === workspace) continue;
    addDir.push(project.path);
    displayAddDir.push(project.label || project.path);
  }

  const extraArgs = ["--path", workspace, "--config", agentRuntime.configPath];
  const displayArgs = ["--mode", "rpc", "--path", workspace, "--config", "<agent-config>"];

  if (autohandSupportsFlag("--no-idle-logout")) {
    extraArgs.push("--no-idle-logout");
    displayArgs.push("--no-idle-logout");
  }

  if (permissions.permissionMode === "unrestricted") {
    extraArgs.push("--unrestricted");
    displayArgs.push("--unrestricted");
  } else if (permissions.permissionMode === "restricted" || input.policy === "restricted") {
    extraArgs.push("--restricted");
    displayArgs.push("--restricted");
  } else if (input.policy === "yes") {
    extraArgs.push("--yes");
    displayArgs.push("--yes");
  }

  if (input.dryRun) {
    extraArgs.push("--dry-run");
    displayArgs.push("--dry-run");
  }

  if (model) {
    displayArgs.push("--model", model);
  }
  for (const item of displayAddDir) {
    displayArgs.push("--add-dir", item);
  }
  if (profile) {
    displayArgs.push("--append-sys-prompt", "<agent-profile>");
  }

  const autohandPath = resolveAutohandBinary();
  const options = {
    cwd: workspace,
    extraArgs,
    envVars: agentRuntimeEnvVars(agentRuntime),
    addDir,
    timeout: 300000,
  };
  if (autohandPath) options.cliPath = autohandPath;
  if (model) options.model = model;
  if (agentRuntime.resolvedProvider?.provider) options.provider = agentRuntime.resolvedProvider.provider;
  if (agentRuntime.resolvedProvider?.apiKey) options.apiKey = agentRuntime.resolvedProvider.apiKey;
  if (agentRuntime.resolvedProvider?.baseUrl) options.baseUrl = agentRuntime.resolvedProvider.baseUrl;
  if (profile) options.appendSystemPrompt = profile;

  return {
    options,
    command: `autohand ${displayArgs.map(shellQuote).join(" ")}`,
  };
}

// Goal 06: Layered Context Model — ordered layer contract.
// Static product layers (systemContract, teamOperatingRules) are reconstructed
// from versioned app code. Mutable layers carry a content hash and source key so
// they can be summarized later without losing their link to the source of truth.
const contextLayerOrder = [
  "systemContract",
  "teamOperatingRules",
  "agentRoleProfile",
  "projectMemory",
  "taskContextPack",
  "userRequest",
  "toolTranscript",
];

const contextLayerStatic = {
  systemContract:
    "Autohand operates each squad member as an isolated CLI instance with explicit permission, file-guard, and model-security policies. Destructive actions and out-of-policy tools require escalation before they run.",
  teamOperatingRules:
    "Preserve task evidence, keep durable rules separate from task-specific context, return blocking findings first, and verify before claiming work is done. Auto-merge stays disabled.",
};

function contextHash(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return `sha256:${createHash("sha256").update(text).digest("hex").slice(0, 16)}`;
}

function clampSummary(value, max = 280) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

// Goal 08: Context Packs.
// Soft caps keep the model-facing pack compact (~20k token budget) while the
// stored manifest can hold richer metadata. Large file excerpts are truncated
// with a source link; whole large files, build artifacts, and out-of-workspace
// failures are omitted but always reported in the `omitted` list so nothing is
// silently dropped.
const contextPackFileExcerptMax = 10_000;
const contextPackMaxRelevantFiles = 6;
const contextPackMaxScreenshots = 4;
const contextPackMaxFailures = 4;
const contextPackLargeFileBytes = 100 * 1024;

function approxKb(bytes) {
  return Math.max(1, Math.round((Number(bytes) || 0) / 1024));
}

function approxTokens(chars) {
  // Rough heuristic used only for the soft-budget display; ~4 chars/token.
  return Math.max(0, Math.round((Number(chars) || 0) / 4));
}

// Collect a recent, summarized git diff scoped to the workspace. Returns null
// when the workspace is not a git repo or git is unavailable.
function contextPackRecentDiff(workspace) {
  const rootResult = spawnSync("git", ["-C", workspace, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
    timeout: 2000,
  });
  if (rootResult.status !== 0) return null;
  const repoRoot = rootResult.stdout.trim();
  if (!repoRoot || !isPathInside(workspace, repoRoot)) return null;

  const statResult = spawnSync("git", ["-C", workspace, "diff", "--stat", "--", "."], {
    encoding: "utf8",
    maxBuffer: 512 * 1024,
    timeout: 4000,
  });
  const logResult = spawnSync("git", ["-C", workspace, "log", "-3", "--oneline", "--no-color", "--", "."], {
    encoding: "utf8",
    maxBuffer: 256 * 1024,
    timeout: 4000,
  });
  const stat = statResult.status === 0 ? statResult.stdout.trim() : "";
  const recentCommits = logResult.status === 0
    ? logResult.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    : [];
  if (!stat && !recentCommits.length) return null;

  const changedFiles = stat
    ? stat.split(/\r?\n/).slice(0, -1).map((line) => line.trim()).filter(Boolean).length
    : 0;
  return { stat, recentCommits, changedFiles };
}

// Read a per-file excerpt for the pack. Large files are omitted (link only);
// otherwise the excerpt is truncated at the soft budget with a source link.
function contextPackFileExcerpt(workspace, relPath) {
  const abs = resolve(workspace, relPath);
  if (!isPathInside(abs, workspace) || !existsSync(abs)) return null;
  let info;
  try {
    info = statSync(abs);
  } catch {
    return null;
  }
  if (!info.isFile()) return null;
  const bytes = info.size;
  if (bytes > contextPackLargeFileBytes) {
    return { path: relPath, bytes, omitted: true, reason: "large-file" };
  }
  let content = "";
  try {
    content = readFileSync(abs, "utf8");
  } catch {
    return { path: relPath, bytes, omitted: true, reason: "binary-or-unreadable" };
  }
  const truncated = content.length > contextPackFileExcerptMax;
  const excerpt = truncated ? `${content.slice(0, contextPackFileExcerptMax)}\n… [truncated]` : content;
  return {
    path: relPath,
    bytes,
    truncated,
    excerpt,
    sourceRef: relPath,
  };
}

// Resolve prior failures from the launch payload's task timeline/handoffs,
// scoped to this workspace. Failures recorded against another workspace are
// omitted (and reported) so the pack stays workspace-scoped.
function contextPackPriorFailures(payload, workspace) {
  const task = payload?.task && typeof payload.task === "object" ? payload.task : null;
  const included = [];
  const omitted = [];
  if (!task) return { included, omitted };
  const timeline = Array.isArray(task.timeline) ? task.timeline : [];
  for (const event of timeline) {
    const type = String(event?.evidenceType || event?.type || "");
    const isFailure = /risk|fail/i.test(type) || (Array.isArray(event?.unresolvedRisks) && event.unresolvedRisks.length);
    if (!isFailure) continue;
    const eventWorkspace = String(event?.workspace || task?.workspace || "");
    if (eventWorkspace && workspace && resolve(eventWorkspace) !== resolve(workspace)) {
      omitted.push({ summary: clampSummary(event?.summary || type, 160), reason: "other-workspace" });
      continue;
    }
    included.push({
      id: String(event?.id || ""),
      at: String(event?.at || ""),
      summary: clampSummary(event?.summary || (event?.unresolvedRisks || []).join("; ") || type, 200),
    });
    if (included.length >= contextPackMaxFailures) break;
  }
  return { included, omitted };
}

// Collect distilled user preferences from the agent profile (durable role
// preferences, not task context). These ride along as compact lines.
function contextPackUserPreferences(agent) {
  const memory = Array.isArray(agent?.memory) ? agent.memory.filter(Boolean) : [];
  const prefs = [];
  if (agent?.role) prefs.push(`Role: ${agent.role}`);
  const perms = agent?.permissions && typeof agent.permissions === "object" ? agent.permissions : {};
  if (perms.permissionMode) prefs.push(`Permission mode: ${perms.permissionMode}`);
  for (const item of memory.slice(0, 3)) prefs.push(clampSummary(item, 160));
  return prefs;
}

function collaborationLayerSummary(collaboration) {
  if (!collaboration || typeof collaboration !== "object") return "";
  const handoff = collaboration.handoff && typeof collaboration.handoff === "object" ? collaboration.handoff : {};
  const task = collaboration.task && typeof collaboration.task === "object" ? collaboration.task : {};
  const role = collaboration.role === "receiver" ? "receiver" : collaboration.role === "source" ? "source" : "member";
  return clampSummary(
    [
      `Squad collaboration ${role}`,
      collaboration.sourceAgentId && collaboration.targetAgentId ? `${collaboration.sourceAgentId} -> ${collaboration.targetAgentId}` : "",
      task.title || task.id ? `Task: ${task.title || task.id}` : "",
      handoff.reason ? `Reason: ${handoff.reason}` : "",
      handoff.requiredContext ? `Context: ${handoff.requiredContext}` : "",
    ].filter(Boolean).join("; "),
    280
  );
}

function channelLayerSummary(channelContext) {
  if (!channelContext) return "";
  return clampSummary(
    [
      `Squad channel ${channelContext.channelName || channelContext.channelId} (${channelContext.visibility})`,
      channelContext.threadId ? `Thread: ${channelContext.threadId}` : "",
      channelContext.parentMessageId ? `Reply to: ${channelContext.parentMessageId}` : "",
      channelContext.memberIds.length ? `Members: ${channelContext.memberIds.slice(0, 6).join(", ")}` : "",
      `Auto mode (self-judge): ${channelContext.autoModeDefault || channelContext.selfJudge ? "on" : "off"}`,
    ].filter(Boolean).join("; "),
    280
  );
}

// Goal 08: build the context pack assembled before a run starts. Collects the
// repo summary, relevant files (excerpts), recent diffs, prior failures, user
// preferences, active route, and available screenshots — scoped to the selected
// workspace. Returns a manifest with `included`/`omitted` sections, a compact
// model-facing summary, and source links for everything that overflows the
// model budget.
function generateContextPack(mode, payload, agentRuntime, workspace) {
  const agent = payload?.agent && typeof payload.agent === "object" ? payload.agent : {};
  const task = payload?.task && typeof payload.task === "object" ? payload.task : null;
  const activeRoute = String(payload?.activeRoute || payload?.route || "").trim();
  const pinned = Array.isArray(payload?.pinnedFiles) ? payload.pinnedFiles.filter((p) => typeof p === "string") : [];
  const requestedFiles = Array.isArray(payload?.contextFiles) ? payload.contextFiles.filter((p) => typeof p === "string") : [];
  const omitted = [];

  // Repo summary + workspace file inventory (already workspace-scoped + ignore-aware).
  let allFiles = [];
  try {
    allFiles = listGitWorkspaceFiles(workspace) || [];
  } catch {
    allFiles = [];
  }
  const repoKind = existsSync(join(workspace, ".git")) ? "git repo" : "project";
  const repoSummary = {
    workspace,
    label: relative(homeDir, workspace) || basename(workspace),
    kind: repoKind,
    fileCount: allFiles.length,
  };

  // Relevant files: pinned + explicitly requested first (pinned bypasses
  // ranking but still counts against the budget), then a small sample.
  const ordered = [];
  const seen = new Set();
  for (const rel of [...pinned, ...requestedFiles]) {
    if (rel && !seen.has(rel) && allFiles.includes(rel)) {
      seen.add(rel);
      ordered.push({ path: rel, pinned: pinned.includes(rel) });
    }
  }
  for (const rel of allFiles) {
    if (ordered.length >= contextPackMaxRelevantFiles) break;
    if (seen.has(rel)) continue;
    seen.add(rel);
    ordered.push({ path: rel, pinned: false });
  }
  if (allFiles.length > ordered.length) {
    omitted.push({
      section: "files",
      reason: "ranking-budget",
      detail: `${allFiles.length - ordered.length} additional workspace file(s) not excerpted; available via source links.`,
    });
  }

  const includedFiles = [];
  let totalExcerptChars = 0;
  for (const entry of ordered) {
    const excerpt = contextPackFileExcerpt(workspace, entry.path);
    if (!excerpt) {
      omitted.push({ section: "files", path: entry.path, reason: "unreadable" });
      continue;
    }
    if (excerpt.omitted) {
      omitted.push({
        section: "files",
        path: entry.path,
        reason: excerpt.reason === "large-file" ? "large-file" : excerpt.reason,
        bytes: excerpt.bytes,
        detail: excerpt.reason === "large-file"
          ? `File is ${approxKb(excerpt.bytes)} KB (> ${approxKb(contextPackLargeFileBytes)} KB); excerpt omitted, source linked.`
          : "File could not be read as text; source linked.",
      });
      continue;
    }
    totalExcerptChars += excerpt.excerpt.length;
    includedFiles.push({ ...excerpt, pinned: entry.pinned });
  }

  const diff = contextPackRecentDiff(workspace);
  if (!diff) {
    omitted.push({ section: "diffs", reason: repoKind === "git repo" ? "no-recent-changes" : "not-a-git-repo" });
  }

  const failures = contextPackPriorFailures(payload, workspace);
  for (const failure of failures.omitted) {
    omitted.push({ section: "priorFailures", reason: failure.reason, detail: failure.summary });
  }

  const preferences = contextPackUserPreferences(agent);

  // Screenshots: from the launch payload (captured feedback), workspace-scoped.
  const payloadShots = Array.isArray(payload?.screenshots) ? payload.screenshots.filter(Boolean) : [];
  const screenshots = payloadShots.slice(0, contextPackMaxScreenshots).map((shot) => ({
    label: clampSummary(typeof shot === "string" ? shot : shot?.label || shot?.path || "screenshot", 120),
    path: typeof shot === "string" ? shot : String(shot?.path || ""),
    route: typeof shot === "object" ? String(shot?.route || activeRoute || "") : activeRoute,
  }));
  if (payloadShots.length > screenshots.length) {
    omitted.push({ section: "screenshots", reason: "budget", detail: `${payloadShots.length - screenshots.length} additional screenshot(s) not embedded.` });
  }

  const totalChars =
    totalExcerptChars +
    (diff?.stat?.length || 0) +
    preferences.join("").length +
    failures.included.reduce((sum, f) => sum + (f.summary?.length || 0), 0);

  const summaryParts = [
    `${includedFiles.length} file excerpt(s)`,
    diff ? `${diff.changedFiles} changed file(s) in recent diff` : "no recent diff",
    `${failures.included.length} prior failure(s)`,
    `${screenshots.length} screenshot(s)`,
  ];
  const summary = `Context pack for ${repoSummary.label}: ${summaryParts.join(", ")}.`;

  const id = `pack_${contextHash({ workspace, mode, files: includedFiles.map((f) => f.path), at: Date.now() }).slice(7, 19)}`;

  const pack = {
    id,
    version: 1,
    mode,
    workspace,
    activeRoute: activeRoute || null,
    taskId: task?.id ? String(task.id) : null,
    generatedAt: new Date().toISOString(),
    summary,
    softTokenBudget: 20_000,
    approxTokens: approxTokens(totalChars),
    included: {
      repoSummary,
      files: includedFiles,
      recentDiff: diff,
      priorFailures: failures.included,
      userPreferences: preferences,
      activeRoute: activeRoute || null,
      screenshots,
    },
    omitted,
    counts: {
      files: includedFiles.length,
      diffs: diff ? 1 : 0,
      priorFailures: failures.included.length,
      screenshots: screenshots.length,
      omitted: omitted.length,
    },
  };
  // The compact model-facing view ships truncated excerpts + source refs; the
  // full manifest above keeps richer metadata for inspection.
  pack.modelView = contextPackModelView(pack);
  return pack;
}

// Produce the compact, model-facing view of a stored context pack. The full
// manifest (with whole excerpts) stays server-side; the model prompt gets
// truncated excerpts and source links for overflow.
function contextPackModelView(pack) {
  if (!pack || typeof pack !== "object") return null;
  const included = pack.included || {};
  return {
    id: pack.id,
    summary: pack.summary,
    repoSummary: included.repoSummary || null,
    files: (included.files || []).map((file) => ({
      path: file.path,
      pinned: Boolean(file.pinned),
      truncated: Boolean(file.truncated),
      excerpt: file.excerpt,
      sourceRef: file.sourceRef || file.path,
    })),
    recentDiff: included.recentDiff
      ? { stat: included.recentDiff.stat, recentCommits: included.recentDiff.recentCommits }
      : null,
    priorFailures: (included.priorFailures || []).map((failure) => failure.summary),
    userPreferences: included.userPreferences || [],
    activeRoute: included.activeRoute || null,
    screenshots: (included.screenshots || []).map((shot) => shot.label),
    omittedCount: pack.counts?.omitted || 0,
  };
}

// Assemble the ordered context layers used for a run/chat in any mode
// (chat, prompt, auto, goal). Every defined layer is always returned; omitted
// layers are marked included:false with a reason so nothing is silently skipped.
function assembleContextLayers(mode, payload, agentRuntime) {
  const agent = payload?.agent && typeof payload.agent === "object" ? payload.agent : {};
  const agentId = agentRuntime?.agentId || agent.id || payload?.agentId || "";
  const prompt = String(payload?.prompt || "").trim();
  const memoryItems = Array.isArray(agent.memory) ? agent.memory.filter(Boolean) : [];
  const projects = normalizeAgentProjects(agent, agentRuntime?.workspace || "", true);
  const contextPack = payload?.contextPack && typeof payload.contextPack === "object" ? payload.contextPack : null;
  const channelContext = channelContextFromPayload(payload);
  const collaborationSummary = [collaborationLayerSummary(payload?.collaboration), channelLayerSummary(channelContext)]
    .filter(Boolean)
    .join(" ");
  const taskId = String(payload?.taskId || payload?.task?.id || contextPack?.taskId || "");
  const layers = [];

  layers.push({
    name: "systemContract",
    included: true,
    source: "app:system-contract",
    sourceKey: null,
    sourceRef: "versioned-app",
    contentHash: contextHash(contextLayerStatic.systemContract),
    summary: contextLayerStatic.systemContract,
  });

  layers.push({
    name: "teamOperatingRules",
    included: true,
    source: "app:team-operating-rules",
    sourceKey: null,
    sourceRef: "versioned-app",
    contentHash: contextHash(contextLayerStatic.teamOperatingRules),
    summary: contextLayerStatic.teamOperatingRules,
  });

  const brainCard = agentRuntime?.brainCard || agent.brainCard || null;
  const profilePath = agentRuntime?.profileDocs?.displayPath || "";
  if (brainCard || profilePath) {
    layers.push({
      name: "agentRoleProfile",
      included: true,
      source: profilePath || "agent:role-profile",
      sourceKey: agentId || null,
      sourceRef: "agent",
      contentHash: contextHash({ brainCard, profilePath }),
      summary: clampSummary(
        brainCard?.purpose ||
          agent.role ||
          (profilePath ? `Role profile docs at ${profilePath}` : "Agent role profile")
      ),
    });
  } else {
    layers.push({
      name: "agentRoleProfile",
      included: false,
      source: null,
      sourceKey: agentId || null,
      sourceRef: "agent",
      contentHash: null,
      summary: "",
      reason: "Role profile not configured for this squad member.",
    });
  }

  if (memoryItems.length) {
    layers.push({
      name: "projectMemory",
      included: true,
      source: "agent:memory",
      sourceKey: agentId || null,
      sourceRef: "memory",
      contentHash: contextHash(memoryItems),
      summary: clampSummary(`${memoryItems.length} saved memory item(s): ${memoryItems.slice(0, 3).join("; ")}`),
    });
  } else {
    layers.push({
      name: "projectMemory",
      included: false,
      source: null,
      sourceKey: agentId || null,
      sourceRef: "memory",
      contentHash: null,
      summary: "",
      reason: "No durable project memory configured.",
    });
  }

  if (contextPack || projects.length || collaborationSummary) {
    const packSummary = contextPack?.summary
      ? clampSummary(contextPack.summary)
      : projects.length
        ? clampSummary(`${projects.length} project path(s): ${projects.map((project) => project.label || project.name).slice(0, 3).join("; ")}`)
        : collaborationSummary;
    layers.push({
      name: "taskContextPack",
      included: true,
      source: contextPack ? "task:context-pack" : collaborationSummary ? "task:collaboration-handoff" : "agent:projects",
      sourceKey: taskId || contextPack?.id || null,
      sourceRef: "task",
      contentHash: contextHash(contextPack || { projects, collaboration: payload?.collaboration || null, channel: channelContext }),
      summary: collaborationSummary && packSummary !== collaborationSummary ? `${packSummary} ${collaborationSummary}` : packSummary,
    });
  } else {
    layers.push({
      name: "taskContextPack",
      included: false,
      source: null,
      sourceKey: taskId || null,
      sourceRef: "task",
      contentHash: null,
      summary: "",
      reason: "No task context pack or project paths attached.",
    });
  }

  if (mode === "permissions" || !prompt) {
    layers.push({
      name: "userRequest",
      included: false,
      source: null,
      sourceKey: null,
      sourceRef: "run",
      contentHash: null,
      summary: "",
      reason: mode === "permissions" ? "Permissions check carries no user request." : "No user request text in this run.",
    });
  } else {
    layers.push({
      name: "userRequest",
      included: true,
      source: `run:${mode}`,
      sourceKey: null,
      sourceRef: "run",
      contentHash: contextHash(prompt),
      summary: clampSummary(prompt),
    });
  }

  // The tool/result transcript is produced while the run executes; recorded as a
  // placeholder layer at assembly time and refreshed from logs in runSummary().
  layers.push({
    name: "toolTranscript",
    included: false,
    source: "run:transcript",
    sourceKey: null,
    sourceRef: "run",
    contentHash: null,
    summary: "",
    reason: "Tool and result transcript is captured while the run executes.",
  });

  return {
    appVersion: "web-prototype",
    mode,
    assembledAt: new Date().toISOString(),
    order: contextLayerOrder.slice(),
    layers,
  };
}

// Build the ordered context manifest for a chat exchange and reflect the
// resulting trace into the toolTranscript layer so it is recorded, not skipped.
function chatContextLayers(payload, agentRuntime, trace) {
  const manifest = assembleContextLayers("chat", payload, agentRuntime);
  const transcript = manifest.layers.find((layer) => layer.name === "toolTranscript");
  if (transcript) {
    const steps = Array.isArray(trace?.steps) ? trace.steps : [];
    const toolCount = Array.isArray(trace?.toolCalls) ? trace.toolCalls.length : steps.length;
    if (toolCount || trace?.reply) {
      transcript.included = true;
      transcript.contentHash = contextHash(trace?.reply || JSON.stringify(steps));
      transcript.summary = clampSummary(
        toolCount ? `${toolCount} tool/result step(s) recorded for this chat reply.` : "Chat reply transcript recorded."
      );
      delete transcript.reason;
    }
  }
  return manifest;
}

// Reflect the live tool/result transcript into the recorded context manifest so
// the toolTranscript layer is present rather than silently skipped after a run.
function finalizeContextLayers(run) {
  const manifest = run?.contextLayers;
  if (!manifest || !Array.isArray(manifest.layers)) return manifest;
  const transcript = manifest.layers.find((layer) => layer.name === "toolTranscript");
  if (!transcript) return manifest;
  const logLines = Array.isArray(run.logs) ? run.logs : [];
  if (logLines.length) {
    transcript.included = true;
    transcript.contentHash = contextHash(logLines.map((log) => log.line || "").join("\n"));
    transcript.summary = clampSummary(`${logLines.length} transcript line(s) recorded for this run.`);
    delete transcript.reason;
  }
  return manifest;
}

// Goal 07: Evaluation Hooks — assess a completed run against deterministic
// trust checks. Each check links back to the run log lines or command it
// inspected, never claims certainty when evidence is missing (state="unknown"),
// and records a reason for skipped/unknown states. Failed checks surface as
// unresolved risk in the UI. This runs only after a run has finished.
const RUN_FILE_PATH_RE =
  /(?:^|[\s(["'`])([~./\w@-]+\/[\w@./-]+\.(?:[cm]?[jt]sx?|vue|css|scss|md|json|mjs|cjs|rs|py|html|ya?ml|toml|sh|go|rb)|[\w@.-]+\.(?:[cm]?[jt]sx?|vue|css|scss|md|json|mjs|cjs|rs|py|html|ya?ml|toml|sh|go|rb))/gi;
const RUN_VERIFY_RE =
  /\b(test|tests|build|lint|typecheck|cargo build|cargo test|cargo check|npm (?:run )?(?:test|build)|bun (?:run )?(?:test|build)|node --check|vitest|jest|pytest|playwright)\b/i;
const RUN_VERIFY_PASS_RE = /\b(pass(?:ed|ing)?|ok|success(?:ful)?|built in|0 failures|✓|all checks passed|exit code 0|exited with code 0)\b/i;
const RUN_VERIFY_FAIL_RE = /\b(fail(?:ed|ing|ures?)?|error|✗|exit code [1-9]|exited with code [1-9])\b/i;
const RUN_USER_EVIDENCE_RE = /\b(screenshot|preview|deploy(?:ed|ment)?|url|http(?:s)?:\/\/|rendered|demo|recording)\b/i;
const RUN_UNSUPPORTED_CLAIM_RE =
  /\b(should (?:now )?work|likely works|probably (?:works|fixed)|i (?:believe|assume|think it)|appears? to (?:work|be fixed)|seems? (?:to work|fine)|done(?:!|\.)? (?:without|no) (?:test|verif))\b/i;

function evidenceRef(source, label, detail = "") {
  return { source, label: clampSummary(label, 160), detail: clampSummary(detail, 200) };
}

function evaluateRun(run) {
  if (!run || !["completed", "failed", "stopped"].includes(run.status)) return null;
  const logLines = Array.isArray(run.logs) ? run.logs : [];
  const logText = logLines.map((log) => String(log.line || "")).join("\n");
  const command = String(run.command || "");
  const combined = `${command}\n${logText}`;
  const changedFiles = Array.from(new Set((logText.match(RUN_FILE_PATH_RE) || []).map((m) => m.replace(/^[\s(["'`]+/, "").replace(/[),.;:"'`]+$/, "")).filter(Boolean)));
  const allowedPaths = Array.isArray(run.contextLayers?.layers)
    ? run.contextLayers.layers.filter((layer) => layer.sourceRef === "task" && layer.included).length
    : 0;
  const checks = [];

  // 1. File citations (deterministic): did the run reference specific files?
  if (changedFiles.length) {
    checks.push({
      id: "citations",
      state: "pass",
      decision: "deterministic",
      confidence: "high",
      reason: `${changedFiles.length} file path(s) cited in run output.`,
      evidence: changedFiles.slice(0, 6).map((path) => evidenceRef("file", path, "Cited in run output.")),
    });
  } else {
    checks.push({
      id: "citations",
      state: "unknown",
      decision: "deterministic",
      confidence: "low",
      reason: "No file paths were detected in run output, so citation coverage cannot be confirmed.",
      evidence: [],
    });
  }

  // 2. Verification run (deterministic where possible, else skip with reason).
  const verifyLines = logLines.filter((log) => RUN_VERIFY_RE.test(String(log.line || "")));
  if (RUN_VERIFY_RE.test(command) || verifyLines.length) {
    const verifyText = `${RUN_VERIFY_RE.test(command) ? command : ""}\n${verifyLines.map((l) => l.line).join("\n")}`;
    const failed = RUN_VERIFY_FAIL_RE.test(verifyText) && !RUN_VERIFY_PASS_RE.test(verifyText);
    const passed = RUN_VERIFY_PASS_RE.test(verifyText) || run.exitCode === 0;
    checks.push({
      id: "verification",
      state: failed ? "fail" : passed ? "pass" : "unknown",
      decision: "deterministic",
      confidence: passed || failed ? "high" : "low",
      reason: failed
        ? "A verification command reported a failure or non-zero exit."
        : passed
          ? "A verification command ran and reported success."
          : "A verification command ran but its result could not be parsed.",
      evidence: [
        RUN_VERIFY_RE.test(command) ? evidenceRef("command", command, "Verification command for this run.") : null,
        ...verifyLines.slice(0, 4).map((log) => evidenceRef("run-log", log.line, log.at || "")),
      ].filter(Boolean),
    });
  } else {
    checks.push({
      id: "verification",
      state: "skip",
      decision: "deterministic",
      confidence: "high",
      reason: "No verification command (test, build, lint, typecheck) was available in this run.",
      evidence: [],
    });
  }

  // 3. Scoped changes (deterministic): did changes stay within attached paths?
  if (!changedFiles.length) {
    checks.push({
      id: "scope",
      state: "skip",
      decision: "deterministic",
      confidence: "high",
      reason: "No file changes were detected, so change scope does not apply.",
      evidence: [],
    });
  } else if (allowedPaths) {
    checks.push({
      id: "scope",
      state: "pass",
      decision: "deterministic",
      confidence: "medium",
      reason: `${changedFiles.length} changed file(s) align with the attached task context pack.`,
      evidence: changedFiles.slice(0, 6).map((path) => evidenceRef("file", path, "Changed within attached scope.")),
    });
  } else {
    checks.push({
      id: "scope",
      state: "unknown",
      decision: "deterministic",
      confidence: "low",
      reason: "Changed files were detected but no task context pack defined the intended scope to compare against.",
      evidence: changedFiles.slice(0, 6).map((path) => evidenceRef("file", path, "Changed file.")),
    });
  }

  // 4. User-facing evidence (deterministic signal).
  const userEvidenceLines = logLines.filter((log) => RUN_USER_EVIDENCE_RE.test(String(log.line || "")));
  if (userEvidenceLines.length) {
    checks.push({
      id: "user-evidence",
      state: "pass",
      decision: "deterministic",
      confidence: "medium",
      reason: "Run output references user-facing evidence (screenshot, preview, or deploy).",
      evidence: userEvidenceLines.slice(0, 4).map((log) => evidenceRef("run-log", log.line, log.at || "")),
    });
  } else {
    checks.push({
      id: "user-evidence",
      state: "unknown",
      decision: "deterministic",
      confidence: "low",
      reason: "No user-facing artifact (screenshot, preview, deploy) was detected in run output.",
      evidence: [],
    });
  }

  // 5. Unsupported claims (model-assisted heuristic; flag, do not assert).
  const claimLines = logLines.filter((log) => RUN_UNSUPPORTED_CLAIM_RE.test(String(log.line || "")));
  const verificationPassed = checks.find((c) => c.id === "verification")?.state === "pass";
  if (claimLines.length && !verificationPassed) {
    checks.push({
      id: "unsupported-claims",
      state: "fail",
      decision: "model",
      confidence: "medium",
      reason: "Run output contains success-style language without a passing verification check to back it.",
      evidence: claimLines.slice(0, 4).map((log) => evidenceRef("run-log", log.line, log.at || "")),
    });
  } else if (claimLines.length) {
    checks.push({
      id: "unsupported-claims",
      state: "pass",
      decision: "model",
      confidence: "low",
      reason: "Success-style language appears but a passing verification check supports it.",
      evidence: claimLines.slice(0, 2).map((log) => evidenceRef("run-log", log.line, log.at || "")),
    });
  } else {
    checks.push({
      id: "unsupported-claims",
      state: "unknown",
      decision: "model",
      confidence: "low",
      reason: "Not enough final-answer text was captured to judge whether claims are supported.",
      evidence: [],
    });
  }

  const failed = checks.filter((c) => c.state === "fail").length;
  const passed = checks.filter((c) => c.state === "pass").length;
  const summaryState = failed ? "some-fail" : passed === checks.length ? "all-pass" : "incomplete";

  return {
    evaluatedAt: run.finishedAt || new Date().toISOString(),
    evaluatorNote:
      summaryState === "all-pass"
        ? "All trust checks passed against recorded run evidence."
        : summaryState === "some-fail"
          ? "One or more trust checks failed; treat as low-trust pending review."
          : "Some checks could not be determined from available evidence; no certainty is claimed.",
    summaryState,
    passed,
    failed,
    total: checks.length,
    contentHash: contextHash(`${combined}\n${checks.map((c) => `${c.id}:${c.state}`).join(",")}`),
    checks,
  };
}

function runSummary(run) {
  return {
    id: run.id,
    agentId: run.agentId,
    title: run.title,
    mode: run.mode,
    workspace: run.workspace,
    configPath: run.configPath,
    displayConfigPath: run.displayConfigPath,
    agentHome: run.agentHome,
    effectiveModel: run.effectiveModel || null,
    skillInstall: run.skillInstall,
    profileDocs: run.profileDocs,
    brainCard: run.brainCard,
    transport: run.transport || "cli",
    command: run.command,
    logPath: run.logPath,
    status: run.status,
    exitCode: run.exitCode,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    channel: run.channel || null,
    contextPack: run.contextPack || null,
    contextLayers: finalizeContextLayers(run),
    evaluation: evaluateRun(run),
    logs: run.logs.slice(-260),
  };
}

function isLiveRun(run) {
  return ["queued", "running", "launching"].includes(run?.status);
}

async function stopManagedRuns(reason = "service stopped") {
  let stoppedRuns = 0;
  for (const run of runs.values()) {
    if (!isLiveRun(run)) continue;
    const child = run.process;
    if (child && !childHasExited(child)) {
      try {
        terminateChildProcess(child, {
          onForce: () => appendLog(run, "system", "Autohand CLI did not stop after SIGTERM; forcing stop"),
        });
        stoppedRuns += 1;
      } catch (error) {
        appendLog(run, "system", `stop failed: ${error.message}`);
      }
    }
    if (run.sdk) {
      try {
        await run.sdk.interrupt?.();
        await run.sdk.close?.();
        stoppedRuns += 1;
      } catch (error) {
        appendLog(run, "system", `SDK stop failed: ${error.message}`);
      } finally {
        run.sdk = null;
      }
    }
    run.status = "stopped";
    run.finishedAt = new Date().toISOString();
    appendLog(run, "system", reason);
  }
  return { stoppedRuns };
}

function shutdownServer() {
  if (shuttingDown) return;
  shuttingDown = true;
  setTimeout(() => {
    const exit = () => process.exit(0);
    if (server) {
      server.close(exit);
      setTimeout(exit, 750).unref();
    } else {
      exit();
    }
  }, 50).unref();
}

function appendLog(run, source, chunk) {
  const lines = String(chunk)
    .replace(/\u001b\[[0-9;]*m/g, "")
    .split(/\r?\n/)
    .filter(Boolean);
  for (const line of lines) {
    run.logs.push({ source, line, at: new Date().toISOString() });
  }
  if (run.logs.length > maxRunLogLines) run.logs.splice(0, run.logs.length - maxRunLogLines);
  if (run.logPath) {
    const rawLog = run.logs.map((log) => `[${log.at || ""}] [${log.source || "run"}] ${log.line || ""}`).join("\n");
    void mkdir(dirname(run.logPath), { recursive: true })
      .then(() => writeFile(run.logPath, rawLog ? `${rawLog}\n` : ""))
      .catch(() => {});
  }
}

function stripAnsi(value) {
  return String(value || "")
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function safeCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count) || count < 0) return 0;
  return Math.floor(count);
}

function nonEmptyString(value) {
  const text = String(value || "").trim();
  return text ? text : null;
}

function boundedString(value, fallback = "", maxLength = 160) {
  const text = String(value || fallback || "").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function normalizeLiveStatusMember(item = {}) {
  const id = boundedString(item.id, "", 96);
  const name = boundedString(item.name, "Squad member", 80);
  if (!id || !name) return null;
  return {
    id,
    name,
    role: nonEmptyString(boundedString(item.role, "", 80)),
    status: boundedString(item.status, "online", 32).toLowerCase(),
    working: Boolean(item.working),
    queuedJobs: safeCount(item.queuedJobs),
    scheduledJobs: safeCount(item.scheduledJobs),
    lastActivityAt: nonEmptyString(boundedString(item.lastActivityAt, "", 80)),
  };
}

function normalizeLiveStatusJob(item = {}) {
  const id = boundedString(item.id, "", 96);
  const title = boundedString(item.title, "Squad job", 120);
  if (!id || !title) return null;
  return {
    id,
    title,
    status: boundedString(item.status, "queued", 32).toLowerCase(),
    agentId: nonEmptyString(boundedString(item.agentId, "", 96)),
    agentName: nonEmptyString(boundedString(item.agentName, "", 80)),
    source: nonEmptyString(boundedString(item.source, "", 48)),
    workspace: nonEmptyString(boundedString(item.workspace, "", 180)),
    scheduledFor: nonEmptyString(boundedString(item.scheduledFor, "", 80)),
    updatedAt: nonEmptyString(boundedString(item.updatedAt, "", 80)),
  };
}

function normalizeLiveStatusAutomation(item = {}) {
  const id = boundedString(item.id, "", 96);
  const name = boundedString(item.name, "Workflow", 120);
  if (!id || !name) return null;
  return {
    id,
    name,
    status: boundedString(item.status, "active", 32).toLowerCase(),
    agentId: nonEmptyString(boundedString(item.agentId, "", 96)),
    agentName: nonEmptyString(boundedString(item.agentName, "", 80)),
    triggerType: nonEmptyString(boundedString(item.triggerType, "", 48)),
    schedule: nonEmptyString(boundedString(item.schedule, "", 120)),
    workspace: nonEmptyString(boundedString(item.workspace, "", 180)),
    updatedAt: nonEmptyString(boundedString(item.updatedAt, "", 80)),
  };
}

function normalizeLiveStatusSnapshot(input = {}) {
  const updatedAt = new Date().toISOString();
  return {
    source: "web-console",
    updatedAt,
    lastActivityAt: nonEmptyString(input.lastActivityAt) || updatedAt,
    currentRoute: normalizeFeedbackRoute(input.currentRoute || "/mission-control"),
    onlineMembers: safeCount(input.onlineMembers),
    workingAgents: safeCount(input.workingAgents),
    queuedJobs: safeCount(input.queuedJobs),
    scheduledJobs: safeCount(input.scheduledJobs),
    activeWork: safeCount(input.activeWork),
    queueDepth: safeCount(input.queueDepth),
    totalRuns: safeCount(input.totalRuns),
    members: (Array.isArray(input.members) ? input.members : [])
      .map(normalizeLiveStatusMember)
      .filter(Boolean)
      .slice(0, 80),
    jobs: (Array.isArray(input.jobs) ? input.jobs : [])
      .map(normalizeLiveStatusJob)
      .filter(Boolean)
      .slice(0, 80),
    automations: (Array.isArray(input.automations) ? input.automations : [])
      .map(normalizeLiveStatusAutomation)
      .filter(Boolean)
      .slice(0, 80),
  };
}

async function writeLiveStatusSnapshot(input) {
  const snapshot = normalizeLiveStatusSnapshot(input);
  await mkdir(squadStateDir, { recursive: true });
  await writeFile(liveStatusPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  return snapshot;
}

function normalizeFeedbackKind(value) {
  return value === "bug" ? "bug" : "feedback";
}

function normalizeFeedbackRoute(value) {
  let route = String(value || "/mission-control").trim();
  if (!route) route = "/mission-control";
  try {
    if (route.startsWith("http://") || route.startsWith("https://")) {
      const parsed = new URL(route);
      route = `${parsed.pathname}${parsed.search}`;
    }
  } catch {
    route = "/mission-control";
  }
  route = route.split("#")[0] || "/mission-control";
  if (!route.startsWith("/")) route = `/${route}`;
  return stripFeedbackModalParams(route).slice(0, 600);
}

function stripFeedbackModalParams(route) {
  const [path, query = ""] = String(route || "/mission-control").split("?");
  if (!query) return path || "/mission-control";
  const params = new URLSearchParams(query);
  params.delete("feedback");
  params.delete("about");
  const nextQuery = params.toString();
  return nextQuery ? `${path || "/mission-control"}?${nextQuery}` : path || "/mission-control";
}

function sanitizeFeedbackText(value, maxLength = 12000) {
  let text = String(value || "");
  if (!text) return "";
  text = text.replaceAll(homeDir, "~");
  text = text.replace(/\/Users\/[^/\s:]+/g, "~/...");
  text = text.replace(/\/home\/[^/\s:]+/g, "~/...");
  text = text.replace(/[A-Z]:\\Users\\[^\\\s:]+/gi, "~\\...");
  text = text.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[EMAIL_REDACTED]");
  text = text.replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, "Bearer [TOKEN_REDACTED]");
  text = text.replace(/(api[_-]?key|token|secret|password|pwd|pass)\s*[:=]\s*['"]?[^'"\s;&]+/gi, "$1=[REDACTED]");
  text = text.replace(/sk-[a-zA-Z0-9]{20,}/gi, "[API_KEY_REDACTED]");
  text = text.replace(/gh[pousr]_[a-zA-Z0-9]{36}/g, "[GITHUB_TOKEN_REDACTED]");
  text = text.replace(/eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/g, "[JWT_REDACTED]");
  text = text.replace(/-----BEGIN (RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----/g, "[PRIVATE_KEY_REDACTED]");
  return text.length > maxLength ? `${text.slice(0, maxLength)}\n[truncated]` : text;
}

function folderNameOnly(path) {
  const name = basename(String(path || "").replace(/\/+$/, ""));
  return sanitizeFeedbackText(name, 120);
}

async function ensureFeedbackDeviceId() {
  try {
    const existing = (await readFile(squadDeviceIdPath, "utf8")).trim();
    if (existing) return existing;
  } catch {
    // Create a local anonymous id below.
  }
  const deviceId = `device-${process.pid}-${Date.now()}`;
  await mkdir(dirname(squadDeviceIdPath), { recursive: true });
  await writeFile(squadDeviceIdPath, deviceId, "utf8");
  return deviceId;
}

function lineTimestampMs(line, fallbackMs) {
  const text = String(line || "");
  const unixMatch = text.match(/unix-ms:(\d{10,})/);
  if (unixMatch) return Number(unixMatch[1]);
  const isoMatch = text.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/);
  if (isoMatch) {
    const parsed = Date.parse(isoMatch[0]);
    if (Number.isFinite(parsed)) return parsed;
  }
  try {
    const parsed = JSON.parse(text);
    const timestamp = parsed.timestamp || parsed.updatedAt || parsed.createdAt || parsed.at;
    if (timestamp) {
      const parsedMs = Date.parse(String(timestamp));
      if (Number.isFinite(parsedMs)) return parsedMs;
    }
  } catch {
    // Plain text log line.
  }
  return fallbackMs;
}

async function readRecentLogFile(path, source, cutoffMs) {
  try {
    const info = await stat(path);
    const fallbackMs = info.mtimeMs;
    if (fallbackMs < cutoffMs) return [];
    const content = await readFile(path, "utf8");
    return content
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-120)
      .map((line) => ({
        source,
        timestamp: new Date(lineTimestampMs(line, fallbackMs)).toISOString(),
        line: sanitizeFeedbackText(line, 1200),
      }))
      .filter((entry) => Date.parse(entry.timestamp) >= cutoffMs)
      .slice(-40);
  } catch {
    return [];
  }
}

async function collectRecentFeedbackLogs() {
  const cutoffMs = Date.now() - 60 * 1000;
  const candidates = [
    [join(squadStateDir, "server.log"), "squad-daemon"],
    [join(squadStateDir, "tray.log"), "squad-tray"],
    [join(squadStateDir, "web-server.log"), "web-server"],
    [join(squadStateDir, "analytics.log"), "squad-analytics"],
    [join(squadStateDir, "telemetry.jsonl"), "squad-telemetry"],
  ];
  try {
    const entries = await readdir(runLogsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".log")) {
        candidates.push([join(runLogsDir, entry.name), "web-run"]);
      }
    }
  } catch {
    // Run logs are optional.
  }

  const batches = await Promise.all(candidates.map(([path, source]) => readRecentLogFile(path, source, cutoffMs)));
  return batches.flat().sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp))).slice(-120);
}

async function collectFeedbackContext(route) {
  const runtime = getRuntime();
  const workspaces = await listWorkspaces().catch(() => []);
  const install = await readOptionalJsonFile(join(squadStateDir, "install.json"));
  const liveStatus = await readOptionalJsonFile(liveStatusPath);
  const logs = await collectRecentFeedbackLogs();
  const folderNames = Array.from(
    new Set(
      workspaces
        .map((workspace) => folderNameOnly(workspace.path || workspace.name || workspace.label))
        .filter(Boolean)
    )
  ).slice(0, 24);

  return {
    route: normalizeFeedbackRoute(route),
    squadVersion: packageMetadata.version || "0.0.0",
    installedVersion: sanitizeFeedbackText(install?.version || "", 120),
    autohandVersion: sanitizeFeedbackText(runtime.version || "", 200),
    platform: `${osPlatform()}-${arch()}`,
    osVersion: osRelease(),
    folderNames,
    logs,
    logCount: logs.length,
    generatedAt: new Date().toISOString(),
    liveStatus: liveStatus
      ? {
          onlineMembers: safeCount(liveStatus.onlineMembers),
          workingAgents: safeCount(liveStatus.workingAgents),
          activeWork: safeCount(liveStatus.activeWork),
          queuedJobs: safeCount(liveStatus.queuedJobs),
        }
      : null,
  };
}

function chromeCandidates() {
  return [
    process.env.CHROME_PATH,
    process.env.AUTOHAND_SQUAD_CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    commandOutput("which", ["google-chrome"]),
    commandOutput("which", ["chromium"]),
    commandOutput("which", ["chromium-browser"]),
  ].filter(Boolean);
}

function findChromiumBinary() {
  return chromeCandidates().find((candidate) => existsSync(candidate)) || "";
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForChromeDevtools(child) {
  return new Promise((resolve, reject) => {
    let stderr = "";
    const timer = setTimeout(() => reject(new Error("Chromium did not expose a DevTools endpoint")), 7000);
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("Chromium exited before screenshot capture"));
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function pageWebSocketUrl(browserWsUrl) {
  const browserUrl = new URL(browserWsUrl);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(`http://${browserUrl.host}/json`);
    const pages = await response.json();
    const page = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
    if (page) return page.webSocketDebuggerUrl;
    await delay(100);
  }
  throw new Error("Chromium page target was not available");
}

async function createCdpClient(wsUrl) {
  const socket = new WebSocket(wsUrl);
  const pending = new Map();
  const listeners = new Map();
  let nextId = 1;

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Chromium DevTools connection timed out")), 5000);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("Chromium DevTools connection failed"));
    }, { once: true });
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message || "DevTools command failed"));
      else resolve(message.result || {});
      return;
    }
    if (message.method && listeners.has(message.method)) {
      for (const listener of listeners.get(message.method)) listener(message.params || {});
    }
  });

  function send(method, params = {}) {
    const id = nextId;
    nextId += 1;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 7000);
    });
  }

  function waitForEvent(method, timeoutMs = 5000) {
    return new Promise((resolve) => {
      const current = listeners.get(method) || new Set();
      const listener = (params) => {
        current.delete(listener);
        resolve(params);
      };
      current.add(listener);
      listeners.set(method, current);
      setTimeout(() => {
        current.delete(listener);
        resolve(null);
      }, timeoutMs);
    });
  }

  return {
    send,
    waitForEvent,
    close() {
      socket.close();
    },
  };
}

async function cdpNavigate(cdp, url) {
  const load = cdp.waitForEvent("Page.loadEventFired", 6000);
  await cdp.send("Page.navigate", { url });
  await load;
  await delay(500);
}

function storageEntriesForScreenshot(storage = {}) {
  return Object.entries(storage)
    .filter(([key, value]) => typeof key === "string" && typeof value === "string")
    .map(([key, value]) => [key.slice(0, 160), value.slice(0, 750000)])
    .slice(0, 20);
}

async function captureFeedbackScreenshot({ route, storage }) {
  const chrome = findChromiumBinary();
  if (!chrome) {
    return { available: false, error: "Chromium was not found on this machine." };
  }

  const profileDir = await mkdtemp(join(tmpdir(), "autohand-squad-shot-"));
  const child = spawn(chrome, [
    "--headless=new",
    "--hide-scrollbars",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${profileDir}`,
    "--remote-debugging-port=0",
    "--window-size=1440,1100",
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });

  try {
    const browserWsUrl = await waitForChromeDevtools(child);
    const wsUrl = await pageWebSocketUrl(browserWsUrl);
    const cdp = await createCdpClient(wsUrl);
    const baseUrl = `http://${host}:${port}`;
    const targetRoute = normalizeFeedbackRoute(route);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1100,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdpNavigate(cdp, baseUrl);
    const entries = storageEntriesForScreenshot(storage);
    await cdp.send("Runtime.evaluate", {
      expression: `for (const [key, value] of ${JSON.stringify(entries)}) { localStorage.setItem(key, value); }`,
    });
    await cdpNavigate(cdp, `${baseUrl}${targetRoute}`);
    const result = await cdp.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    cdp.close();
    const size = Buffer.byteLength(result.data || "", "base64");
    return {
      available: Boolean(result.data),
      mimeType: "image/png",
      data: result.data || "",
      size,
      width: 1440,
      height: 1100,
      route: targetRoute,
    };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    child.kill();
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
}

function normalizeScreenshotForSubmit(screenshot) {
  if (!screenshot?.data || screenshot.available === false) return null;
  const data = String(screenshot.data || "");
  return {
    mimeType: screenshot.mimeType || "image/png",
    data: data.slice(0, 10 * 1024 * 1024),
    size: Number(screenshot.size) || Buffer.byteLength(data, "base64"),
    width: Number(screenshot.width) || null,
    height: Number(screenshot.height) || null,
  };
}

async function submitSquadFeedback(input = {}) {
  const id = String(input.id || randomUUID());
  const kind = normalizeFeedbackKind(input.kind);
  const route = normalizeFeedbackRoute(input.route);
  const context = input.includeDiagnostics === false ? null : await collectFeedbackContext(route);
  const screenshot = input.includeScreenshot === false ? null : normalizeScreenshotForSubmit(input.screenshot);
  const deviceId = await ensureFeedbackDeviceId();
  const runtime = getRuntime();
  const payload = {
    id,
    kind,
    rating: input.rating ? Number(input.rating) : null,
    description: sanitizeFeedbackText(input.description, 10000),
    userEmail: String(input.userEmail || "").trim().slice(0, 320),
    allowContact: Boolean(input.allowContact && input.userEmail),
    timestamp: new Date().toISOString(),
    deviceId,
    clientType: "squad",
    squadVersion: packageMetadata.version || "0.0.0",
    platform: `${osPlatform()}-${arch()}`,
    osVersion: osRelease(),
    route,
    folderNames: context?.folderNames || [],
    logs: context?.logs || [],
    screenshot,
    context: {
      ...context,
      runtimeAvailable: runtime.available,
      autohandPath: runtime.autohandPath ? "[PATH_REDACTED]" : "",
      serverStartedAt,
    },
  };

  await mkdir(feedbackBackupDir, { recursive: true });
  await writeFile(join(feedbackBackupDir, `${id}.json`), `${JSON.stringify({ ...payload, screenshot: screenshot ? { ...screenshot, data: "[base64 omitted]" } : null }, null, 2)}\n`, "utf8");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${feedbackApiBaseUrl}/v1/feedback/squad`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Client-Type": "squad",
        "X-Client-Version": packageMetadata.version || "0.0.0",
        "X-Device-ID": deviceId,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const apiPayload = await response.json().catch(() => ({}));
    if (!response.ok || apiPayload.success === false) {
      throw new Error(apiPayload.error || `Feedback API returned HTTP ${response.status}`);
    }
    return { id: apiPayload.id || id, storedLocally: true, sent: true };
  } finally {
    clearTimeout(timeout);
  }
}

const memoryScopes = new Set(["personal", "project", "team"]);
const memoryStatuses = new Set(["pending", "accepted", "rejected"]);
const memorySourceTypes = new Set(["conversation", "task", "run", "system"]);

function normalizeMemoryScope(scope) {
  return memoryScopes.has(scope) ? scope : "personal";
}

function normalizeMemoryStatus(status) {
  return memoryStatuses.has(status) ? status : "pending";
}

function normalizeMemoryConfidence(value) {
  const confidence = Number(value);
  return Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5;
}

function normalizeMemoryProjectIdentity(item = {}) {
  const source = item.source && typeof item.source === "object" ? item.source : {};
  const rawKey = String(
    item.projectKey ||
      item.projectWorkspace ||
      item.workspace ||
      source.projectKey ||
      source.projectWorkspace ||
      source.workspace ||
      ""
  ).trim();
  const projectKey = rawKey ? normalizeSquadWorkspacePath(rawKey) : "";
  return {
    projectKey,
    projectLabel: String(item.projectLabel || source.projectLabel || basename(projectKey) || projectKey || "").trim(),
  };
}

function normalizeMemoryRecord(item) {
  if (!item || typeof item !== "object") return null;
  const content = String(item.content || item.editedContent || item.proposedContent || "").trim();
  if (!content) return null;
  const createdAt = String(item.createdAt || item.proposedAt || new Date().toISOString());
  const scope = normalizeMemoryScope(item.scope);
  const source = item.source && typeof item.source === "object" ? item.source : {};
  const project = normalizeMemoryProjectIdentity(item);
  return {
    id: String(item.id || randomUUID()),
    agentId: sanitizeAgentId(item.agentId || item.ownerAgentId || "default"),
    ownerAgentId: sanitizeAgentId(item.ownerAgentId || item.agentId || "default"),
    status: normalizeMemoryStatus(item.status),
    scope,
    projectKey: scope === "project" ? project.projectKey : String(item.projectKey || "").trim(),
    projectLabel: scope === "project" ? project.projectLabel : String(item.projectLabel || "").trim(),
    content,
    originalContent: String(item.originalContent || item.proposedContent || content).trim(),
    confidence: normalizeMemoryConfidence(item.confidence),
    confidenceRationale: String(item.confidenceRationale || item.rationale || "").trim(),
    source: {
      type: memorySourceTypes.has(source.type) ? source.type : "conversation",
      id: String(source.id || ""),
      label: String(source.label || source.id || "Source"),
      agentId: sanitizeAgentId(source.agentId || item.ownerAgentId || item.agentId || "default"),
    },
    evidence: String(item.evidence || item.supportingEvidence || "").trim(),
    rejectReason: String(item.rejectReason || "").trim(),
    editHistory: Array.isArray(item.editHistory) ? item.editHistory : [],
    isHidden: item.isHidden === true,
    acceptedAt: String(item.acceptedAt || ""),
    rejectedAt: String(item.rejectedAt || ""),
    createdAt,
    updatedAt: String(item.updatedAt || item.acceptedAt || item.rejectedAt || createdAt),
  };
}

function buildMemoryProjectIndex(items) {
  const projectIndex = {};
  for (const item of items) {
    if (item.scope !== "project" || !item.projectKey) continue;
    const record = projectIndex[item.projectKey] || {
      projectKey: item.projectKey,
      projectLabel: item.projectLabel || basename(item.projectKey),
      itemIds: [],
      pendingItemIds: [],
      acceptedItemIds: [],
      rejectedItemIds: [],
    };
    record.itemIds.push(item.id);
    if (item.status === "pending") record.pendingItemIds.push(item.id);
    if (item.status === "accepted") record.acceptedItemIds.push(item.id);
    if (item.status === "rejected") record.rejectedItemIds.push(item.id);
    projectIndex[item.projectKey] = record;
  }
  return projectIndex;
}

function normalizeMemoryInboxState(input = {}) {
  const rawItems = Array.isArray(input) ? input : Array.isArray(input.items) ? input.items : [];
  const items = rawItems.map(normalizeMemoryRecord).filter(Boolean);
  const updatedAt = new Date().toISOString();
  return {
    version: 1,
    storage: "local-squad-state",
    path: memoryInboxPath,
    updatedAt,
    items,
    projectIndex: buildMemoryProjectIndex(items),
  };
}

async function readMemoryInboxState() {
  const saved = await readOptionalJsonFile(memoryInboxPath);
  return normalizeMemoryInboxState(saved || {});
}

async function writeMemoryInboxState(input) {
  const state = normalizeMemoryInboxState(input);
  await mkdir(squadStateDir, { recursive: true });
  await writeFile(memoryInboxPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return state;
}

// Squad channels: channel-level coordination with public/private visibility,
// per-channel membership, and threaded one-prompt dispatch. State lives in the
// shared squad state dir so the daemon can surface the same channels.json in
// queue/run telemetry after web reloads or daemon restarts.
function normalizeChannelVisibility(value) {
  return value === "private" ? "private" : "public";
}

function normalizeChannelMemberIds(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((id) => String(id || "").trim()).filter(Boolean)));
}

function normalizeChannel(item) {
  if (!item || typeof item !== "object") return null;
  const name = String(item.name || "").trim();
  if (!name) return null;
  const createdAt = String(item.createdAt || new Date().toISOString());
  return {
    id: String(item.id || `channel-${randomUUID()}`),
    name: name.slice(0, 80),
    visibility: normalizeChannelVisibility(item.visibility),
    memberIds: normalizeChannelMemberIds(item.memberIds),
    creatorId: String(item.creatorId || "").trim(),
    // Self-judge / auto-mode execution control is opt-in per channel and
    // always defaults OFF; only an explicit true enables it.
    autoModeDefault: item.autoModeDefault === true,
    createdAt,
    updatedAt: String(item.updatedAt || createdAt),
  };
}

function normalizeChannelThread(item) {
  if (!item || typeof item !== "object") return null;
  const channelId = String(item.channelId || "").trim();
  if (!channelId) return null;
  const createdAt = String(item.createdAt || new Date().toISOString());
  const replyCount = Number(item.replyCount);
  return {
    id: String(item.id || item.threadId || `thread-${randomUUID()}`),
    channelId,
    parentMessageId: String(item.parentMessageId || "").trim(),
    title: String(item.title || item.prompt || "").trim().slice(0, 200),
    creatorId: String(item.creatorId || "").trim(),
    memberIds: normalizeChannelMemberIds(item.memberIds),
    autoMode: item.autoMode === true,
    selfJudge: item.selfJudge === true,
    replyCount: Number.isFinite(replyCount) && replyCount > 0 ? Math.floor(replyCount) : 0,
    createdAt,
    updatedAt: String(item.updatedAt || createdAt),
  };
}

function normalizeChannelMessage(item, fallbackChannelId = "") {
  if (!item || typeof item !== "object") return null;
  const id = String(item.id || "").trim();
  const channelId = String(item.channelId || fallbackChannelId || "").trim();
  if (!id || !channelId) return null;
  const createdAt = String(item.createdAt || item.startedAt || new Date().toISOString());
  const role = ["agent", "system", "user"].includes(String(item.role || "")) ? String(item.role) : "agent";
  const durationMs = Number(item.durationMs);
  return {
    ...item,
    id,
    channelId,
    channelName: String(item.channelName || "").trim(),
    role,
    agentId: String(item.agentId || "").trim(),
    body: String(item.body || item.content || item.reply || ""),
    status: String(item.status || "complete").trim() || "complete",
    time: String(item.time || "").trim(),
    threadId: String(item.threadId || "").trim(),
    parentMessageId: String(item.parentMessageId || "").trim(),
    workspace: String(item.workspace || "").trim(),
    transport: String(item.transport || "").trim(),
    command: String(item.command || "").trim(),
    durationMs: Number.isFinite(durationMs) ? durationMs : undefined,
    createdAt,
    updatedAt: String(item.updatedAt || item.completedAt || createdAt),
  };
}

function normalizeChannelMessages(input) {
  if (!input || typeof input !== "object") return [];
  const entries = Array.isArray(input) ? [["", input]] : Object.entries(input);
  const messages = [];
  for (const [channelId, records] of entries) {
    if (!Array.isArray(records)) continue;
    for (const record of records) {
      const message = normalizeChannelMessage(record, channelId);
      if (message) messages.push(message);
    }
  }
  return messages;
}

// Migration-safe: accepts the current { channels, threads } document, a legacy
// bare array of channels, or nothing at all.
function normalizeChannelsState(input) {
  const source = input && typeof input === "object" ? input : {};
  const rawChannels = Array.isArray(input) ? input : Array.isArray(source.channels) ? source.channels : [];
  const channels = rawChannels.map(normalizeChannel).filter(Boolean);
  const channelIds = new Set(channels.map((channel) => channel.id));
  const rawThreads = Array.isArray(source.threads) ? source.threads : [];
  const threads = rawThreads.map(normalizeChannelThread).filter((thread) => thread && channelIds.has(thread.channelId));
  const messages = normalizeChannelMessages(source.messages).filter((message) => channelIds.has(message.channelId));
  return {
    version: 1,
    storage: "local-squad-state",
    path: channelsStatePath,
    updatedAt: String(source.updatedAt || new Date().toISOString()),
    channels,
    threads,
    messages,
  };
}

async function readChannelsState() {
  const saved = await readOptionalJsonFile(channelsStatePath);
  return normalizeChannelsState(saved || {});
}

async function writeChannelsState(input) {
  const state = normalizeChannelsState(input);
  state.updatedAt = new Date().toISOString();
  await mkdir(squadStateDir, { recursive: true });
  await writeFile(channelsStatePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return state;
}

async function createChannel(payload) {
  const channel = normalizeChannel({
    ...payload,
    id: payload?.id || `channel-${randomUUID()}`,
    createdAt: new Date().toISOString(),
  });
  if (!channel) throw new Error("channel name is required");
  const state = await readChannelsState();
  if (state.channels.some((item) => item.id === channel.id)) {
    throw new Error(`channel ${channel.id} already exists`);
  }
  state.channels.push(channel);
  await writeChannelsState(state);
  return channel;
}

async function updateChannel(channelId, patch) {
  const state = await readChannelsState();
  const existing = state.channels.find((item) => item.id === channelId);
  if (!existing) throw new Error("channel not found");
  const source = patch && typeof patch === "object" ? patch : {};
  const next = normalizeChannel({
    ...existing,
    ...(typeof source.name === "string" && source.name.trim() ? { name: source.name } : {}),
    ...(source.visibility !== undefined ? { visibility: source.visibility } : {}),
    ...(Array.isArray(source.memberIds) ? { memberIds: source.memberIds } : {}),
    ...(source.autoModeDefault !== undefined ? { autoModeDefault: source.autoModeDefault === true } : {}),
    id: existing.id,
    creatorId: existing.creatorId,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  });
  state.channels = state.channels.map((item) => (item.id === channelId ? next : item));
  await writeChannelsState(state);
  return next;
}

async function deleteChannel(channelId) {
  const state = await readChannelsState();
  const existing = state.channels.find((item) => item.id === channelId);
  if (!existing) throw new Error("channel not found");
  state.channels = state.channels.filter((item) => item.id !== channelId);
  state.threads = state.threads.filter((item) => item.channelId !== channelId);
  state.messages = state.messages.filter((item) => item.channelId !== channelId);
  await writeChannelsState(state);
  return existing;
}

async function updateChannelMembers(channelId, payload) {
  const state = await readChannelsState();
  const existing = state.channels.find((item) => item.id === channelId);
  if (!existing) throw new Error("channel not found");
  const add = normalizeChannelMemberIds(payload?.add);
  const remove = new Set(normalizeChannelMemberIds(payload?.remove));
  const memberIds = Array.isArray(payload?.memberIds)
    ? normalizeChannelMemberIds(payload.memberIds)
    : existing.memberIds.filter((id) => !remove.has(id)).concat(add.filter((id) => !existing.memberIds.includes(id)));
  const next = { ...existing, memberIds, updatedAt: new Date().toISOString() };
  state.channels = state.channels.map((item) => (item.id === channelId ? next : item));
  await writeChannelsState(state);
  return next;
}

async function recordChannelThread(channelId, payload) {
  const state = await readChannelsState();
  const channel = state.channels.find((item) => item.id === channelId);
  if (!channel) throw new Error("channel not found");
  const thread = normalizeChannelThread({ ...payload, channelId });
  if (!thread) throw new Error("thread could not be recorded");
  const index = state.threads.findIndex((item) => item.id === thread.id);
  if (index === -1) {
    state.threads.push(thread);
  } else {
    state.threads[index] = { ...state.threads[index], ...thread, updatedAt: new Date().toISOString() };
  }
  channel.updatedAt = new Date().toISOString();
  await writeChannelsState(state);
  return thread;
}

// Extract the channel/thread contract from a chat or run payload. The payload
// can carry channelId, threadId, parentMessageId, visibility, memberIds,
// autoModeDefault, and selfJudge intent either at the top level or under a
// `channel` object; absent fields fall back to safe defaults (auto mode OFF).
function channelContextFromPayload(payload) {
  const nested = payload?.channel && typeof payload.channel === "object" ? payload.channel : {};
  const channelId = String(payload?.channelId || nested.channelId || nested.id || "").trim();
  if (!channelId) return null;
  const runtime = payload?.collaboration?.runtime && typeof payload.collaboration.runtime === "object"
    ? payload.collaboration.runtime
    : {};
  return {
    channelId,
    threadId: String(payload?.threadId || nested.threadId || "").trim(),
    parentMessageId: String(payload?.parentMessageId || nested.parentMessageId || "").trim(),
    visibility: normalizeChannelVisibility(payload?.visibility || nested.visibility),
    memberIds: normalizeChannelMemberIds(payload?.memberIds || nested.memberIds),
    autoModeDefault: payload?.autoModeDefault === true || nested.autoModeDefault === true || runtime.autoMode === true,
    selfJudge: payload?.selfJudge === true || nested.selfJudge === true || runtime.selfJudge === true,
    channelName: String(nested.name || nested.channelName || payload?.channelName || "").trim(),
  };
}

// Best-effort thread bookkeeping when a channel prompt or in-thread reply is
// dispatched; never blocks or fails the chat/run itself.
async function recordChannelDispatch(channelContext, { prompt = "", agentId = "" } = {}) {
  if (!channelContext?.channelId || !channelContext.threadId) return;
  try {
    const state = await readChannelsState();
    const channel = state.channels.find((item) => item.id === channelContext.channelId);
    if (!channel) return;
    const existing = state.threads.find((item) => item.id === channelContext.threadId);
    if (existing) {
      existing.replyCount += 1;
      existing.updatedAt = new Date().toISOString();
    } else {
      state.threads.push(
        normalizeChannelThread({
          id: channelContext.threadId,
          channelId: channelContext.channelId,
          parentMessageId: channelContext.parentMessageId,
          title: prompt,
          creatorId: agentId,
          memberIds: channelContext.memberIds,
          autoMode: channelContext.autoModeDefault,
          selfJudge: channelContext.selfJudge,
        })
      );
    }
    channel.updatedAt = new Date().toISOString();
    await writeChannelsState(state);
  } catch {
    // Channel bookkeeping is telemetry-grade; dispatch must not fail on it.
  }
}

async function readOptionalJsonFile(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function readJsonDir(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const values = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => readOptionalJsonFile(join(dir, entry.name)))
    );
    return values.filter(Boolean);
  } catch {
    return [];
  }
}

async function readJsonLines(path) {
  try {
    const content = await readFile(path, "utf8");
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => safeJsonParse(line))
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function appendTelemetryEvent(event, metadata = {}) {
  const record = {
    event: String(event || "usage.recorded"),
    timestamp: new Date().toISOString(),
    clientType: "squad",
    surface: "squad-web",
    version: packageMetadata.version || "web-prototype",
    metadata,
  };
  await mkdir(squadStateDir, { recursive: true });
  await appendFile(join(squadStateDir, "telemetry.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
}

function valueField(value, fields) {
  for (const field of fields) {
    const next = value?.[field];
    if (typeof next === "string" && next.trim()) return next;
  }
  return null;
}

function countBy(values, getKey) {
  const counts = {};
  for (const value of values) {
    const key = getKey(value);
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function numericField(source, fields) {
  for (const field of fields) {
    const value = source?.[field];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.round(value);
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed >= 0) return Math.round(parsed);
    }
  }
  return 0;
}

function nestedStringField(source, paths) {
  for (const path of paths) {
    let current = source;
    for (const key of path) current = current?.[key];
    if (typeof current === "string" && current.trim()) return current.trim();
  }
  return "";
}

function nestedNumericField(source, paths) {
  for (const path of paths) {
    let current = source;
    for (const key of path) current = current?.[key];
    const value = numericField({ value: current }, ["value"]);
    if (value > 0) return value;
  }
  return 0;
}

function timestampMillis(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (/^unix-ms:\d+$/.test(text)) return Number(text.slice("unix-ms:".length));
  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function durationBetween(startedAt, finishedAt) {
  const started = timestampMillis(startedAt);
  const finished = timestampMillis(finishedAt);
  return started && finished && finished >= started ? finished - started : 0;
}

function harnessFromCommand(command) {
  const lower = String(command || "").toLowerCase();
  if (lower.includes("autohand")) return "autohand-cli";
  if (lower.includes("codex")) return "codex-cli";
  if (lower.includes("claude")) return "claude-code-cli";
  return "";
}

function normalizeEffectiveModel(value) {
  if (!value || typeof value !== "object") return {};
  return {
    provider: String(value.provider || "").trim(),
    model: String(value.model || "").trim(),
  };
}

function usageRecordFromEvent(event) {
  const metadata = event?.metadata && typeof event.metadata === "object" ? event.metadata : {};
  const eventName = String(event?.event || "");
  const inputTokens =
    numericField(metadata, ["inputTokens", "input_tokens", "promptTokens", "prompt_tokens"]) ||
    nestedNumericField(metadata, [["usage", "inputTokens"], ["usage", "input_tokens"], ["usage", "promptTokens"], ["usage", "prompt_tokens"]]);
  const outputTokens =
    numericField(metadata, ["outputTokens", "output_tokens", "completionTokens", "completion_tokens"]) ||
    nestedNumericField(metadata, [["usage", "outputTokens"], ["usage", "output_tokens"], ["usage", "completionTokens"], ["usage", "completion_tokens"]]);
  const tokens =
    numericField(metadata, ["tokens", "totalTokens", "total_tokens"]) ||
    nestedNumericField(metadata, [["usage", "tokens"], ["usage", "totalTokens"], ["usage", "total_tokens"]]) ||
    inputTokens + outputTokens;
  const durationMs = numericField(metadata, ["durationMs", "duration_ms", "elapsedMs", "elapsed_ms"]);
  const provider = String(metadata.provider || nestedStringField(metadata, [["effectiveModel", "provider"], ["model", "provider"]]) || "").trim();
  const model = String(metadata.model || nestedStringField(metadata, [["effectiveModel", "model"], ["model", "model"]]) || "").trim();
  const harness = String(metadata.harness || metadata.transport || event?.surface || event?.clientType || event?.client_type || "telemetry").trim();
  const hasUsageSignal =
    tokens > 0 ||
    inputTokens > 0 ||
    outputTokens > 0 ||
    durationMs > 0 ||
    provider ||
    model ||
    eventName.includes("usage") ||
    eventName.includes("chat") ||
    eventName.startsWith("launcher.");
  if (!hasUsageSignal) return null;
  return {
    at: event?.timestamp || null,
    source: eventName || "telemetry",
    harness,
    agentId: metadata.agentId || metadata.agent_id || null,
    provider: provider || null,
    model: model || null,
    tokens,
    inputTokens,
    outputTokens,
    durationMs,
    status: metadata.status || eventName || null,
  };
}

function usageRecordFromRun(run) {
  if (!run || typeof run !== "object") return null;
  const effectiveModel = normalizeEffectiveModel(run.effectiveModel || run.effective_model);
  const startedAt = run.startedAt || run.started_at || run.createdAt || run.created_at || null;
  const finishedAt = run.finishedAt || run.finished_at || run.completedAt || run.completed_at || null;
  const status = run.status || null;
  if (!startedAt && !finishedAt && !status) return null;
  const inputTokens = numericField(run, ["inputTokens", "input_tokens", "promptTokens", "prompt_tokens"]);
  const outputTokens = numericField(run, ["outputTokens", "output_tokens", "completionTokens", "completion_tokens"]);
  return {
    at: finishedAt || startedAt,
    source: "run",
    harness: run.transport || run.harness || harnessFromCommand(run.command) || "autohand-cli",
    agentId: run.agentId || run.agent_id || null,
    provider: effectiveModel.provider || run.provider || null,
    model: effectiveModel.model || run.model || null,
    tokens: numericField(run, ["tokens", "totalTokens", "total_tokens"]) || inputTokens + outputTokens,
    inputTokens,
    outputTokens,
    durationMs: numericField(run, ["durationMs", "duration_ms"]) || durationBetween(startedAt, finishedAt),
    status,
  };
}

function usageBreakdown(records, labelFor) {
  const rows = new Map();
  for (const record of records) {
    const label = String(labelFor(record) || "").trim();
    if (!label) continue;
    const row = rows.get(label) || { label, count: 0, tokens: 0, durationMs: 0, lastAt: null };
    row.count += 1;
    row.tokens += Number(record.tokens) || 0;
    row.durationMs += Number(record.durationMs) || 0;
    if (!row.lastAt || String(record.at || "") > String(row.lastAt || "")) row.lastAt = record.at || null;
    rows.set(label, row);
  }
  return Array.from(rows.values())
    .sort((a, b) => b.count - a.count || b.tokens - a.tokens || b.durationMs - a.durationMs || a.label.localeCompare(b.label))
    .slice(0, 8);
}

function usageSnapshot(runs, telemetry) {
  const records = [
    ...telemetry.map(usageRecordFromEvent).filter(Boolean),
    ...runs.map(usageRecordFromRun).filter(Boolean),
  ].sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  const totalDurationMs = records.reduce((sum, record) => sum + (Number(record.durationMs) || 0), 0);
  const timedRecords = records.filter((record) => Number(record.durationMs) > 0).length;
  return {
    totalRecords: records.length,
    activeSessions: records.filter((record) => ["queued", "running", "launching"].includes(record.status)).length,
    totalTokens: records.reduce((sum, record) => sum + (Number(record.tokens) || 0), 0),
    inputTokens: records.reduce((sum, record) => sum + (Number(record.inputTokens) || 0), 0),
    outputTokens: records.reduce((sum, record) => sum + (Number(record.outputTokens) || 0), 0),
    totalDurationMs,
    averageDurationMs: timedRecords ? Math.round(totalDurationMs / timedRecords) : 0,
    lastUsageAt: records[0]?.at || null,
    topHarnesses: usageBreakdown(records, (record) => record.harness),
    topProviders: usageBreakdown(records, (record) => record.provider),
    topModels: usageBreakdown(records, (record) => record.model),
    recent: records.slice(0, 12),
  };
}

function usageMetadata({ payload = {}, agentRuntime = {}, transport = "", status = "completed", durationMs = 0, startedAt = "", completedAt = "", trace = null, command = "" }) {
  const effectiveModel = normalizeEffectiveModel(agentRuntime.effectiveModel || payload.effectiveModel);
  const traceUsage = trace?.usage && typeof trace.usage === "object" ? trace.usage : {};
  const inputTokens = numericField(traceUsage, ["inputTokens", "input_tokens", "promptTokens", "prompt_tokens"]);
  const outputTokens = numericField(traceUsage, ["outputTokens", "output_tokens", "completionTokens", "completion_tokens"]);
  return {
    harness: transport || trace?.transport || harnessFromCommand(command || trace?.command) || "autohand-cli",
    transport: transport || trace?.transport || "",
    status,
    agentId: payload.agentId || agentRuntime.agentId || "",
    provider: effectiveModel.provider || "",
    model: effectiveModel.model || "",
    durationMs: Number(durationMs || trace?.durationMs || 0) || durationBetween(startedAt || trace?.startedAt, completedAt || trace?.completedAt),
    startedAt: startedAt || trace?.startedAt || "",
    completedAt: completedAt || trace?.completedAt || "",
    command: command || trace?.command || "",
    tokens: numericField(traceUsage, ["tokens", "totalTokens", "total_tokens"]) || inputTokens + outputTokens,
    inputTokens,
    outputTokens,
  };
}

function recordUsageTelemetry(event, metadata) {
  void appendTelemetryEvent(event, metadata).catch((error) => {
    console.warn(`usage telemetry failed: ${error.message}`);
  });
}

function pidRunning(pid) {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) return false;
  try {
    process.kill(numericPid, 0);
    return true;
  } catch {
    return false;
  }
}

function serviceRecord(record) {
  if (!record) return null;
  return {
    pid: record.pid,
    host: record.host,
    port: record.port,
    url: record.url,
    running: pidRunning(record.pid),
    startedAt: record.startedAt || record.started_at || null,
  };
}

async function fetchAnalyticsDaemonSnapshot() {
  const record = await readOptionalJsonFile(join(squadStateDir, "analytics.json"));
  if (!record?.host || !record?.port) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 650);
  try {
    const response = await fetch(`http://${record.host}:${record.port}/metrics`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function analyticsSnapshot() {
  const daemonSnapshot = await fetchAnalyticsDaemonSnapshot();
  if (daemonSnapshot?.success) return daemonSnapshot;

  const [daemonRecord, analyticsRecord, webServerRecord, installRecord, updateRecord, queueItems, diskRuns, telemetry, liveStatus] =
    await Promise.all([
      readOptionalJsonFile(join(squadStateDir, "daemon.json")),
      readOptionalJsonFile(join(squadStateDir, "analytics.json")),
      readOptionalJsonFile(join(squadStateDir, "web-server.json")),
      readOptionalJsonFile(join(squadStateDir, "install.json")),
      readOptionalJsonFile(join(squadStateDir, "update.json")),
      readJsonDir(join(squadStateDir, "queue")),
      readJsonDir(join(squadStateDir, "runs")),
      readJsonLines(join(squadStateDir, "telemetry.jsonl")),
      readOptionalJsonFile(liveStatusPath),
    ]);

  const runtimeRuns = Array.from(runs.values()).map(runSummary);
  const runMap = new Map();
  for (const run of [...diskRuns, ...runtimeRuns]) {
    if (run?.id) runMap.set(run.id, run);
  }
  const allRuns = Array.from(runMap.values());
  const usage = usageSnapshot(allRuns, telemetry);
  const activeRuns = allRuns.filter((run) => ["queued", "running"].includes(run.status));
  const failedRuns = allRuns.filter((run) => run.status === "failed");
  const completedRuns = allRuns.filter((run) => run.status === "completed");
  const rejectedRuns = allRuns.filter((run) => run.status === "rejected");
  const activeAgents = new Set(
    activeRuns
      .map((run) => run.agentId || run.agent_id)
      .filter((agentId) => typeof agentId === "string" && agentId.trim())
  );
  const completedOrFailed = completedRuns.length + failedRuns.length;
  const eventCounts = countBy(telemetry, (event) => event.event);
  const liveQueueDepth = safeCount(liveStatus?.queueDepth);
  const liveQueuedJobs = safeCount(liveStatus?.queuedJobs);
  const liveScheduledJobs = safeCount(liveStatus?.scheduledJobs);
  const liveActiveWork = safeCount(liveStatus?.activeWork);
  const liveOnlineMembers = safeCount(liveStatus?.onlineMembers);
  const liveWorkingAgents = safeCount(liveStatus?.workingAgents);
  const liveTotalRuns = safeCount(liveStatus?.totalRuns);
  const generatedAt = new Date().toISOString();
  const mainDaemon = serviceRecord(daemonRecord);
  const analyticsDaemon = serviceRecord(analyticsRecord);
  const recentErrors = [
    ...failedRuns.map((run) => ({
      at: run.finishedAt || run.completedAt || run.completed_at || run.startedAt || run.createdAt || null,
      source: "run",
      message: run.title || run.prompt || "run failed",
      runId: run.id,
    })),
    ...telemetry
      .filter((event) => String(event.event || "").includes("error") || event.metadata?.remoteError || event.metadata?.error)
      .map((event) => ({
        at: event.timestamp || null,
        source: event.surface || "telemetry",
        message: event.metadata?.remoteError || event.metadata?.error || event.event,
        runId: event.metadata?.runId || event.metadata?.run_id || null,
      })),
  ]
    .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")))
    .slice(0, 8);

  return {
    success: true,
    generatedAt,
    source: "web-server-fallback",
    stateDir: squadStateDir,
    services: {
      activeDaemons: [mainDaemon, analyticsDaemon].filter((record) => record?.running).length,
      mainDaemon,
      analyticsDaemon,
      webServer: webServerRecord || null,
    },
    versions: {
      runtimeVersion: "web-prototype",
      installedVersion: installRecord?.version || null,
      installedChannel: installRecord?.channel || null,
      installedAt: installRecord?.installedAt || installRecord?.installed_at || null,
      updateChannel: updateRecord?.channel || null,
      latestAllowedVersion: updateRecord?.latestAllowedVersion || updateRecord?.latest_allowed_version || null,
      updateAvailable: typeof updateRecord?.updateAvailable === "boolean" ? updateRecord.updateAvailable : null,
    },
    work: {
      queueDepth: queueItems.length + liveQueueDepth,
      queuedJobs: queueItems.filter((item) => item.status === "queued").length + liveQueuedJobs,
      scheduledJobs: queueItems.filter((item) => item.scheduledFor || item.scheduled_for).length + liveScheduledJobs,
      activeWork: activeRuns.length + queueItems.filter((item) => ["queued", "running"].includes(item.status)).length + liveActiveWork,
      onlineMembers: Math.max(activeAgents.size, activeRuns.length, liveOnlineMembers),
      workingAgents: Math.max(activeAgents.size, activeRuns.length, liveWorkingAgents),
      totalRuns: allRuns.length + liveTotalRuns,
      runningRuns: activeRuns.length,
      completedRuns: completedRuns.length,
      failedRuns: failedRuns.length,
      rejectedRuns: rejectedRuns.length,
      queueVolume: queueItems.length + allRuns.length + liveQueueDepth + liveTotalRuns,
      failureRate: completedOrFailed ? failedRuns.length / completedOrFailed : 0,
    },
    telemetry: {
      totalEvents: telemetry.length,
      eventCounts,
      clientTypeCounts: countBy(telemetry, (event) => event.clientType || event.client_type),
      surfaceCounts: countBy(telemetry, (event) => event.surface),
      queueCreated: eventCounts["queue.created"] || 0,
      queueStarted: (eventCounts["queue.started"] || 0) + (eventCounts["active_work.started"] || 0),
      queueCompleted: eventCounts["queue.completed"] || 0,
      queueFailed: eventCounts["queue.failed"] || 0,
      errors: eventCounts.error || 0,
      lastEventAt: telemetry.at(-1)?.timestamp || null,
    },
    usage,
    timestamps: {
      lastDeviceRegistrationAt: valueField(await readOptionalJsonFile(join(squadStateDir, "device-registration.json")), ["registeredAt", "registered_at"]),
      lastPingAt: valueField(await readOptionalJsonFile(join(squadStateDir, "ping.json")), ["pingedAt", "pinged_at"]),
      lastFeatureFlagCheckAt: valueField(await readOptionalJsonFile(join(squadStateDir, "feature-flags.json")), ["checkedAt", "checked_at"]),
      lastTelemetryFlushAt: valueField(await readOptionalJsonFile(join(squadStateDir, "telemetry-flush.json")), ["flushedAt", "flushed_at"]),
      lastSyncAt: valueField(await readOptionalJsonFile(join(squadStateDir, "sync.json")), ["syncedAt", "synced_at"]),
      lastUpdateCheckAt: valueField(updateRecord, ["checkedAt", "checked_at"]),
      lastSnapshotAt: generatedAt,
      lastWebStatusAt: valueField(liveStatus, ["updatedAt", "updated_at"]),
    },
    recentErrors,
  };
}

function formatChatReply(stdout, stderr, prompt) {
  const promptText = String(prompt || "").trim();
  const lines = stripAnsi(stdout)
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed === "autohand") return false;
      if (trimmed === promptText || trimmed === `> ${promptText}`) return false;
      if (trimmed === `› ${promptText}` || trimmed.replace(/^›\s*/, "") === promptText) return false;
      if (/^Completed in .* tokens? used$/i.test(trimmed)) return false;
      return true;
    });

  const reply = lines.join("\n").trim();
  if (reply) return reply;
  return stripAnsi(stderr).trim();
}

function visibleCliStreamOutput(chunk, prompt) {
  const promptText = String(prompt || "").trim();
  return stripAnsi(chunk)
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      if (trimmed === "autohand") return false;
      if (trimmed === promptText || trimmed === `> ${promptText}`) return false;
      if (trimmed === `› ${promptText}` || trimmed.replace(/^›\s*/, "") === promptText) return false;
      if (/^Completed in .* tokens? used$/i.test(trimmed)) return false;
      return true;
    })
    .join("\n");
}

function compactTraceText(value, maxLength = 50000) {
  const text = stripAnsi(value).trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n\n[output truncated after ${maxLength} characters]`;
}

function normalizeToolCall(call, timestamp = "") {
  if (!call || typeof call !== "object") return null;
  const functionCall = call.function && typeof call.function === "object" ? call.function : null;
  const rawArgs = call.args ?? call.arguments ?? functionCall?.arguments ?? {};
  const parsedArgs = typeof rawArgs === "string" ? safeJsonParse(rawArgs) || rawArgs : rawArgs;
  const name = call.tool || call.name || functionCall?.name || call.type || "tool";

  return {
    id: String(call.id || call.tool_call_id || call.callId || ""),
    name: String(name || "tool"),
    args: parsedArgs,
    timestamp: call.timestamp || timestamp,
  };
}

function conversationTraceFromEntries(entries) {
  const thoughts = [];
  const toolCalls = [];
  const toolResults = [];
  const messages = [];
  const events = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const role = String(entry.role || "");
    const timestamp = entry.timestamp || entry.at || "";
    const content = typeof entry.content === "string" ? entry.content : "";
    const parsedContent = safeJsonParse(content.trim());

    if (role === "assistant") {
      const payload = parsedContent && typeof parsedContent === "object" ? parsedContent : null;
      if (payload?.thought || payload?.reflection) {
        const thoughtEvent = {
          thought: compactTraceText(payload.thought || "", 18000),
          reflection: compactTraceText(payload.reflection || "", 18000),
          timestamp,
        };
        thoughts.push(thoughtEvent);
        events.push({ type: "thought", ...thoughtEvent });
      }

      const nestedCalls = Array.isArray(payload?.toolCalls) ? payload.toolCalls : [];
      const directCalls = Array.isArray(entry.toolCalls) ? entry.toolCalls : [];
      for (const call of [...nestedCalls, ...directCalls]) {
        const normalized = normalizeToolCall(call, timestamp);
        if (normalized) {
          toolCalls.push(normalized);
          events.push({ type: "tool_call", call: normalized, timestamp });
        }
      }

      const visibleText = payload?.answer || payload?.response || payload?.content || (!payload ? content : "");
      if (visibleText && typeof visibleText === "string") {
        const messageEvent = { role, content: compactTraceText(visibleText, 24000), timestamp };
        messages.push(messageEvent);
        events.push({ type: "assistant_event", ...messageEvent });
      }
    }

    if (role === "tool") {
      const toolResult = {
        id: String(entry.tool_call_id || entry.toolCallId || ""),
        name: String(entry.name || "tool"),
        content: compactTraceText(content, 24000),
        timestamp,
      };
      toolResults.push(toolResult);
      events.push({ type: "tool_result", result: toolResult, timestamp });
    }
  }

  return { thoughts, toolCalls, toolResults, messages, events };
}

async function latestConversationEntries(agentHome, startedAt) {
  const sessionsDir = join(agentHome, "sessions");
  let sessionDirs = [];
  try {
    sessionDirs = await readdir(sessionsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  let latest = null;
  for (const dirent of sessionDirs) {
    if (!dirent.isDirectory()) continue;
    const conversationPath = join(sessionsDir, dirent.name, "conversation.jsonl");
    try {
      const info = await stat(conversationPath);
      if (info.mtimeMs < startedAt - 30000) continue;
      if (!latest || info.mtimeMs > latest.mtimeMs) {
        latest = { path: conversationPath, mtimeMs: info.mtimeMs };
      }
    } catch {
      // Some sessions have metadata only; skip them.
    }
  }

  if (!latest) return [];

  try {
    const content = await readFile(latest.path, "utf8");
    return content
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => safeJsonParse(line))
      .filter(Boolean)
      .slice(-160);
  } catch {
    return [];
  }
}

async function buildChatTrace({ agentHome, startedAt, stdout, stderr, prompt, command, exitCode }) {
  const entries = await latestConversationEntries(agentHome, startedAt);
  const transcript = conversationTraceFromEntries(entries);
  const promptText = String(prompt || "").trim();
  const steps = compactTraceText(stdout, 50000)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-→>›\s]*step\s+\d+\s*:/i.test(line) && line !== promptText)
    .map((line) => {
      const match = line.match(/^[-→>›\s]*step\s+(\d+)\s*:\s*(.+)$/i);
      return {
        index: match ? Number(match[1]) : null,
        title: match ? match[2].trim() : line,
      };
    });

  return {
    command,
    exitCode,
    steps,
    thoughts: transcript.thoughts,
    toolCalls: transcript.toolCalls,
    toolResults: transcript.toolResults,
    messages: transcript.messages,
    events: [
      ...steps.map((step) => ({ type: "step", ...step })),
      ...transcript.events,
    ],
    raw: {
      stdout: compactTraceText(stdout),
      stderr: compactTraceText(stderr),
    },
  };
}

function compactJson(value, maxLength = 12000) {
  try {
    return compactTraceText(JSON.stringify(value, null, 2), maxLength);
  } catch {
    return compactTraceText(String(value), maxLength);
  }
}

function sdkEventTimestamp(event) {
  return event?.timestamp || new Date().toISOString();
}

function appendSdkEventLog(run, event) {
  if (!event || typeof event !== "object") return;
  const timestamp = sdkEventTimestamp(event);
  if (event.type === "message_update" && event.delta) {
    appendLog(run, "stdout", event.delta);
    return;
  }
  if (event.type === "message_end" && event.content) {
    appendLog(run, "stdout", event.content);
    return;
  }
  if (event.type === "tool_start") {
    appendLog(run, "tool", `started ${event.toolName || "tool"} ${compactJson(event.args || {}, 4000)}`);
    return;
  }
  if (event.type === "tool_update") {
    appendLog(run, event.stream === "stderr" ? "stderr" : "stdout", event.output || "");
    return;
  }
  if (event.type === "tool_end") {
    appendLog(run, "tool", `${event.toolName || "tool"} ${event.success ? "completed" : "failed"} at ${timestamp}`);
    if (event.output) appendLog(run, "stdout", event.output);
    if (event.error) appendLog(run, "stderr", event.error);
    return;
  }
  if (event.type === "permission_request") {
    appendLog(run, "permission", `${event.tool || "tool"} requested permission: ${event.description || ""}`);
    return;
  }
  if (event.type === "agent_start") {
    appendLog(run, "sdk", `agent started: ${event.model || "default model"}`);
    return;
  }
  if (event.type === "agent_end") {
    appendLog(run, "sdk", `agent ended: ${event.reason || "completed"}`);
    return;
  }
  appendLog(run, "sdk", `${event.type || "event"} ${compactJson(event, 4000)}`);
}

function sdkTraceFromEvents(events, rawStdout = "", rawStderr = "") {
  const thoughts = [];
  const toolCalls = [];
  const toolResults = [];
  const messages = [];
  const orderedEvents = [];
  let currentAssistantText = "";

  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    const timestamp = sdkEventTimestamp(event);

    if (event.type === "message_update") {
      if (event.thought) {
        const thought = {
          thought: compactTraceText(event.thought, 18000),
          reflection: "",
          timestamp,
        };
        thoughts.push(thought);
        orderedEvents.push({ type: "thought", ...thought });
      }
      if (event.delta) currentAssistantText += event.delta;
      continue;
    }

    if (event.type === "message_end") {
      const content = compactTraceText(event.content || currentAssistantText, 24000);
      if (content) {
        const message = { role: "assistant", content, timestamp };
        messages.push(message);
        orderedEvents.push({ type: "assistant_event", ...message });
      }
      currentAssistantText = "";
      continue;
    }

    if (event.type === "tool_start") {
      const call = {
        id: String(event.toolId || ""),
        name: String(event.toolName || "tool"),
        args: event.args || {},
        timestamp,
      };
      toolCalls.push(call);
      orderedEvents.push({ type: "tool_call", call, timestamp });
      continue;
    }

    if (event.type === "tool_update" || event.type === "tool_end") {
      const content = compactTraceText(event.output || event.error || "", 24000);
      if (content) {
        const result = {
          id: String(event.toolId || ""),
          name: String(event.toolName || "tool"),
          content,
          timestamp,
        };
        toolResults.push(result);
        orderedEvents.push({ type: "tool_result", result, timestamp });
      }
      continue;
    }

    if (event.type === "permission_request") {
      orderedEvents.push({
        type: "permission_request",
        title: event.description || event.tool || "Permission requested",
        content: compactJson(event.context || {}, 6000),
        timestamp,
      });
      continue;
    }

    orderedEvents.push({
      type: String(event.type || "sdk_event"),
      title: String(event.reason || event.model || event.tool || ""),
      content: compactJson(event, 6000),
      timestamp,
    });
  }

  if (currentAssistantText.trim()) {
    const message = {
      role: "assistant",
      content: compactTraceText(currentAssistantText, 24000),
      timestamp: new Date().toISOString(),
    };
    messages.push(message);
    orderedEvents.push({ type: "assistant_event", ...message });
  }

  return {
    steps: [],
    thoughts,
    toolCalls,
    toolResults,
    messages,
    events: orderedEvents,
    raw: {
      stdout: compactTraceText(rawStdout),
      stderr: compactTraceText(rawStderr),
    },
  };
}

function sdkReplyFromEvents(events, rawStdout = "") {
  const lastMessageEnd = [...events].reverse().find((event) => event?.type === "message_end" && event.content);
  if (lastMessageEnd?.content) return String(lastMessageEnd.content).trim();
  const text = events
    .filter((event) => event?.type === "message_update" && event.delta)
    .map((event) => event.delta)
    .join("")
    .trim();
  return text || rawStdout.trim();
}

function chatStreamEventFromSdkEvent(event) {
  const timestamp = sdkEventTimestamp(event);

  if (event?.type === "message_update") {
    return {
      type: "message_delta",
      messageId: String(event.messageId || ""),
      delta: String(event.delta || ""),
      thought: String(event.thought || ""),
      timestamp,
    };
  }

  if (event?.type === "message_end") {
    return {
      type: "message_end",
      messageId: String(event.messageId || ""),
      content: compactTraceText(event.content || "", 24000),
      timestamp,
    };
  }

  if (event?.type === "tool_start") {
    return {
      type: "tool_start",
      tool: {
        id: String(event.toolId || ""),
        name: String(event.toolName || "tool"),
        args: event.args || {},
        timestamp,
      },
    };
  }

  if (event?.type === "tool_update") {
    return {
      type: "tool_update",
      toolId: String(event.toolId || ""),
      output: compactTraceText(event.output || "", 12000),
      stream: event.stream === "stderr" ? "stderr" : "stdout",
      timestamp,
    };
  }

  if (event?.type === "tool_end") {
    return {
      type: "tool_end",
      toolId: String(event.toolId || ""),
      toolName: String(event.toolName || "tool"),
      success: event.success !== false,
      output: compactTraceText(event.output || event.error || "", 12000),
      stream: event.error ? "stderr" : "stdout",
      timestamp,
    };
  }

  if (event?.type === "permission_request") {
    return {
      type: "permission_request",
      title: event.description || event.tool || "Permission requested",
      content: compactJson(event.context || {}, 6000),
      timestamp,
    };
  }

  if (event?.type === "error") {
    return {
      type: "error",
      error: event.message || event.error || "Agent stream failed",
      timestamp,
    };
  }

  return {
    type: "status",
    status: String(event?.type || "sdk_event"),
    timestamp,
  };
}

async function collectSdkPrompt(sdk, prompt, timeoutMs, onEvent, signal, firstEventTimeoutMs = 45000) {
  const events = [];
  let rawStdout = "";
  let rawStderr = "";
  let timedOut = false;
  let stopped = false;
  let stalled = false;
  let gotFirstEvent = false;
  let timeout = null;
  let firstEventTimer = null;
  let abortHandler = null;

  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      timedOut = true;
      reject(new Error("chat timed out waiting for Autohand SDK"));
    }, timeoutMs);
  });

  // First-event watchdog: a healthy turn emits agent/turn/message events within
  // a second or two. A long initial silence means the CLI exited (e.g. it
  // rejected a stale/server-invalid auth token with a JSON-RPC error the SDK
  // can't match to our request and so never surfaces) or never reached the
  // provider. Fail fast with an actionable message instead of stalling for the
  // full turn timeout.
  const firstEventPromise = firstEventTimeoutMs
    ? new Promise((_, reject) => {
        firstEventTimer = setTimeout(() => {
          if (gotFirstEvent) return;
          stalled = true;
          reject(
            new AutohandStallError(
              "The Autohand CLI did not respond. It may have exited or needs sign-in — run `autohand login` in your terminal, then retry."
            )
          );
        }, firstEventTimeoutMs);
      })
    : null;

  const abortPromise = signal
    ? new Promise((_, reject) => {
        abortHandler = () => {
          stopped = true;
          reject(new Error("chat stopped by the user"));
        };
        if (signal.aborted) abortHandler();
        else signal.addEventListener("abort", abortHandler, { once: true });
      })
    : null;

  const collectPromise = (async () => {
    for await (const event of sdk.streamPrompt({ message: prompt })) {
      if (!gotFirstEvent) {
        gotFirstEvent = true;
        if (firstEventTimer) clearTimeout(firstEventTimer);
      }
      if (signal?.aborted) {
        stopped = true;
        throw new Error("chat stopped by the user");
      }
      events.push(event);
      if (event?.type === "message_update" && event.delta) rawStdout += event.delta;
      if (event?.type === "message_end" && event.content && !rawStdout.includes(event.content)) {
        rawStdout += event.content;
      }
      if (event?.type === "tool_update") {
        if (event.stream === "stderr") rawStderr += event.output || "";
        else rawStdout += event.output || "";
      }
      onEvent?.(event);
    }
    return { events, rawStdout, rawStderr, timedOut };
  })();

  try {
    const racers = [collectPromise, timeoutPromise];
    if (firstEventPromise) racers.push(firstEventPromise);
    if (abortPromise) racers.push(abortPromise);
    return await Promise.race(racers);
  } finally {
    if (timeout) clearTimeout(timeout);
    if (firstEventTimer) clearTimeout(firstEventTimer);
    if (abortHandler) signal?.removeEventListener("abort", abortHandler);
    if (timedOut || stopped || stalled || signal?.aborted) {
      await sdk.interrupt?.().catch(() => {});
    }
  }
}

async function startSdkRun(run, payload, { workspace, prompt, agentRuntime }) {
  let AutohandSDK;
  try {
    ({ AutohandSDK } = await loadAgentSdk());
  } catch (error) {
    throw new SdkBridgeStartupError(`SDK unavailable: ${error.message}`, error);
  }
  if (!AutohandSDK) {
    throw new SdkBridgeStartupError("SDK unavailable: AutohandSDK export was not found");
  }

  const profile = String(payload.profile || "").trim().slice(0, 12000);
  const context = sdkRuntimeContext(payload, workspace, profile, agentRuntime);
  const sdk = new AutohandSDK(context.options);
  run.sdk = sdk;
  run.transport = "sdk";
  run.command = context.command;
  appendLog(run, "system", `started SDK transport ${run.command}`);

  try {
    await sdk.start();
  } catch (error) {
    run.sdk = null;
    await sdk.close?.().catch(() => {});
    throw new SdkBridgeStartupError(`SDK startup failed: ${error.message}`, error);
  }

  void (async () => {
    try {
      const output = await collectSdkPrompt(sdk, prompt, 300000, (event) => appendSdkEventLog(run, event));
      if (run.status !== "stopped") {
        run.exitCode = 0;
        run.status = "completed";
        run.finishedAt = new Date().toISOString();
        run.trace = sdkTraceFromEvents(output.events, output.rawStdout, output.rawStderr);
        appendLog(run, "system", "SDK run completed");
        recordUsageTelemetry("usage.recorded", usageMetadata({ payload, agentRuntime, transport: "sdk", status: run.status, trace: run.trace, command: run.command, startedAt: run.startedAt, completedAt: run.finishedAt }));
      }
    } catch (error) {
      if (run.status !== "stopped") {
        run.exitCode = 1;
        run.status = "failed";
        run.finishedAt = new Date().toISOString();
        appendLog(run, "stderr", error.message || String(error));
        recordUsageTelemetry("usage.recorded", usageMetadata({ payload, agentRuntime, transport: "sdk", status: run.status, command: run.command, startedAt: run.startedAt, completedAt: run.finishedAt }));
      }
    } finally {
      await sdk.close?.().catch((error) => appendLog(run, "system", `SDK close failed: ${error.message}`));
      run.sdk = null;
    }
  })();
}

function startCliRun(run, args, workspace, agentRuntime) {
  run.transport = "cli";
  const child = spawn(resolveAutohandBinary() || "autohand", args, {
    cwd: workspace,
    env: {
      ...process.env,
      ...agentRuntimeEnvVars(agentRuntime),
      FORCE_COLOR: "0",
    },
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  run.process = child;
  appendLog(run, "system", `started ${run.command}`);

  child.stdout.on("data", (chunk) => appendLog(run, "stdout", chunk));
  child.stderr.on("data", (chunk) => appendLog(run, "stderr", chunk));
  child.on("error", (error) => {
    if (run.status === "stopped") return;
    run.status = "failed";
    run.finishedAt = new Date().toISOString();
    appendLog(run, "system", error.message);
  });
  child.on("close", (code) => {
    run.exitCode = code;
    if (run.status === "stopped") {
      appendLog(run, "system", `stopped with code ${code}`);
      recordUsageTelemetry("usage.recorded", usageMetadata({ payload: { agentId: run.agentId }, agentRuntime, transport: "cli", status: run.status, command: run.command, startedAt: run.startedAt, completedAt: new Date().toISOString() }));
      return;
    }
    run.status = code === 0 ? "completed" : "failed";
    run.finishedAt = new Date().toISOString();
    appendLog(run, "system", `exited with code ${code}`);
    recordUsageTelemetry("usage.recorded", usageMetadata({ payload: { agentId: run.agentId }, agentRuntime, transport: "cli", status: run.status, command: run.command, startedAt: run.startedAt, completedAt: run.finishedAt }));
  });
}

async function chatOnceWithSdk(payload, { workspace, prompt, agentRuntime, timeoutMs, startedAt }) {
  let AutohandSDK;
  try {
    ({ AutohandSDK } = await loadAgentSdk());
  } catch (error) {
    throw new SdkBridgeStartupError(`SDK unavailable: ${error.message}`, error);
  }
  if (!AutohandSDK) {
    throw new SdkBridgeStartupError("SDK unavailable: AutohandSDK export was not found");
  }

  const profile = String(payload.profile || "").trim().slice(0, 12000);
  const context = sdkRuntimeContext(payload, workspace, profile, agentRuntime);
  const sdk = new AutohandSDK(context.options);
  let started = false;
  let eventCount = 0;

  try {
    await sdk.start();
    started = true;
    const output = await collectSdkPrompt(sdk, prompt, timeoutMs, () => {
      eventCount += 1;
    });
    const reply = sdkReplyFromEvents(output.events, output.rawStdout);
    const trace = sdkTraceFromEvents(output.events, output.rawStdout, output.rawStderr);
    const completedAt = Date.now();
    trace.command = context.command;
    trace.exitCode = 0;
    trace.transport = "sdk";
    trace.startedAt = new Date(startedAt).toISOString();
    trace.completedAt = new Date(completedAt).toISOString();
    trace.durationMs = completedAt - startedAt;
    const result = {
      reply: reply || "Autohand returned no chat text.",
      trace,
      workspace,
      command: context.command,
      transport: "sdk",
      startedAt: trace.startedAt,
      completedAt: trace.completedAt,
      durationMs: trace.durationMs,
      configPath: agentRuntime.configPath,
      displayConfigPath: agentRuntime.displayConfigPath,
      agentHome: agentRuntime.agentHome,
      effectiveModel: agentRuntime.effectiveModel,
      skillInstall: agentRuntime.skillInstall,
      profileDocs: agentRuntime.profileDocs,
      brainCard: agentRuntime.brainCard,
      channel: channelContextFromPayload(payload),
      contextLayers: chatContextLayers(payload, agentRuntime, trace),
    };
    recordUsageTelemetry("usage.recorded", usageMetadata({ payload, agentRuntime, transport: "sdk", status: "completed", trace, command: context.command }));
    return result;
  } catch (error) {
    if (error instanceof AutohandStallError) {
      throw error;
    }
    if (!started || eventCount === 0) {
      throw new SdkBridgeStartupError(`SDK prompt failed before producing events: ${error.message}`, error);
    }
    throw error;
  } finally {
    await sdk.close?.().catch(() => {});
  }
}

async function streamChatWithSdk(payload, { workspace, prompt, agentRuntime, timeoutMs, startedAt, stream, signal }) {
  stream.send("sdk", {
    type: "status",
    status: "sdk_prepare",
    label: "Preparing SDK transport...",
    timestamp: new Date().toISOString(),
  });

  let AutohandSDK;
  try {
    ({ AutohandSDK } = await loadAgentSdk());
  } catch (error) {
    throw new SdkBridgeStartupError(`SDK unavailable: ${error.message}`, error);
  }
  if (!AutohandSDK) {
    throw new SdkBridgeStartupError("SDK unavailable: AutohandSDK export was not found");
  }

  const profile = String(payload.profile || "").trim().slice(0, 12000);
  const context = sdkRuntimeContext(payload, workspace, profile, agentRuntime);
  const sdk = new AutohandSDK(context.options);
  let started = false;
  let eventCount = 0;

  try {
    stream.send("sdk", {
      type: "status",
      status: "sdk_start",
      label: "Starting the local agent bridge...",
      timestamp: new Date().toISOString(),
    });
    await sdk.start();
    started = true;
    stream.send("sdk", {
      type: "status",
      status: "prompt_start",
      label: "Sending the request to the model...",
      timestamp: new Date().toISOString(),
    });
    const output = await collectSdkPrompt(sdk, prompt, timeoutMs, (event) => {
      eventCount += 1;
      stream.send("sdk", chatStreamEventFromSdkEvent(event));
    }, signal);
    const reply = sdkReplyFromEvents(output.events, output.rawStdout);
    const trace = sdkTraceFromEvents(output.events, output.rawStdout, output.rawStderr);
    const completedAt = Date.now();
    trace.command = context.command;
    trace.exitCode = 0;
    trace.transport = "sdk";
    trace.startedAt = new Date(startedAt).toISOString();
    trace.completedAt = new Date(completedAt).toISOString();
    trace.durationMs = completedAt - startedAt;
    const result = {
      reply: reply || "Autohand returned no chat text.",
      trace,
      workspace,
      command: context.command,
      transport: "sdk",
      startedAt: trace.startedAt,
      completedAt: trace.completedAt,
      durationMs: trace.durationMs,
      configPath: agentRuntime.configPath,
      displayConfigPath: agentRuntime.displayConfigPath,
      agentHome: agentRuntime.agentHome,
      effectiveModel: agentRuntime.effectiveModel,
      skillInstall: agentRuntime.skillInstall,
      profileDocs: agentRuntime.profileDocs,
      brainCard: agentRuntime.brainCard,
      channel: channelContextFromPayload(payload),
      contextLayers: chatContextLayers(payload, agentRuntime, trace),
    };
    recordUsageTelemetry("usage.recorded", usageMetadata({ payload, agentRuntime, transport: "sdk", status: "completed", trace, command: context.command }));
    stream.send("done", result);
  } catch (error) {
    if (error instanceof AutohandStallError) {
      throw error;
    }
    if (!started || eventCount === 0) {
      stream.send("sdk", {
        type: "status",
        status: "sdk_startup_failed",
        label: "SDK bridge did not produce events; trying CLI transport...",
        timestamp: new Date().toISOString(),
      });
      throw new SdkBridgeStartupError(`SDK prompt failed before producing events: ${error.message}`, error);
    }
    throw error;
  } finally {
    await sdk.close?.().catch(() => {});
  }
}

async function startRun(payload) {
  const { args, displayArgs, workspace, prompt, mode, agentRuntime } = await autohandArgs(payload);
  if (!prompt && mode !== "permissions") {
    throw new Error("prompt is required");
  }
  assertAutohandAuth(agentRuntime);

  // Goal 08: generate the context pack before the run starts and reference it
  // from the launch payload so the taskContextPack layer cites the same pack.
  const contextPack = mode === "permissions"
    ? (payload?.contextPack && typeof payload.contextPack === "object" ? payload.contextPack : null)
    : generateContextPack(mode, payload, agentRuntime, workspace);
  const layerPayload = contextPack
    ? { ...payload, contextPack: { id: contextPack.id, taskId: contextPack.taskId, summary: contextPack.summary } }
    : payload;

  const id = randomUUID();
  const channelContext = channelContextFromPayload(payload);
  const run = {
    id,
    agentId: payload.agentId || agentRuntime.agentId,
    title: payload.title || prompt || "Autohand permissions",
    mode,
    // Squad channels: tag the run with its channel/thread so queue and run
    // telemetry can group channel dispatches after reloads.
    channel: channelContext,
    // Goal 09: tag the run with the recipe it launched from so the evidence
    // timeline and done-criteria checks can reference the recipe by id.
    recipeId: typeof payload.recipeId === "string" && payload.recipeId ? payload.recipeId : null,
    workspace,
    configPath: agentRuntime.configPath,
    displayConfigPath: agentRuntime.displayConfigPath,
    agentHome: agentRuntime.agentHome,
    effectiveModel: agentRuntime.effectiveModel,
    skillInstall: agentRuntime.skillInstall,
    profileDocs: agentRuntime.profileDocs,
    brainCard: agentRuntime.brainCard,
    transport: "cli",
    command: `autohand ${displayArgs.map(shellQuote).join(" ")}`,
    logPath: join(runLogsDir, `${id}.log`),
    status: "running",
    exitCode: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    contextPack,
    contextLayers: assembleContextLayers(mode, layerPayload, agentRuntime),
    logs: [],
  };
  runs.set(id, run);

  // Goal 08: name the context pack in the launch transcript so the run timeline
  // records exactly which pack the agent started from.
  if (contextPack) {
    const c = contextPack.counts || {};
    appendLog(
      run,
      "context-pack",
      `Context pack ${contextPack.id} generated for ${contextPack.included?.repoSummary?.label || workspace}: ${c.files || 0} file(s) (~${contextPack.approxTokens || 0} tokens), ${c.diffs || 0} diff(s), ${c.priorFailures || 0} prior failure(s), ${c.screenshots || 0} screenshot(s); ${c.omitted || 0} section(s) omitted with source links.`
    );
  }

  if (channelContext) {
    appendLog(
      run,
      "channel",
      `Channel dispatch ${channelContext.channelName || channelContext.channelId}${channelContext.threadId ? ` thread ${channelContext.threadId}` : ""}; auto mode (self-judge) ${channelContext.autoModeDefault || channelContext.selfJudge ? "on" : "off"}.`
    );
    await recordChannelDispatch(channelContext, { prompt, agentId: run.agentId });
  }

  if (sdkTransportEnabled(payload, mode)) {
    try {
      await startSdkRun(run, payload, { workspace, prompt, agentRuntime });
      return runSummary(run);
    } catch (error) {
      run.transport = "cli";
      run.command = `autohand ${displayArgs.map(shellQuote).join(" ")}`;
      appendLog(run, "system", `${error.message}; falling back to direct CLI transport`);
    }
  } else if (!sdkSupportedMode(mode)) {
    appendLog(run, "system", `SDK transport not used for ${mode} mode; using direct CLI transport`);
  }

  startCliRun(run, args, workspace, agentRuntime);

  return runSummary(run);
}

async function chatOnce(payload) {
  const { args, displayArgs, workspace, prompt, agentRuntime } = await autohandArgs({
    ...payload,
    mode: "prompt",
    dryRun: false,
  });
  if (!prompt) {
    throw new Error("prompt is required");
  }
  assertAutohandAuth(agentRuntime);
  const channelContext = channelContextFromPayload(payload);
  if (channelContext) {
    await recordChannelDispatch(channelContext, { prompt, agentId: payload.agentId || agentRuntime.agentId });
  }

  const requestedTimeout = Number(payload.timeoutMs);
  const timeoutMs = Number.isFinite(requestedTimeout)
    ? Math.min(Math.max(requestedTimeout, 15000), 300000)
    : 180000;
  const command = `autohand ${displayArgs.map(shellQuote).join(" ")}`;
  const startedAt = Date.now();

  const sdkPayload = { ...payload, mode: "prompt", dryRun: false };
  if (sdkTransportEnabled(sdkPayload, "prompt")) {
    try {
      return await chatOnceWithSdk(sdkPayload, { workspace, prompt, agentRuntime, timeoutMs, startedAt });
    } catch (error) {
      if (!(error instanceof SdkBridgeStartupError)) {
        throw error;
      }
    }
  }

  const output = await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn(resolveAutohandBinary() || "autohand", args, {
      cwd: workspace,
      env: {
        ...process.env,
        AUTOHAND_HOME: agentRuntime.agentHome,
        AUTOHAND_CONFIG: agentRuntime.configPath,
        AUTOHAND_CLIENT_NAME: `autohand-squad-${agentRuntime.agentId}`,
        AUTOHAND_NO_IDLE_LOGOUT: "1",
        FORCE_COLOR: "0",
      },
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        reject(error);
        return;
      }
      resolve(result);
    }

    function stopChildWithError(message) {
      stderr += `${stderr.endsWith("\n") || !stderr ? "" : "\n"}[Autohand Squad] ${message}\n`;
      terminateChildProcess(child);
      finish(null, {
        exitCode: null,
        stdout,
        stderr,
        error: message,
      });
    }

    const timer = setTimeout(() => {
      stopChildWithError("chat timed out waiting for Autohand");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => finish(error));
    child.on("close", (exitCode) => finish(null, { exitCode, stdout, stderr }));
  });

  const reply = formatChatReply(output.stdout, output.stderr, prompt);
  const trace = await buildChatTrace({
    agentHome: agentRuntime.agentHome,
    startedAt,
    stdout: output.stdout,
    stderr: output.stderr,
    prompt,
    command,
    exitCode: output.exitCode,
  });
  const completedAt = Date.now();
  trace.startedAt = new Date(startedAt).toISOString();
  trace.completedAt = new Date(completedAt).toISOString();
  trace.durationMs = completedAt - startedAt;
  trace.transport = "cli";
  const result = {
    reply: reply || "Autohand returned no chat text.",
    trace,
    workspace,
    command,
    transport: "cli",
    startedAt: trace.startedAt,
    completedAt: trace.completedAt,
    durationMs: trace.durationMs,
    configPath: agentRuntime.configPath,
    displayConfigPath: agentRuntime.displayConfigPath,
    agentHome: agentRuntime.agentHome,
    skillInstall: agentRuntime.skillInstall,
    profileDocs: agentRuntime.profileDocs,
    brainCard: agentRuntime.brainCard,
    effectiveModel: agentRuntime.effectiveModel,
    channel: channelContext,
    contextLayers: chatContextLayers(payload, agentRuntime, trace),
  };
  if (output.error || output.exitCode !== 0) {
    recordUsageTelemetry("usage.recorded", usageMetadata({ payload, agentRuntime, transport: "cli", status: "failed", trace, command }));
    throw new ChatRuntimeError(output.error || reply || `Autohand exited with code ${output.exitCode}`, result);
  }

  recordUsageTelemetry("usage.recorded", usageMetadata({ payload, agentRuntime, transport: "cli", status: "completed", trace, command }));
  return result;
}

async function streamChatWithCli({ payload, args, displayArgs, workspace, prompt, agentRuntime, timeoutMs, startedAt, stream, signal }) {
  const command = `autohand ${displayArgs.map(shellQuote).join(" ")}`;
  let stdout = "";
  let stderr = "";

  stream.send("sdk", {
    type: "status",
    status: "cli_start",
    label: "Running local runtime...",
    timestamp: new Date().toISOString(),
  });

  const output = await new Promise((resolve, reject) => {
    let settled = false;
    let abortHandler = null;
    const child = spawn(resolveAutohandBinary() || "autohand", args, {
      cwd: workspace,
      env: {
        ...process.env,
        ...agentRuntimeEnvVars(agentRuntime),
        FORCE_COLOR: "0",
      },
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (abortHandler) signal?.removeEventListener("abort", abortHandler);
      if (error) {
        reject(error);
        return;
      }
      resolve(result);
    }

    function stopChildWithError(message) {
      stderr += `${stderr.endsWith("\n") || !stderr ? "" : "\n"}[Autohand Squad] ${message}\n`;
      terminateChildProcess(child);
      finish(null, {
        exitCode: null,
        stdout,
        stderr,
        error: message,
      });
    }

    const timer = setTimeout(() => {
      stopChildWithError("chat timed out waiting for Autohand");
    }, timeoutMs);

    abortHandler = () => {
      stopChildWithError("chat stopped by the user");
    };
    if (signal?.aborted) {
      abortHandler();
      return;
    }
    signal?.addEventListener("abort", abortHandler, { once: true });

    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      const delta = visibleCliStreamOutput(text, prompt);
      if (delta.trim()) {
        stream.send("sdk", {
          type: "message_delta",
          delta,
          timestamp: new Date().toISOString(),
        });
      }
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      stream.send("sdk", {
        type: "tool_update",
        toolId: "local-runtime",
        toolName: "local runtime",
        output: compactTraceText(text, 12000),
        stream: "stderr",
        timestamp: new Date().toISOString(),
      });
    });
    child.on("error", (error) => finish(error));
    child.on("close", (exitCode) => finish(null, { exitCode, stdout, stderr }));
  });

  const reply = formatChatReply(output.stdout, output.stderr, prompt);
  const trace = await buildChatTrace({
    agentHome: agentRuntime.agentHome,
    startedAt,
    stdout: output.stdout,
    stderr: output.stderr,
    prompt,
    command,
    exitCode: output.exitCode,
  });
  const completedAt = Date.now();
  trace.startedAt = new Date(startedAt).toISOString();
  trace.completedAt = new Date(completedAt).toISOString();
  trace.durationMs = completedAt - startedAt;
  trace.transport = "cli";
  const result = {
    reply: reply || "Autohand returned no chat text.",
    trace,
    workspace,
    command,
    transport: "cli",
    startedAt: trace.startedAt,
    completedAt: trace.completedAt,
    durationMs: trace.durationMs,
    configPath: agentRuntime.configPath,
    displayConfigPath: agentRuntime.displayConfigPath,
    agentHome: agentRuntime.agentHome,
    effectiveModel: agentRuntime.effectiveModel,
    skillInstall: agentRuntime.skillInstall,
    profileDocs: agentRuntime.profileDocs,
    brainCard: agentRuntime.brainCard,
    channel: channelContextFromPayload(payload),
    contextLayers: chatContextLayers(payload, agentRuntime, trace),
  };
  if (output.error || output.exitCode !== 0) {
    recordUsageTelemetry("usage.recorded", usageMetadata({ payload, agentRuntime, transport: "cli", status: "failed", trace, command }));
    throw new ChatRuntimeError(output.error || reply || `Autohand exited with code ${output.exitCode}`, result);
  }
  recordUsageTelemetry("usage.recorded", usageMetadata({ payload, agentRuntime, transport: "cli", status: "completed", trace, command }));
  stream.send("done", result);
}

async function streamChat(payload, res) {
  const stream = startEventStream(res);
  const startedAt = Date.now();
  const abortController = new AbortController();
  let streamOpen = true;
  const abortStream = () => {
    if (streamOpen && !abortController.signal.aborted) abortController.abort();
  };
  res.on("close", abortStream);

  try {
    const { args, displayArgs, workspace, prompt, agentRuntime } = await autohandArgs({
      ...payload,
      mode: "prompt",
      dryRun: false,
    });
    if (!prompt) {
      throw new Error("prompt is required");
    }
    assertAutohandAuth(agentRuntime);
    if (abortController.signal.aborted) {
      throw new Error("chat stopped by the user");
    }

    const channelContext = channelContextFromPayload(payload);
    if (channelContext) {
      await recordChannelDispatch(channelContext, { prompt, agentId: payload.agentId || agentRuntime.agentId });
    }

    const requestedTimeout = Number(payload.timeoutMs);
    const timeoutMs = Number.isFinite(requestedTimeout)
      ? Math.min(Math.max(requestedTimeout, 15000), 300000)
      : 180000;
    stream.send("start", {
      startedAt: new Date(startedAt).toISOString(),
      workspace,
      effectiveModel: agentRuntime.effectiveModel,
      channel: channelContext,
    });

    const sdkPayload = { ...payload, mode: "prompt", dryRun: false };
    if (sdkTransportEnabled(sdkPayload, "prompt")) {
      try {
        await streamChatWithSdk(sdkPayload, { workspace, prompt, agentRuntime, timeoutMs, startedAt, stream, signal: abortController.signal });
        return;
      } catch (error) {
        if (!(error instanceof SdkBridgeStartupError)) {
          throw error;
        }
        stream.send("sdk", {
          type: "status",
          status: "cli_fallback",
          label: "SDK bridge was unavailable; using CLI transport...",
          timestamp: new Date().toISOString(),
        });
      }
    }

    await streamChatWithCli({ payload, args, displayArgs, workspace, prompt, agentRuntime, timeoutMs, startedAt, stream, signal: abortController.signal });
  } catch (error) {
    const completedAt = Date.now();
    stream.send("error", {
      error: error instanceof Error ? error.message : String(error),
      completedAt: new Date(completedAt).toISOString(),
      durationMs: completedAt - startedAt,
      ...(error instanceof ChatRuntimeError && error.details ? error.details : {}),
    });
  } finally {
    streamOpen = false;
    res.off("close", abortStream);
    stream.end();
  }
}

function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=@-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, "'\\''")}'`;
}

async function openTerminal(payload) {
  const workspace = await cleanWorkspace(payload.workspace);
  const prompt = String(payload.prompt || "").trim();
  const profile = String(payload.profile || "").trim().slice(0, 12000);
  const agentRuntime = await ensureAgentRuntime(payload, workspace);
  const profileArgs = profile ? ` --append-sys-prompt ${shellQuote(profile)}` : "";
  const profileDirArgs = agentRuntime.profileDocs?.path ? ` --add-dir ${shellQuote(agentRuntime.profileDocs.path)}` : "";
  const noIdleLogoutArg = autohandSupportsFlag("--no-idle-logout") ? " --no-idle-logout" : "";
  const envPrefix = `AUTOHAND_HOME=${shellQuote(agentRuntime.agentHome)} AUTOHAND_CONFIG=${shellQuote(agentRuntime.configPath)} AUTOHAND_CLIENT_NAME=${shellQuote(`autohand-squad-${agentRuntime.agentId}`)} AUTOHAND_NO_IDLE_LOGOUT=1`;
  const baseCommand = `${envPrefix} autohand --path ${shellQuote(workspace)} --config ${shellQuote(agentRuntime.configPath)}${noIdleLogoutArg}${profileDirArgs}${profileArgs}`;
  const command = prompt
    ? `cd ${shellQuote(workspace)} && ${baseCommand} --prompt ${shellQuote(prompt)}`
    : `cd ${shellQuote(workspace)} && ${baseCommand}`;
  const script = [
    'tell application "Terminal"',
    `do script ${JSON.stringify(command)}`,
    "activate",
    "end tell",
  ];
  const result = spawnSync("osascript", script.flatMap((line) => ["-e", line]), {
    cwd: workspace,
    encoding: "utf8",
    timeout: 10000,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "could not open Terminal");
  }
  return {
    command,
    workspace,
    configPath: agentRuntime.configPath,
    displayConfigPath: agentRuntime.displayConfigPath,
    effectiveModel: agentRuntime.effectiveModel,
    skillInstall: agentRuntime.skillInstall,
    profileDocs: agentRuntime.profileDocs,
    brainCard: agentRuntime.brainCard,
  };
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/runtime" && req.method === "GET") {
    json(res, 200, { success: true, data: getRuntime() });
    return true;
  }

  if (url.pathname === "/api/setup/login" && req.method === "POST") {
    try {
      json(res, 200, { success: true, data: requestSquadBrowserLogin() });
    } catch (error) {
      json(res, 400, { success: false, error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/workspaces" && req.method === "GET") {
    json(res, 200, { success: true, data: await listWorkspaces() });
    return true;
  }

  if (url.pathname === "/api/workspace-files" && req.method === "GET") {
    try {
      const workspace = url.searchParams.get("workspace") || getDefaultWorkspace();
      const query = url.searchParams.get("q") || "";
      json(res, 200, { success: true, data: await listWorkspaceFiles(workspace, query) });
    } catch (error) {
      json(res, 400, { success: false, error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/analytics" && req.method === "GET") {
    json(res, 200, { success: true, data: await analyticsSnapshot() });
    return true;
  }

  if (url.pathname === "/api/status/snapshot" && req.method === "GET") {
    json(res, 200, { success: true, data: (await readOptionalJsonFile(liveStatusPath)) || null });
    return true;
  }

  if (url.pathname === "/api/status/snapshot" && req.method === "POST") {
    try {
      const payload = await readBody(req);
      json(res, 200, { success: true, data: await writeLiveStatusSnapshot(payload) });
    } catch (error) {
      json(res, 400, { success: false, error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/feedback/screenshot" && req.method === "POST") {
    try {
      const payload = await readBody(req, 5 * 1024 * 1024);
      const route = normalizeFeedbackRoute(payload.route);
      const [screenshot, diagnostics] = await Promise.all([
        captureFeedbackScreenshot({
          route,
          storage: payload.storage || {},
        }),
        collectFeedbackContext(route),
      ]);
      json(res, 200, { success: true, data: { screenshot, diagnostics } });
    } catch (error) {
      json(res, 400, { success: false, error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/feedback/squad" && req.method === "POST") {
    try {
      const payload = await readBody(req, 14 * 1024 * 1024);
      json(res, 200, { success: true, data: await submitSquadFeedback(payload) });
    } catch (error) {
      json(res, 502, { success: false, error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/memory-inbox" && req.method === "GET") {
    json(res, 200, { success: true, data: await readMemoryInboxState() });
    return true;
  }

  if (url.pathname === "/api/memory-inbox" && (req.method === "POST" || req.method === "PUT")) {
    try {
      const payload = await readBody(req);
      json(res, 200, { success: true, data: await writeMemoryInboxState(payload) });
    } catch (error) {
      json(res, 400, { success: false, error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/channels" && req.method === "GET") {
    json(res, 200, { success: true, data: await readChannelsState() });
    return true;
  }

  if (url.pathname === "/api/channels" && req.method === "POST") {
    try {
      const payload = await readBody(req);
      json(res, 201, { success: true, data: await createChannel(payload) });
    } catch (error) {
      json(res, 400, { success: false, error: error.message });
    }
    return true;
  }

  // Snapshot sync used by the web app bridge (same contract as memory-inbox):
  // the client PUTs its full channel/thread state after local changes.
  if (url.pathname === "/api/channels" && req.method === "PUT") {
    try {
      const payload = await readBody(req);
      json(res, 200, { success: true, data: await writeChannelsState(payload) });
    } catch (error) {
      json(res, 400, { success: false, error: error.message });
    }
    return true;
  }

  const channelMatch = url.pathname.match(/^\/api\/channels\/([^/]+)$/);
  if (channelMatch && (req.method === "PATCH" || req.method === "PUT")) {
    try {
      const payload = await readBody(req);
      json(res, 200, { success: true, data: await updateChannel(decodeURIComponent(channelMatch[1]), payload) });
    } catch (error) {
      json(res, error.message === "channel not found" ? 404 : 400, { success: false, error: error.message });
    }
    return true;
  }

  if (channelMatch && req.method === "DELETE") {
    try {
      json(res, 200, { success: true, data: await deleteChannel(decodeURIComponent(channelMatch[1])) });
    } catch (error) {
      json(res, error.message === "channel not found" ? 404 : 400, { success: false, error: error.message });
    }
    return true;
  }

  const channelMembersMatch = url.pathname.match(/^\/api\/channels\/([^/]+)\/members$/);
  if (channelMembersMatch && req.method === "POST") {
    try {
      const payload = await readBody(req);
      json(res, 200, { success: true, data: await updateChannelMembers(decodeURIComponent(channelMembersMatch[1]), payload) });
    } catch (error) {
      json(res, error.message === "channel not found" ? 404 : 400, { success: false, error: error.message });
    }
    return true;
  }

  const channelThreadsMatch = url.pathname.match(/^\/api\/channels\/([^/]+)\/threads$/);
  if (channelThreadsMatch && req.method === "GET") {
    const channelId = decodeURIComponent(channelThreadsMatch[1]);
    const state = await readChannelsState();
    if (!state.channels.some((channel) => channel.id === channelId)) {
      json(res, 404, { success: false, error: "channel not found" });
      return true;
    }
    json(res, 200, { success: true, data: state.threads.filter((thread) => thread.channelId === channelId) });
    return true;
  }

  if (channelThreadsMatch && req.method === "POST") {
    try {
      const payload = await readBody(req);
      json(res, 201, { success: true, data: await recordChannelThread(decodeURIComponent(channelThreadsMatch[1]), payload) });
    } catch (error) {
      json(res, error.message === "channel not found" ? 404 : 400, { success: false, error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/provider-settings" && req.method === "GET") {
    json(res, 200, { success: true, data: await readProviderSettings() });
    return true;
  }

  if (url.pathname === "/api/provider-settings" && (req.method === "POST" || req.method === "PUT")) {
    try {
      const payload = await readBody(req);
      json(res, 200, { success: true, data: await saveProviderSettingsPatch(payload) });
    } catch (error) {
      json(res, 400, { success: false, error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/provider-settings/test" && req.method === "POST") {
    try {
      const payload = await readBody(req);
      json(res, 200, { success: true, data: await testProviderSettings(payload) });
    } catch (error) {
      json(res, 400, { success: false, error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/shutdown" && req.method === "POST") {
    const result = await stopManagedRuns("Autohand Squad service stopped");
    json(res, 200, { success: true, data: result });
    shutdownServer();
    return true;
  }

  if (url.pathname === "/api/agents/provision" && req.method === "POST") {
    try {
      const payload = await readBody(req);
      const workspace = await cleanWorkspace(payload.workspace);
      const agentRuntime = await ensureAgentRuntime(payload, workspace);
      json(res, 200, {
        success: true,
        data: {
          agentId: agentRuntime.agentId,
          agentHome: agentRuntime.agentHome,
          configPath: agentRuntime.configPath,
          displayConfigPath: agentRuntime.displayConfigPath,
          profilePath: agentRuntime.profilePath,
          profileDocs: agentRuntime.profileDocs,
          effectiveModel: agentRuntime.effectiveModel,
          skillInstall: agentRuntime.skillInstall,
        },
      });
    } catch (error) {
      json(res, 400, { success: false, error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/runs" && req.method === "GET") {
    json(res, 200, {
      success: true,
      data: Array.from(runs.values()).map(runSummary).reverse(),
    });
    return true;
  }

  if (url.pathname === "/api/chat" && req.method === "POST") {
    try {
      const payload = await readBody(req);
      json(res, 200, { success: true, data: await chatOnce(payload) });
    } catch (error) {
      json(res, 400, { success: false, error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/chat/stream" && req.method === "POST") {
    try {
      const payload = await readBody(req);
      await streamChat(payload, res);
    } catch (error) {
      json(res, 400, { success: false, error: error.message });
    }
    return true;
  }

  const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (runMatch && req.method === "GET") {
    const run = runs.get(runMatch[1]);
    if (!run) {
      json(res, 404, { success: false, error: "run not found" });
      return true;
    }
    json(res, 200, { success: true, data: runSummary(run) });
    return true;
  }

  // Goal 08: preview a context pack before launch without starting a run.
  if (url.pathname === "/api/context-pack" && req.method === "POST") {
    try {
      const payload = await readBody(req);
      const mode = payload.mode || "prompt";
      const workspace = await cleanWorkspace(payload.workspace);
      const agentRuntime = await ensureAgentRuntime(payload, workspace);
      const pack = generateContextPack(mode, payload, agentRuntime, workspace);
      json(res, 200, { success: true, data: pack });
    } catch (error) {
      json(res, 400, { success: false, error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/runs" && req.method === "POST") {
    try {
      const payload = await readBody(req);
      json(res, 201, { success: true, data: await startRun(payload) });
    } catch (error) {
      json(res, 400, { success: false, error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/terminal" && req.method === "POST") {
    try {
      const payload = await readBody(req);
      json(res, 200, { success: true, data: await openTerminal(payload) });
    } catch (error) {
      json(res, 400, { success: false, error: error.message });
    }
    return true;
  }

  return false;
}

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
]);

async function serveStatic(req, res, url) {
  const requestedPath = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.(\/|\\|$))+/, "");
  const relativePath = requestedPath.replace(/^[/\\]+/, "");
  let filePath = join(distDir, relativePath === "" ? "index.html" : relativePath);
  if (!filePath.startsWith(distDir)) {
    json(res, 403, { success: false, error: "forbidden" });
    return;
  }
  if (!existsSync(filePath)) filePath = join(distDir, "index.html");
  try {
    const fileStat = await stat(filePath);
    res.writeHead(200, {
      "content-type": mimeTypes.get(extname(filePath)) || "application/octet-stream",
      "content-length": fileStat.size,
    });
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}

async function stopAndExitFromSignal(signal) {
  await stopManagedRuns(`web server received ${signal}`);
  process.exit(0);
}

process.once("SIGTERM", () => {
  stopAndExitFromSignal("SIGTERM").catch(() => process.exit(1));
});
process.once("SIGINT", () => {
  stopAndExitFromSignal("SIGINT").catch(() => process.exit(1));
});

if (isPackagedRuntime) {
  await mkdir(appStateDir, { recursive: true });
}

server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${host}:${port}`);
  if (await handleApi(req, res, url)) return;
  if (vite) {
    vite.middlewares(req, res, () => {
      readFile(join(rootDir, "index.html"), "utf8")
        .then((template) => vite.transformIndexHtml(url.pathname, template))
        .then((html) => {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(html);
        })
        .catch((error) => {
          vite.ssrFixStacktrace(error);
          res.writeHead(500);
          res.end(error.stack);
        });
    });
    return;
  }
  await serveStatic(req, res, url);
});

server.listen(port, host, () => {
  console.log(`autohandSWE listening on http://${host}:${port}`);
});
