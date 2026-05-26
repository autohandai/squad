import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
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
const distDir = join(rootDir, "dist");
const homeDir = resolve(homedir());
const squadMemberIdPrefix = "asq_";
const legacySquadMemberIdPrefixes = ["wk_"];
const squadWorkspaceRoot = join(homeDir, ".autohandsquad");
const legacySquadWorkspaceRoots = [join(homeDir, ".qoderwake"), join(homeDir, ".autohand-squad")];
const appStateDir = join(rootDir, ".autohand");
const isolatedAgentsDir = join(appStateDir, "agents");
const autohandStateRoot = process.env.AUTOHAND_HOME
  ? resolve(process.env.AUTOHAND_HOME)
  : join(homeDir, ".autohand");
const squadStateDir = process.env.AUTOHAND_SQUAD_HOME
  ? resolve(process.env.AUTOHAND_SQUAD_HOME)
  : join(autohandStateRoot, "squad");
const runs = new Map();
let server = null;
let shuttingDown = false;
const skilledBaseUrl = "https://skilled.autohand.ai";
const skilledCatalogUrl = `${skilledBaseUrl}/skills-index.json`;
const defaultSkillsRepo = "autohandai/community-skills";
const localCommunitySkillsDir = process.env.AUTOHAND_SKILLS_REPO_DIR
  ? resolve(process.env.AUTOHAND_SKILLS_REPO_DIR)
  : resolve(rootDir, "../../..", "community-skills");
const skillCatalogCache = { loadedAt: 0, data: null };
const projectLimitUpperBound = 5;
const maxProjectsPerMember = normalizeProjectLimit(process.env.AUTOHAND_SQUAD_MAX_PROJECTS_PER_MEMBER);
const handoffRetryMode = normalizeHandoffRetryMode(process.env.AUTOHAND_SQUAD_HANDOFF_RETRY_MODE);
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
  });
  return result.status === 0 ? result.stdout.trim() : "";
}

const cliHelpCache = { text: null };

function autohandHelpText() {
  if (cliHelpCache.text === null) {
    cliHelpCache.text = commandOutput("autohand", ["--help"]);
  }
  return cliHelpCache.text;
}

function autohandSupportsFlag(flag) {
  return autohandHelpText().includes(flag);
}

function getRuntime() {
  const autohandPath = commandOutput("which", ["autohand"]);
  const version = autohandPath ? commandOutput("autohand", ["--version"]) : "";
  return {
    autohandPath,
    version,
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
    serverStartedAt,
  };
}

const serverStartedAt = new Date().toISOString();

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

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
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
    rootDir,
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

  if (isRunnableWorkspace(rootDir)) {
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

  const currentWorkspace = byPath.get(rootDir);
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
    fileName: "PERSONA.md",
    aliases: ["PERSONALITY.md"],
    title: "Persona",
    meaning: "tone, collaboration style, behavioral defaults, and escalation rules",
  },
  {
    section: "bible",
    fileName: "BIBLE.md",
    title: "Bible",
    meaning: "workflow rules, verification expectations, tools, and boundaries",
  },
  {
    section: "memory",
    fileName: "MEMORY.md",
    title: "Memory",
    meaning: "durable agent-specific context, saved learnings, and project preferences",
  },
];

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
      "# Persona",
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

  if (personaFile?.fileName === "PERSONALITY.md") {
    lines.push("- `PERSONALITY.md` is accepted as the persona/work-style alias for `PERSONA.md`.");
  } else {
    lines.push("- `PERSONALITY.md` is accepted as an alias for persona/work-style content when present.");
  }

  lines.push(
    "",
    "## Usage",
    "- Use `IDENTITY.md` for role scope, ownership, and responsibility questions.",
    "- Use `PERSONA.md` or `PERSONALITY.md` for tone, collaboration, and behavioral defaults.",
    "- Use `BIBLE.md` for workflow, verification, and operating rules.",
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
  const profileDocs = await writeAgentProfileDocs(agent, agentHome, agentId, workspace, skillInstall);

  if (!existsSync(configPath)) {
    const userConfigPath = join(homeDir, ".autohand", "config.json");
    if (existsSync(userConfigPath)) {
      await copyFile(userConfigPath, configPath);
    } else {
      await writeFile(configPath, JSON.stringify(defaultAgentConfig(workspace), null, 2), "utf8");
    }
  }

  try {
    const config = JSON.parse(await readFile(configPath, "utf8"));
    const permissionSettings = permissionSettingsFromAgent(agent);
    const modelSecurityConfig = modelSecurityConfigFromAgent(agent, config);
    const normalizedPermissions = normalizeAgentPermissions(agent);
    const nextConfig = {
      ...config,
      ...modelSecurityConfig,
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
        permissionsUi: normalizedPermissions,
        modelSecurity: normalizedPermissions.modelSecurity,
      },
      permissions: {
        ...(config.permissions && typeof config.permissions === "object" ? config.permissions : {}),
        ...permissionSettings,
      },
    };
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
        skills: skillInstall.requested,
        skillSource: skilledBaseUrl,
        skillInstall,
        profileDocs,
        permissions: normalizeAgentPermissions(agent),
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

  return { agentId, agentHome, configPath, profilePath, displayConfigPath, displayProfileDir, skillInstall, profileDocs };
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

  if (input.model) {
    pushArg("--model", String(input.model));
  } else if (permissions.modelSecurityEnabled && permissions.modelSecurity.model) {
    pushArg("--model", permissions.modelSecurity.model);
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
    skillInstall: run.skillInstall,
    profileDocs: run.profileDocs,
    command: run.command,
    status: run.status,
    exitCode: run.exitCode,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
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
    if (child && !child.killed) {
      try {
        child.kill("SIGTERM");
        stoppedRuns += 1;
      } catch (error) {
        appendLog(run, "system", `stop failed: ${error.message}`);
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
  if (run.logs.length > 600) run.logs.splice(0, run.logs.length - 600);
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

  const [daemonRecord, analyticsRecord, webServerRecord, installRecord, updateRecord, queueItems, diskRuns, telemetry] =
    await Promise.all([
      readOptionalJsonFile(join(squadStateDir, "daemon.json")),
      readOptionalJsonFile(join(squadStateDir, "analytics.json")),
      readOptionalJsonFile(join(squadStateDir, "web-server.json")),
      readOptionalJsonFile(join(squadStateDir, "install.json")),
      readOptionalJsonFile(join(squadStateDir, "update.json")),
      readJsonDir(join(squadStateDir, "queue")),
      readJsonDir(join(squadStateDir, "runs")),
      readJsonLines(join(squadStateDir, "telemetry.jsonl")),
    ]);

  const runtimeRuns = Array.from(runs.values()).map(runSummary);
  const runMap = new Map();
  for (const run of [...diskRuns, ...runtimeRuns]) {
    if (run?.id) runMap.set(run.id, run);
  }
  const allRuns = Array.from(runMap.values());
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
      queueDepth: queueItems.length,
      queuedJobs: queueItems.filter((item) => item.status === "queued").length,
      scheduledJobs: queueItems.filter((item) => item.scheduledFor || item.scheduled_for).length,
      activeWork: activeRuns.length + queueItems.filter((item) => ["queued", "running"].includes(item.status)).length,
      onlineMembers: Math.max(activeAgents.size, activeRuns.length),
      workingAgents: Math.max(activeAgents.size, activeRuns.length),
      totalRuns: allRuns.length,
      runningRuns: activeRuns.length,
      completedRuns: completedRuns.length,
      failedRuns: failedRuns.length,
      rejectedRuns: rejectedRuns.length,
      queueVolume: queueItems.length + allRuns.length,
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
    timestamps: {
      lastDeviceRegistrationAt: valueField(await readOptionalJsonFile(join(squadStateDir, "device-registration.json")), ["registeredAt", "registered_at"]),
      lastPingAt: valueField(await readOptionalJsonFile(join(squadStateDir, "ping.json")), ["pingedAt", "pinged_at"]),
      lastFeatureFlagCheckAt: valueField(await readOptionalJsonFile(join(squadStateDir, "feature-flags.json")), ["checkedAt", "checked_at"]),
      lastTelemetryFlushAt: valueField(await readOptionalJsonFile(join(squadStateDir, "telemetry-flush.json")), ["flushedAt", "flushed_at"]),
      lastSyncAt: valueField(await readOptionalJsonFile(join(squadStateDir, "sync.json")), ["syncedAt", "synced_at"]),
      lastUpdateCheckAt: valueField(updateRecord, ["checkedAt", "checked_at"]),
      lastSnapshotAt: generatedAt,
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

async function startRun(payload) {
  const { args, displayArgs, workspace, prompt, mode, agentRuntime } = await autohandArgs(payload);
  if (!prompt && mode !== "permissions") {
    throw new Error("prompt is required");
  }

  const id = randomUUID();
  const run = {
    id,
    agentId: payload.agentId || agentRuntime.agentId,
    title: payload.title || prompt || "Autohand permissions",
    mode,
    workspace,
    configPath: agentRuntime.configPath,
    displayConfigPath: agentRuntime.displayConfigPath,
    agentHome: agentRuntime.agentHome,
    skillInstall: agentRuntime.skillInstall,
    profileDocs: agentRuntime.profileDocs,
    command: `autohand ${displayArgs.map(shellQuote).join(" ")}`,
    status: "running",
    exitCode: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    logs: [],
  };
  runs.set(id, run);

  const child = spawn("autohand", args, {
    cwd: workspace,
    env: {
      ...process.env,
      AUTOHAND_HOME: agentRuntime.agentHome,
      AUTOHAND_CONFIG: agentRuntime.configPath,
      AUTOHAND_CLIENT_NAME: `autohand-squad-${agentRuntime.agentId}`,
      AUTOHAND_NO_IDLE_LOGOUT: "1",
      FORCE_COLOR: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
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
      return;
    }
    run.status = code === 0 ? "completed" : "failed";
    run.finishedAt = new Date().toISOString();
    appendLog(run, "system", `exited with code ${code}`);
  });

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

  const requestedTimeout = Number(payload.timeoutMs);
  const timeoutMs = Number.isFinite(requestedTimeout)
    ? Math.min(Math.max(requestedTimeout, 15000), 300000)
    : 180000;
  const command = `autohand ${displayArgs.map(shellQuote).join(" ")}`;
  const startedAt = Date.now();

  const output = await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn("autohand", args, {
      cwd: workspace,
      env: {
        ...process.env,
        AUTOHAND_HOME: agentRuntime.agentHome,
        AUTOHAND_CONFIG: agentRuntime.configPath,
        AUTOHAND_CLIENT_NAME: `autohand-squad-${agentRuntime.agentId}`,
        AUTOHAND_NO_IDLE_LOGOUT: "1",
        FORCE_COLOR: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
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

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new Error("chat timed out waiting for Autohand"), {
        exitCode: null,
        stdout,
        stderr,
      });
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
  if (output.exitCode !== 0) {
    throw new Error(reply || `Autohand exited with code ${output.exitCode}`);
  }

  return {
    reply: reply || "Autohand returned no chat text.",
    trace,
    workspace,
    command,
    configPath: agentRuntime.configPath,
    displayConfigPath: agentRuntime.displayConfigPath,
    agentHome: agentRuntime.agentHome,
    skillInstall: agentRuntime.skillInstall,
    profileDocs: agentRuntime.profileDocs,
  };
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
    skillInstall: agentRuntime.skillInstall,
    profileDocs: agentRuntime.profileDocs,
  };
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/runtime" && req.method === "GET") {
    json(res, 200, { success: true, data: getRuntime() });
    return true;
  }

  if (url.pathname === "/api/workspaces" && req.method === "GET") {
    json(res, 200, { success: true, data: await listWorkspaces() });
    return true;
  }

  if (url.pathname === "/api/workspace-files" && req.method === "GET") {
    try {
      const workspace = url.searchParams.get("workspace") || rootDir;
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
