// Folder profile: a cheap, deterministic description of what a project folder
// is made of, used by onboarding (which teammate to suggest) and by squad
// recruiting (which members a channel is missing). See ADR-0015.
//
// Inputs are marker files, package.json dependencies, and file extensions in
// the top two directory levels. No other file contents are read.

import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { createHash } from "node:crypto";

export const NEEDS = ["frontend", "backend", "mobile", "infra", "tests", "docs", "data", "security", "ai"];

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", "target", "coverage", ".next", ".nuxt", ".turbo", ".vite",
  "vendor", "__pycache__", ".venv", "venv", "Pods", "DerivedData", ".cache", ".idea", ".vscode", "tmp",
]);
const MAX_ENTRIES = 4000;
const MAX_DEPTH = 2;

const EXTENSION_LANGUAGES = {
  ".ts": "TypeScript", ".tsx": "TypeScript", ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
  ".rs": "Rust", ".go": "Go", ".py": "Python", ".rb": "Ruby", ".swift": "Swift", ".kt": "Kotlin", ".java": "Java",
  ".dart": "Dart", ".cs": "C#", ".php": "PHP", ".ex": "Elixir", ".exs": "Elixir", ".scala": "Scala", ".c": "C", ".cpp": "C++", ".h": "C",
  ".sql": "SQL", ".tf": "HCL", ".sh": "Shell", ".css": "CSS", ".scss": "CSS", ".html": "HTML", ".vue": "Vue", ".svelte": "Svelte",
};

// Marker file or directory name → what it tells us.
const MARKERS = [
  { name: "package.json", languages: ["JavaScript"] },
  { name: "tsconfig.json", languages: ["TypeScript"] },
  { name: "bun.lock", languages: ["JavaScript"] },
  { name: "Cargo.toml", languages: ["Rust"], needs: ["backend"] },
  { name: "go.mod", languages: ["Go"], needs: ["backend"] },
  { name: "pyproject.toml", languages: ["Python"], needs: ["backend"] },
  { name: "requirements.txt", languages: ["Python"], needs: ["backend"] },
  { name: "setup.py", languages: ["Python"], needs: ["backend"] },
  { name: "Gemfile", languages: ["Ruby"], needs: ["backend"] },
  { name: "composer.json", languages: ["PHP"], needs: ["backend"] },
  { name: "mix.exs", languages: ["Elixir"], needs: ["backend"] },
  { name: "Package.swift", languages: ["Swift"], frameworks: ["Swift Package"], needs: ["mobile"] },
  { name: "pubspec.yaml", languages: ["Dart"], frameworks: ["Flutter"], needs: ["mobile"] },
  { name: "build.gradle", languages: ["Kotlin"], frameworks: ["Gradle"] },
  { name: "build.gradle.kts", languages: ["Kotlin"], frameworks: ["Gradle"] },
  { name: "AndroidManifest.xml", frameworks: ["Android"], needs: ["mobile"] },
  { name: "Dockerfile", frameworks: ["Docker"], needs: ["infra"] },
  { name: "docker-compose.yml", frameworks: ["Docker Compose"], needs: ["infra"] },
  { name: "docker-compose.yaml", frameworks: ["Docker Compose"], needs: ["infra"] },
  { name: "compose.yaml", frameworks: ["Docker Compose"], needs: ["infra"] },
  { name: ".github", frameworks: ["GitHub Actions"], needs: ["infra"], dir: true },
  { name: ".gitlab-ci.yml", frameworks: ["GitLab CI"], needs: ["infra"] },
  { name: "Jenkinsfile", frameworks: ["Jenkins"], needs: ["infra"] },
  { name: "terraform", frameworks: ["Terraform"], needs: ["infra"], dir: true },
  { name: "k8s", frameworks: ["Kubernetes"], needs: ["infra"], dir: true },
  { name: "kubernetes", frameworks: ["Kubernetes"], needs: ["infra"], dir: true },
  { name: "helm", frameworks: ["Helm"], needs: ["infra"], dir: true },
  { name: "wrangler.toml", frameworks: ["Cloudflare Workers"], needs: ["infra", "backend"] },
  { name: "vercel.json", frameworks: ["Vercel"], needs: ["infra"] },
  { name: "netlify.toml", frameworks: ["Netlify"], needs: ["infra"] },
  { name: "fly.toml", frameworks: ["Fly.io"], needs: ["infra"] },
  { name: "src-tauri", frameworks: ["Tauri"], needs: ["frontend"], dir: true },
  { name: "index.html", needs: ["frontend"] },
  { name: "tests", needs: ["tests"], dir: true },
  { name: "test", needs: ["tests"], dir: true },
  { name: "__tests__", needs: ["tests"], dir: true },
  { name: "spec", needs: ["tests"], dir: true },
  { name: "e2e", needs: ["tests"], dir: true },
  { name: "cypress", frameworks: ["Cypress"], needs: ["tests"], dir: true },
  { name: "playwright.config.ts", frameworks: ["Playwright"], needs: ["tests"] },
  { name: "playwright.config.js", frameworks: ["Playwright"], needs: ["tests"] },
  { name: "vitest.config.ts", frameworks: ["Vitest"], needs: ["tests"] },
  { name: "jest.config.js", frameworks: ["Jest"], needs: ["tests"] },
  { name: "pytest.ini", frameworks: ["pytest"], needs: ["tests"] },
  { name: "docs", needs: ["docs"], dir: true },
  { name: "mkdocs.yml", frameworks: ["MkDocs"], needs: ["docs"] },
  { name: "docusaurus.config.js", frameworks: ["Docusaurus"], needs: ["docs"] },
  { name: "CHANGELOG.md", needs: ["docs"] },
  { name: "prisma", frameworks: ["Prisma"], needs: ["data", "backend"], dir: true },
  { name: "migrations", needs: ["data"], dir: true },
  { name: "drizzle.config.ts", frameworks: ["Drizzle"], needs: ["data", "backend"] },
  { name: "dbt_project.yml", frameworks: ["dbt"], needs: ["data"] },
  { name: "alembic.ini", frameworks: ["Alembic"], needs: ["data"] },
  { name: "SECURITY.md", needs: ["security"] },
  { name: ".snyk", frameworks: ["Snyk"], needs: ["security"] },
  { name: "openapi.yaml", frameworks: ["OpenAPI"], needs: ["backend", "docs"] },
  { name: "openapi.json", frameworks: ["OpenAPI"], needs: ["backend", "docs"] },
];

// package.json dependency → framework and needs.
const DEPENDENCY_SIGNALS = [
  { test: /^react$/, frameworks: ["React"], needs: ["frontend"] },
  { test: /^next$/, frameworks: ["Next.js"], needs: ["frontend", "backend"] },
  { test: /^vue$/, frameworks: ["Vue"], needs: ["frontend"] },
  { test: /^nuxt$/, frameworks: ["Nuxt"], needs: ["frontend", "backend"] },
  { test: /^svelte$/, frameworks: ["Svelte"], needs: ["frontend"] },
  { test: /^@angular\/core$/, frameworks: ["Angular"], needs: ["frontend"] },
  { test: /^vite$/, frameworks: ["Vite"], needs: ["frontend"] },
  { test: /^tailwindcss$/, frameworks: ["Tailwind CSS"], needs: ["frontend"] },
  { test: /^react-native$/, frameworks: ["React Native"], needs: ["mobile"] },
  { test: /^expo$/, frameworks: ["Expo"], needs: ["mobile"] },
  { test: /^electron$/, frameworks: ["Electron"], needs: ["frontend"] },
  { test: /^@tauri-apps\/(api|cli)$/, frameworks: ["Tauri"], needs: ["frontend"] },
  { test: /^express$/, frameworks: ["Express"], needs: ["backend"] },
  { test: /^fastify$/, frameworks: ["Fastify"], needs: ["backend"] },
  { test: /^hono$/, frameworks: ["Hono"], needs: ["backend"] },
  { test: /^koa$/, frameworks: ["Koa"], needs: ["backend"] },
  { test: /^@nestjs\/core$/, frameworks: ["NestJS"], needs: ["backend"] },
  { test: /^prisma$|^@prisma\/client$/, frameworks: ["Prisma"], needs: ["data", "backend"] },
  { test: /^drizzle-orm$/, frameworks: ["Drizzle"], needs: ["data", "backend"] },
  { test: /^mongoose$/, frameworks: ["Mongoose"], needs: ["data", "backend"] },
  { test: /^(pg|mysql2|better-sqlite3|knex|sequelize|typeorm)$/, needs: ["data", "backend"] },
  { test: /^(vitest|jest|mocha|ava)$/, needs: ["tests"] },
  { test: /^(@playwright\/test|playwright)$/, frameworks: ["Playwright"], needs: ["tests"] },
  { test: /^cypress$/, frameworks: ["Cypress"], needs: ["tests"] },
  { test: /^(@storybook\/react|storybook)$/, frameworks: ["Storybook"], needs: ["frontend", "docs"] },
  { test: /^(next-auth|passport|jsonwebtoken|jose|@auth\/core|better-auth)$/, needs: ["security"] },
  { test: /^helmet$/, needs: ["security"] },
  { test: /^(openai|@anthropic-ai\/sdk|langchain|@langchain\/core|ai|@ai-sdk\/.*|@autohandai\/agent-sdk)$/, frameworks: ["LLM SDK"], needs: ["ai"] },
];

const NEED_LABELS = {
  frontend: "a UI",
  backend: "service code",
  mobile: "a mobile app",
  infra: "infra and CI",
  tests: "tests",
  docs: "docs",
  data: "a data layer",
  security: "auth and security",
  ai: "AI integration",
};

/**
 * Profile a folder. Returns { path, name, languages, frameworks, needs,
 * markers, fileCount, summary, signature }.
 */
export async function profileWorkspace(path) {
  const languages = new Map();
  const frameworks = new Set();
  const needs = new Set();
  const markers = new Set();
  let fileCount = 0;
  let entries = 0;
  let packageJson = null;

  async function scan(dir, depth) {
    let list = [];
    try {
      list = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of list) {
      if (entries >= MAX_ENTRIES) return;
      entries += 1;
      const name = entry.name;
      const isDir = entry.isDirectory();
      if (isDir && (SKIP_DIRS.has(name) || (name.startsWith(".") && name !== ".github"))) continue;
      for (const marker of MARKERS) {
        if (marker.name === name && Boolean(marker.dir) === isDir) {
          markers.add(name);
          for (const language of marker.languages || []) bump(languages, language, 5);
          for (const framework of marker.frameworks || []) frameworks.add(framework);
          for (const need of marker.needs || []) needs.add(need);
        }
      }
      if (isDir) {
        if (depth < MAX_DEPTH) await scan(join(dir, name), depth + 1);
        continue;
      }
      fileCount += 1;
      const extension = extname(name).toLowerCase();
      const language = EXTENSION_LANGUAGES[extension];
      if (language) bump(languages, language, 1);
      if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(name) || /_test\.(go|py|rb)$/.test(name)) needs.add("tests");
      if (extension === ".ipynb") {
        needs.add("data");
        bump(languages, "Python", 1);
      }
      if (extension === ".tf") needs.add("infra");
      if (depth === 0 && name === "package.json" && !packageJson) {
        packageJson = await readFile(join(dir, name), "utf8").catch(() => null);
      }
    }
  }

  await scan(path, 0);

  if (packageJson) {
    try {
      const parsed = JSON.parse(packageJson);
      const dependencies = Object.keys({ ...(parsed.dependencies || {}), ...(parsed.devDependencies || {}) });
      for (const dependency of dependencies) {
        for (const signal of DEPENDENCY_SIGNALS) {
          if (signal.test.test(dependency)) {
            for (const framework of signal.frameworks || []) frameworks.add(framework);
            for (const need of signal.needs || []) needs.add(need);
          }
        }
      }
      if (parsed.workspaces) frameworks.add("Monorepo");
    } catch {
      // A broken package.json is still a JavaScript project.
    }
  }

  // Frontend markup without a framework still means UI work.
  if ((languages.get("HTML") || 0) >= 2 || (languages.get("CSS") || 0) >= 2) needs.add("frontend");
  if ((languages.get("SQL") || 0) >= 2) needs.add("data");

  const rankedLanguages = [...languages.entries()]
    .filter(([, weight]) => weight >= 3)
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name)
    .slice(0, 4);
  const rankedNeeds = NEEDS.filter((need) => needs.has(need));
  const rankedFrameworks = [...frameworks].sort();
  const profile = {
    path,
    name: basename(path),
    languages: rankedLanguages,
    frameworks: rankedFrameworks,
    needs: rankedNeeds,
    markers: [...markers].sort(),
    fileCount,
  };
  profile.summary = summarize(profile);
  profile.signature = createHash("sha256")
    .update(JSON.stringify([profile.languages, profile.frameworks, profile.needs, profile.markers]))
    .digest("hex")
    .slice(0, 12);
  return profile;
}

function bump(map, key, weight) {
  map.set(key, (map.get(key) || 0) + weight);
}

/** One plain sentence: "A React and TypeScript app with tests, Docker, and GitHub Actions." */
export function summarize(profile) {
  // Frameworks name the stack better than languages ("React and Vite" rather
  // than "JavaScript"); languages only speak when no framework does.
  const namedFrameworks = profile.frameworks.filter(
    (name) => !["Docker", "Docker Compose", "GitHub Actions", "GitLab CI", "Jenkins", "Monorepo", "Gradle", "LLM SDK", "Swift Package"].includes(name)
  );
  const stack = (namedFrameworks.length ? namedFrameworks : profile.languages).slice(0, 2);
  const kind = profile.needs.includes("mobile")
    ? "mobile app"
    : profile.needs.includes("frontend") && profile.needs.includes("backend")
      ? "full-stack app"
      : profile.needs.includes("frontend")
        ? "web app"
        : profile.needs.includes("backend")
          ? "service"
          : profile.fileCount === 0
            ? "empty folder"
            : "project";
  const extras = [];
  if (profile.needs.includes("tests")) extras.push("tests");
  if (profile.frameworks.includes("Docker") || profile.frameworks.includes("Docker Compose")) extras.push("Docker");
  if (profile.frameworks.includes("GitHub Actions")) extras.push("GitHub Actions");
  if (profile.needs.includes("data") && !extras.includes("Docker")) extras.push(NEED_LABELS.data);
  if (profile.needs.includes("docs")) extras.push("docs");
  const head = stack.length ? `${article(stack[0])} ${joinNames(stack)} ${kind}` : `${article(kind)} ${kind}`;
  const tail = extras.length ? ` with ${joinNames(extras)}` : "";
  return `${capitalize(head)}${tail}.`;
}

export function needLabel(need) {
  return NEED_LABELS[need] || need;
}

function joinNames(items) {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function article(word) {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
