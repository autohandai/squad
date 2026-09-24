#!/usr/bin/env node
// Checks for folder profiles (server/workspace-profile.mjs) and squad
// recruiting (src/lib/squad-recruiting.js): profiles a scratch Rust + Docker
// service and a scratch React app, then verifies that a frontend-only channel
// is offered the DevOps member for the service and nothing for the React app.

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { profileWorkspace } from "../server/workspace-profile.mjs";
import { firstPromptFor, needsServedBy, proposalCopy, proposeMembers, suggestRoles } from "../src/lib/squad-recruiting.js";
import { presenceFromMessages, presenceSentence } from "../src/lib/presence.js";

const root = await mkdtemp(join(tmpdir(), "squad-recruiting-"));
try {
  const service = join(root, "api");
  await mkdir(join(service, "src"), { recursive: true });
  await mkdir(join(service, ".github", "workflows"), { recursive: true });
  await writeFile(join(service, "Cargo.toml"), "[package]\nname = \"api\"\n");
  await writeFile(join(service, "Dockerfile"), "FROM rust:1\n");
  await writeFile(join(service, "src", "main.rs"), "fn main() {}\n");
  await writeFile(join(service, "src", "lib.rs"), "pub fn x() {}\n");
  await writeFile(join(service, "src", "db.rs"), "pub fn y() {}\n");

  const app = join(root, "shop");
  await mkdir(join(app, "src"), { recursive: true });
  await writeFile(join(app, "package.json"), JSON.stringify({ name: "shop", dependencies: { react: "19", vite: "6" }, devDependencies: { vitest: "3" } }));
  await writeFile(join(app, "index.html"), "<html></html>");
  await writeFile(join(app, "src", "App.tsx"), "export default () => null;\n");
  await writeFile(join(app, "src", "main.tsx"), "import './App';\n");
  await writeFile(join(app, "src", "App.test.tsx"), "test('x', () => {});\n");

  const serviceProfile = await profileWorkspace(service);
  assert.deepEqual(serviceProfile.languages, ["Rust"], "service language");
  assert.ok(serviceProfile.needs.includes("backend") && serviceProfile.needs.includes("infra"), `service needs: ${serviceProfile.needs}`);
  assert.ok(serviceProfile.frameworks.includes("Docker") && serviceProfile.frameworks.includes("GitHub Actions"), `service frameworks: ${serviceProfile.frameworks}`);
  assert.equal(serviceProfile.summary, "A Rust service with Docker and GitHub Actions.");
  assert.match(serviceProfile.signature, /^[0-9a-f]{12}$/);

  const appProfile = await profileWorkspace(app);
  assert.ok(appProfile.frameworks.includes("React") && appProfile.frameworks.includes("Vite"), `app frameworks: ${appProfile.frameworks}`);
  assert.ok(appProfile.needs.includes("frontend") && appProfile.needs.includes("tests"), `app needs: ${appProfile.needs}`);
  assert.equal(appProfile.summary, "A React and Vite web app with tests.");
  assert.notEqual(appProfile.signature, serviceProfile.signature, "signatures differ");

  const noah = { id: "noah", name: "Noah", role: "Frontend Developer", employeeType: "frontend-developer", status: "online" };
  const kai = { id: "kai", name: "Kai", role: "DevOps Engineer", employeeType: "devops-engineer", status: "online" };
  const iris = { id: "iris", name: "Iris", role: "Code Reviewer", employeeType: "solution-architect", status: "online" };
  const eva = { id: "eva", name: "Eva", role: "QA Engineer", employeeType: "common-qa-engineer", status: "offline" };

  const forService = proposeMembers({ projects: [{ name: "api", profile: serviceProfile }], members: [noah], candidates: [noah, kai, iris, eva] });
  // Both serve one uncovered need; names break the tie.
  assert.deepEqual(forService.map((item) => item.agent.id), ["iris", "kai"], "service proposals");
  assert.deepEqual(forService[0].needs, ["backend"]);
  assert.deepEqual(forService[1].needs, ["infra"]);
  const copy = proposalCopy(forService[1], "client-abc");
  assert.equal(copy.title, "Kai wants to join #client-abc — DevOps Engineer");
  assert.equal(copy.body, "Kai can help with the Dockerfile and CI in api; nobody in the channel covers that yet.");

  const forApp = proposeMembers({ projects: [{ name: "shop", profile: appProfile }], members: [noah, eva], candidates: [noah, kai, iris, eva] });
  // Tests are uncovered (Eva is offline and excluded) but no online candidate serves them.
  assert.deepEqual(forApp, [], "react app with a frontend developer proposes nobody");

  const evaOnline = { ...eva, status: "online" };
  const withQa = proposeMembers({ projects: [{ name: "shop", profile: appProfile }], members: [noah], candidates: [kai, iris, evaOnline] });
  assert.deepEqual(withQa.map((item) => item.agent.id), ["eva"], "QA proposed for tests");

  const templates = [
    { id: "frontend-developer", title: "Frontend Developer" },
    { id: "backend-engineer", title: "Backend Engineer" },
    { id: "devops-engineer", title: "DevOps Engineer" },
    { id: "technical-writer", title: "Technical Writer" },
    { id: "full-stack-developer", title: "Full Stack Developer" },
  ];
  assert.deepEqual(suggestRoles(serviceProfile, templates).map((item) => item.template.id), ["backend-engineer", "devops-engineer", "full-stack-developer"], "role suggestions for the service");
  assert.deepEqual(suggestRoles({ needs: [] }, templates).map((item) => item.template.id), ["full-stack-developer", "frontend-developer", "backend-engineer"], "default role order");
  assert.deepEqual(needsServedBy({ role: "Release Manager" }), ["infra"], "keyword fallback");
  assert.equal(firstPromptFor("Backend Engineer", "api", serviceProfile.summary), "Walk me through api (Rust service with Docker and GitHub Actions) and tell me what you'd tackle first as a Backend Engineer.");

  // Presence (ADR-0014): placeholder → thinking, text → typing, tool activity → tools.
  const agents = [noah, kai, iris, evaOnline];
  const items = presenceFromMessages(
    [
      { role: "agent", agentId: "noah", status: "loading", body: "Noah is typing..." },
      { role: "agent", agentId: "kai", status: "loading", body: "Checking the Dockerfile", activityLabel: "Replying in #api" },
      { role: "agent", agentId: "iris", status: "loading", body: "", activityLabel: "Running tool: shell" },
      { role: "agent", agentId: "eva", status: "done", body: "All good." },
      { role: "agent", agentId: "eva", status: "loading", body: "⚠ Session encountered an error", updatedAt: new Date().toISOString() },
      { role: "agent", agentId: "eva", status: "loading", body: "old", updatedAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString() },
      { role: "user", agentId: "", status: "loading", body: "ignored" },
    ],
    agents
  );
  assert.deepEqual(items.map((item) => `${item.agent.id}:${item.state}`), ["noah:thinking", "kai:typing", "iris:tools"], "presence states");
  assert.equal(presenceSentence(["Iris"], "thinking"), "Iris is thinking…");
  assert.equal(presenceSentence(["Iris", "Noah"], "typing"), "Iris and Noah are typing…");
  assert.equal(presenceSentence(["Iris", "Noah", "Kai", "Eva"], "thinking"), "Iris, Noah and 2 others are thinking…");
  assert.equal(presenceSentence(["Iris", "Noah", "Kai"], "tools"), "Iris, Noah and 1 other are running tools…");
  console.log("Squad recruiting and presence checks passed.");
} finally {
  await rm(root, { recursive: true, force: true });
}
