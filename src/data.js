import { AUTOHAND_SKILLS_REGISTRY_URL, roleTemplates } from "./lib/member-profiles.js";
import { BIRDS, birdAvatarSrc, untakenBird } from "./lib/bird-cast.js";
export { AUTOHAND_SKILLS_REGISTRY_URL, roleTemplates };

export { brainCardFields } from "./lib/brain-card.js";


// The bird cast (ADR-0235, ADR-0243): 300 birds. The ten New Zealand birds
// carry a subtle role hint, so members read as a team at a glance; the rest
// are picked by hand. The picker lists them by name, never by country.
export const birdAvatarOptions = [
  { id: "bird-kiwi", label: "Kiwi", src: "/avatars/birds/kiwi.webp", roles: ["common-qa-engineer", "qa"] },
  { id: "bird-kea", label: "Kea", src: "/avatars/birds/kea.webp", roles: ["frontend-developer", "full-stack-developer", "frontend"] },
  { id: "bird-tui", label: "Tūī", src: "/avatars/birds/tui.webp", roles: ["code-reviewer", "reviewer", "review"] },
  { id: "bird-fantail", label: "Pīwakawaka", src: "/avatars/birds/fantail.webp", roles: ["devops-engineer", "devops", "sre"] },
  { id: "bird-kakapo", label: "Kākāpō", src: "/avatars/birds/kakapo.webp", roles: ["solution-architect", "ai-engineer", "architect"] },
  { id: "bird-pukeko", label: "Pūkeko", src: "/avatars/birds/pukeko.webp", roles: ["data-analyst", "analyst", "data"] },
  { id: "bird-ruru", label: "Ruru", src: "/avatars/birds/ruru.webp", roles: ["security-engineer", "security"] },
  { id: "bird-takahe", label: "Takahē", src: "/avatars/birds/takahe.webp", roles: ["platform-engineer", "backend-engineer", "backend", "platform"] },
  { id: "bird-kereru", label: "Kererū", src: "/avatars/birds/kereru.webp", roles: ["ux-ui-designer", "content-operations-specialist", "designer", "design", "content"] },
  { id: "bird-kotare", label: "Kōtare", src: "/avatars/birds/kotare.webp", roles: ["mobile-developer", "mobile", "ios", "android"] },
  // Everyone else in the cast: picked by hand, no role hints.
  ...BIRDS.filter((bird) => bird.region !== "nz").map((bird) => ({ id: `bird-${bird.id}`, label: bird.label, src: birdAvatarSrc(bird.id), roles: [] })),
];

/**
 * Pick the bird for a role id or free-text role. A known role keeps its bird,
 * because the role hint is the point of the set. Any other member gets a bird
 * nobody in `taken` (avatar URLs already on the roster) has yet, starting from
 * one derived from the seed (ADR-0235).
 */
export function birdAvatarForRole(employeeType = "", roleText = "", seed = "", taken = []) {
  const haystack = `${employeeType} ${roleText}`.toLowerCase();
  const match = birdAvatarOptions.find((bird) => bird.roles.some((role) => haystack.includes(role)));
  if (match) return match.src;
  return birdAvatarSrc(untakenBird(seed || haystack, taken));
}

// Only the drawn birds are built in (ADR-0240). Role portraits, riso prints
// and skin portraits were removed and must not come back.
export const builtInAvatarOptions = birdAvatarOptions.map(({ id, label, src }) => ({ id, label, src }));

// Members are provisioned after repository selection; no demo roster ships.
export const initialAgents = [];

// Squad channels: channel-level coordination with public/private visibility
// and per-channel squad-member membership. Auto mode (self-judge) is always
// seeded OFF; members ask before irreversible actions unless a channel
// explicitly enables it.
export const CHANNEL_VISIBILITY_PUBLIC = "public";
export const CHANNEL_VISIBILITY_PRIVATE = "private";
export const CHANNEL_VISIBILITIES = [CHANNEL_VISIBILITY_PUBLIC, CHANNEL_VISIBILITY_PRIVATE];

export const initialChannels = [];

export const initialTasks = [];

export const initialMemoryInbox = [];

export const initialAutomations = [];

// Goal 09: Run Recipes — built-in catalog of reusable workflows. Each recipe
// encodes the model, tools, permission ladder level, required context, the
// evidence we expect the run to capture, and machine-checkable done criteria.
// Shape is kept compatible with future user-defined recipes (custom CRUD is
// post-MVP). `permissionLevel` references an AUTONOMY_LADDER_LEVELS id; the
// launch flow derives the run policy from it. `expectedEvidence` references
// TASK_EVIDENCE_EVENT_TYPES ids. `roleId` (optional) references an employeeType
// / roleTemplate id and scopes the recipe to that role.
export const initialRecipes = [
  {
    id: "fixFailingTest",
    name: "Fix a failing test",
    description: "Reproduce the failing test, find the root cause, apply a scoped fix, and prove the suite is green again.",
    model: "claude-opus-4-6",
    tools: ["Autohand CLI", "Terminal", "GitHub"],
    permissionLevel: "edit-files",
    requiredContext: "The failing test name or path, and the command that reproduces the failure.",
    expectedEvidence: ["context-pack", "prompt", "plan", "command", "file-read", "file-edit", "test", "final"],
    doneCriteria: [
      { id: "reproduced", label: "Failure reproduced before the fix", evidence: ["command", "test"] },
      { id: "rootCause", label: "Root cause located and edited", evidence: ["file-edit"] },
      { id: "testsGreen", label: "Test suite passes after the fix", evidence: ["test"] },
      { id: "summary", label: "Final summary with confirmed evidence", evidence: ["final"] },
    ],
    roleId: null,
    tags: ["test", "fix", "failing", "bug", "regression", "suite", "ci", "red", "broken"],
  },
  {
    id: "reviewPR",
    name: "Review a pull request",
    description: "Read the diff, check it against scope and risk, and report a structured review without pushing changes.",
    model: "claude-opus-4-6",
    tools: ["Autohand CLI", "GitHub"],
    permissionLevel: "run-read-only",
    requiredContext: "The pull request number or branch, and the standard or checklist to review against.",
    expectedEvidence: ["context-pack", "prompt", "plan", "file-read", "evaluation", "final"],
    doneCriteria: [
      { id: "diffRead", label: "Diff read in full", evidence: ["file-read"] },
      { id: "evaluated", label: "Trust checks run on the review", evidence: ["evaluation"] },
      { id: "verdict", label: "Review verdict with cited evidence", evidence: ["final"] },
    ],
    roleId: "solution-architect",
    tags: ["review", "pr", "pull request", "diff", "code review", "approve", "feedback", "merge", "changes"],
  },
  {
    id: "verifyUIRoute",
    name: "Verify a UI route",
    description: "Open the route in the local browser, capture a screenshot at the target viewport, and confirm the expected state.",
    model: "claude-sonnet-4-6",
    tools: ["Autohand CLI", "Browser", "Terminal"],
    permissionLevel: "run-read-only",
    requiredContext: "The route path, the viewport to check, and the expected on-screen result.",
    expectedEvidence: ["context-pack", "prompt", "plan", "command", "screenshot", "final"],
    doneCriteria: [
      { id: "routeOpened", label: "Route opened in the local browser", evidence: ["command"] },
      { id: "screenshot", label: "Screenshot captured at the target viewport", evidence: ["screenshot"] },
      { id: "verified", label: "Expected state confirmed in the summary", evidence: ["final"] },
    ],
    roleId: "common-qa-engineer",
    tags: ["verify", "ui", "route", "browser", "screenshot", "viewport", "render", "page", "visual", "mobile"],
  },
  {
    id: "polishLandingPage",
    name: "Polish a landing page",
    description: "Tighten spacing, typography, and responsive behavior on a page, then verify the result visually.",
    model: "claude-opus-4-6",
    tools: ["Autohand CLI", "Terminal", "Browser", "GitHub"],
    permissionLevel: "edit-files",
    requiredContext: "The page or component to polish and the design intent or reference to match.",
    expectedEvidence: ["context-pack", "prompt", "plan", "file-read", "file-edit", "screenshot", "final"],
    doneCriteria: [
      { id: "edited", label: "Page edits applied", evidence: ["file-edit"] },
      { id: "verified", label: "Result verified in the browser", evidence: ["screenshot"] },
      { id: "summary", label: "Final summary of the polish", evidence: ["final"] },
    ],
    roleId: "frontend-developer",
    tags: ["polish", "landing", "page", "design", "css", "spacing", "typography", "responsive", "ui", "layout"],
  },
  {
    id: "prepareRelease",
    name: "Prepare a release",
    description: "Run the release checks, assemble the changelog and evidence, and open a PR-ready branch — never auto-merging.",
    model: "claude-opus-4-6",
    tools: ["Autohand CLI", "Terminal", "GitHub"],
    permissionLevel: "open-pr",
    requiredContext: "The release scope or milestone, and the checks that must pass before cutting it.",
    expectedEvidence: ["context-pack", "prompt", "plan", "command", "test", "evaluation", "approval", "final"],
    doneCriteria: [
      { id: "checks", label: "Release checks executed", evidence: ["command", "test"] },
      { id: "evaluated", label: "Release evidence trust-checked", evidence: ["evaluation"] },
      { id: "prReady", label: "PR-ready branch prepared (no auto-merge)", evidence: ["final"] },
    ],
    roleId: "devops-engineer",
    tags: ["release", "prepare", "ship", "changelog", "version", "tag", "deploy", "publish", "milestone", "cut"],
  },
];

export const extensionRows = [
  {
    name: "github-events",
    version: "0.4.2",
    status: "ready",
    events: ["pull_request", "issue_comment"],
    restarts: 0,
  },
  {
    name: "autohand-cli-bridge",
    version: "0.2.8",
    status: "ready",
    events: ["run.start", "terminal.open", "run.poll"],
    restarts: 1,
  },
  {
    name: "approval-bridge",
    version: "0.1.9",
    status: "sleeping",
    events: ["tool.approval"],
    restarts: 0,
  },
];

export function initialMessages(agentName) {
  return [
    {
      id: "m1",
      role: "agent",
      body: `${agentName} is online. Pick a workspace and chat normally. This squad member keeps its isolated config for local work.`,
      time: "Ready",
    },
  ];
}
