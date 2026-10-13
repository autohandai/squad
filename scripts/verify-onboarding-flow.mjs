import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const files = {
  app: readFileSync(join(root, "src", "App.jsx"), "utf8"),
  firstRun: readFileSync(join(root, "src", "components", "onboarding", "FirstRun.jsx"), "utf8"),
  signIn: readFileSync(join(root, "src", "components", "account", "SignInGate.jsx"), "utf8"),
  server: readFileSync(join(root, "server.mjs"), "utf8"),
  design: readFileSync(join(root, "DESIGN.md"), "utf8"),
  readme: readFileSync(join(root, "README.md"), "utf8"),
  setup: readFileSync(join(root, "SETUP_GUIDE.md"), "utf8"),
};

const checks = [
  {
    name: "welcome route constant",
    file: "src/App.jsx",
    pass: /const ONBOARDING_ROUTE = "\/welcome";/.test(files.app),
  },
  {
    name: "local onboarding state key",
    file: "src/App.jsx",
    pass: /onboarding:\s*"autohandSquad\.v1\.onboarding"/.test(files.app),
  },
  {
    name: "root redirects incomplete setup to onboarding",
    file: "src/App.jsx",
    pass: /path === "\/"[\s\S]*onboardingIsIncomplete\(onboardingState\) \? ONBOARDING_ROUTE : SQUAD_DIRECTORY_ROUTE/.test(files.app),
  },
  {
    name: "completed or skipped setup is not incomplete",
    file: "src/App.jsx",
    pass: /function onboardingIsIncomplete\(state\)[\s\S]*ONBOARDING_STATUS_COMPLETED[\s\S]*ONBOARDING_STATUS_SKIPPED/.test(files.app),
  },
  {
    name: "onboarding page render branch",
    file: "src/App.jsx",
    pass: /const isOnboarding = routePath === ONBOARDING_ROUTE;[\s\S]*<FirstRun/.test(files.app),
  },
  {
    name: "welcome page explains folder, teammate and conversation steps",
    file: "FirstRun.jsx",
    pass:
      /Point at a folder/.test(files.firstRun) && /Meet your first teammate/.test(files.firstRun) &&
      /Start talking/.test(files.firstRun) && /signedIn/.test(files.firstRun) &&
      /runtimeReady/.test(files.firstRun) && /providerReady/.test(files.firstRun),
  },
  {
    name: "account setup delegates to existing runtime login",
    file: "src/App.jsx",
    pass: /api\("\/api\/setup\/login", \{ method: "POST" \}\)/.test(files.app) &&
      /onRequestLogin={requestAccountLogin}/.test(files.app) && /startLogin\(\)/.test(files.signIn),
  },
  {
    name: "provider setup routes to Settings provider surface",
    file: "src/App.jsx",
    pass: /onOpenProviders={\(\) => navigate\("\/settings\?section=providers"\)}/.test(files.app) && /providerSettings/.test(files.app),
  },
  {
    name: "workspace selection and first member creation are connected",
    file: "src/App.jsx",
    pass:
      /selectedWorkspace/.test(files.app) &&
      /api\("\/api\/workspaces\/profile"/.test(files.firstRun) &&
      /onStart={startFirstConversation}/.test(files.app) && /firstPromptFor/.test(files.firstRun) &&
      /async function startFirstConversation[\s\S]*await createAgent/.test(files.app),
  },
  {
    name: "skip and finish persist setup state and route to product",
    file: "src/App.jsx",
    pass:
      /function finishOnboarding\(\)[\s\S]*ONBOARDING_STATUS_COMPLETED[\s\S]*memberChatPath/.test(files.app) &&
      /function skipOnboarding\(\)[\s\S]*ONBOARDING_STATUS_SKIPPED[\s\S]*squadDirectoryPath\(\)/.test(files.app),
  },
  {
    name: "setup can be resumed from app shell",
    file: "src/App.jsx",
    pass: /id: "setup"[\s\S]*label: copy.setupGuide/.test(files.app) &&
      /onClick={onOnboarding}/.test(files.app),
  },
  {
    name: "runtime exposes account state without token",
    file: "server.mjs",
    pass:
      /account: readRuntimeAccount\(\)/.test(files.server) &&
      /function readRuntimeAccount\(\)[\s\S]*signedIn:[\s\S]*email:[\s\S]*source:/.test(files.server) &&
      !/apiAuthToken\s*[,}]/.test(files.server.match(/function readRuntimeAccount\(\)[\s\S]*?\n}/)?.[0] || ""),
  },
  {
    name: "setup login endpoint delegates to tray binary",
    file: "server.mjs",
    pass:
      /url\.pathname === "\/api\/setup\/login" && req\.method === "POST"/.test(files.server) &&
      /autohand-squad-tray/.test(files.server) &&
      /"--action", "login"/.test(files.server),
  },
  {
    name: "design contract documents first-run onboarding",
    file: "DESIGN.md",
    pass: /## First-Run Onboarding[\s\S]*\/welcome[\s\S]*three moments[\s\S]*runtime's device flow[\s\S]*Settings/.test(files.design),
  },
  {
    name: "user docs describe first-run route and clean-state test",
    file: "README.md + SETUP_GUIDE.md",
    pass:
      /First-run users are routed to[\s\S]*\/welcome/.test(files.readme) &&
      /`POST \/api\/setup\/login`/.test(files.readme) &&
      /clean first-run onboarding test[\s\S]*autohandSquad\.v1\.onboarding/.test(files.setup),
  },
];

const failures = checks.filter((check) => !check.pass);

for (const check of checks) {
  const status = check.pass ? "ok" : "fail";
  console.log(`${status.padEnd(4)} ${check.file}: ${check.name}`);
}

if (failures.length) {
  console.error(`\nOnboarding verifier failed ${failures.length} check(s).`);
  process.exit(1);
}

console.log("\nOnboarding verifier passed.");
