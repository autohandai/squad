export const AUTOHAND_SKILLS_REGISTRY_URL = "https://skilled.autohand.ai";

const roleTemplateRows = [
  {
    id: "frontend-developer",
    title: "Frontend Developer",
    label: "Frontend",
    accent: "green",
    avatar: "/avatars/frontend-developer.jpg",
    description:
      "Focused on frontend interface design and implementation, with strengths in component architecture, visual language craftsmanship, responsive adaptation, accessibility optimization, and performance tuning.",
    starter:
      "Act as a frontend developer. Deliver polished, accessible interface work in small verified increments, and explain validation evidence clearly.",
    skillSource: AUTOHAND_SKILLS_REGISTRY_URL,
    skills: ["react-component-architecture", "tailwind-ui-patterns", "web-design-guidelines", "testing-strategies"],
  },
  {
    id: "backend-engineer",
    title: "Backend Engineer",
    label: "Backend",
    accent: "green",
    avatar: "/avatars/backend-engineer.jpg",
    description:
      "Backend engineering focused on API development, data modeling, migrations, service reliability, and integration boundaries.",
    starter:
      "Act as a backend engineer. Inspect service contracts first, keep changes scoped, and verify behavior at the API or persistence boundary.",
    skillSource: AUTOHAND_SKILLS_REGISTRY_URL,
    skills: ["api-design-restful", "database-schema-design", "error-handling-patterns", "testing-strategies"],
  },
  {
    id: "full-stack-developer",
    title: "Full Stack Developer",
    label: "Full stack",
    accent: "blue",
    avatar: "/avatars/full-stack-developer.jpg",
    description:
      "End-to-end software delivery across interface, API, data, and integration work, focused on shipping coherent product slices.",
    starter:
      "Act as a full stack developer. Trace the user flow across frontend and backend boundaries, keep implementation increments small, and verify the full path before reporting done.",
    skillSource: AUTOHAND_SKILLS_REGISTRY_URL,
    skills: ["react-component-architecture", "api-design-restful", "database-schema-design", "testing-strategies"],
  },
  {
    id: "mobile-developer",
    title: "Mobile Developer",
    label: "Mobile",
    accent: "blue",
    avatar: "/avatars/mobile-developer.jpg",
    description:
      "Mobile application engineering for native and cross-platform products, focused on device behavior, offline states, performance, and release readiness.",
    starter:
      "Act as a mobile developer. Check platform conventions, device constraints, and release implications before changing mobile app behavior.",
    skillSource: AUTOHAND_SKILLS_REGISTRY_URL,
    skills: ["swiftui-expert-skill", "vercel-react-native-skills", "frontend-responsive-design-standards", "testing-strategies"],
  },
  {
    id: "ux-ui-designer",
    title: "UX/UI Designer",
    label: "Design",
    accent: "pink",
    avatar: "/avatars/ux-ui-designer.jpg",
    description:
      "Product design role for user journeys, interaction quality, information architecture, accessibility, and high-fidelity interface direction.",
    starter:
      "Act as a UX/UI designer. Start from the user's workflow, tighten hierarchy and interaction details, and explain design decisions in practical implementation terms.",
    skillSource: AUTOHAND_SKILLS_REGISTRY_URL,
    skills: ["frontend-design", "web-design-guidelines", "ui-ux-pro-max", "tailwind-ui-patterns"],
  },
  {
    id: "solution-architect",
    title: "Solution Architect",
    label: "Architecture",
    accent: "blue",
    avatar: "/avatars/solution-architect.jpg",
    description:
      "Architecture role for system boundaries, integration maps, technical decisions, migration paths, and long-term maintainability.",
    starter:
      "Act as a solution architect. Identify system constraints, clarify tradeoffs, document decisions, and keep recommendations grounded in current implementation reality.",
    skillSource: AUTOHAND_SKILLS_REGISTRY_URL,
    skills: ["api-design-restful", "database-schema-design", "git-workflow-mastery", "documentation-writing"],
  },
  {
    id: "devops-engineer",
    title: "DevOps Engineer",
    label: "DevOps",
    accent: "amber",
    avatar: "/avatars/devops-engineer.jpg",
    description:
      "Delivery infrastructure role for CI/CD, deployment automation, environment configuration, observability, and release operations.",
    starter:
      "Act as a DevOps engineer. Inspect the pipeline and runtime environment first, automate repeatable steps, and report deployment evidence clearly.",
    skillSource: AUTOHAND_SKILLS_REGISTRY_URL,
    skills: ["deployment-automation", "monitoring-observability", "environment-setup", "git-workflow-mastery"],
  },
  {
    id: "platform-engineer",
    title: "Platform Engineer",
    label: "Platform",
    accent: "green",
    avatar: "/avatars/platform-engineer.jpg",
    description:
      "Internal platform role for developer experience, shared tooling, reusable service templates, runtime standards, and operational consistency.",
    starter:
      "Act as a platform engineer. Improve the paved road for product teams, favor reusable tooling over one-off fixes, and keep platform contracts explicit.",
    skillSource: AUTOHAND_SKILLS_REGISTRY_URL,
    skills: ["cli-tool-development", "workflow-automation", "environment-setup", "documentation-writing"],
  },
  {
    id: "security-engineer",
    title: "Security Engineer",
    label: "Security",
    accent: "amber",
    avatar: "/avatars/security-engineer.jpg",
    description:
      "Application security role for threat modeling, secure code review, secrets hygiene, dependency risk, and compliance-minded delivery.",
    starter:
      "Act as a security engineer. Follow data and trust boundaries, validate exploitability before severity claims, and propose practical mitigations.",
    skillSource: AUTOHAND_SKILLS_REGISTRY_URL,
    skills: [
      "security-best-practices",
      "performing-threat-modeling-with-owasp-threat-dragon",
      "implementing-secrets-scanning-in-ci-cd",
      "conducting-api-security-testing",
    ],
  },
  {
    id: "ai-engineer",
    title: "AI Engineer",
    label: "AI",
    accent: "blue",
    avatar: "/avatars/ai-engineer.jpg",
    description:
      "AI product engineering role for model integration, prompt systems, evaluation harnesses, tool orchestration, and agentic workflows.",
    starter:
      "Act as an AI engineer. Define the model contract, build evaluation hooks early, and keep generated behavior observable, testable, and bounded.",
    skillSource: AUTOHAND_SKILLS_REGISTRY_URL,
    skills: ["agent-evaluation", "agentic-workflow", "agentic-development-principles", "microsoft-foundry"],
  },
  {
    id: "scrum-master",
    title: "Scrum Master",
    label: "Delivery",
    accent: "green",
    avatar: "/avatars/scrum-master.jpg",
    description:
      "Delivery facilitation role for sprint health, ceremonies, dependency tracking, blocker removal, and continuous improvement.",
    starter:
      "Act as a Scrum Master. Surface delivery risks, clarify ownership and next actions, and help the squad keep a sustainable execution rhythm.",
    skillSource: AUTOHAND_SKILLS_REGISTRY_URL,
    skills: ["task-planning", "task-estimation", "writing-plans", "brainstorming"],
  },
  {
    id: "technical-writer",
    title: "Technical Writer",
    label: "Docs",
    accent: "amber",
    avatar: "/avatars/technical-writer.jpg",
    description:
      "Documentation role for developer guides, API references, runbooks, release notes, onboarding content, and knowledge base quality.",
    starter:
      "Act as a technical writer. Verify product behavior before documenting it, structure docs around real tasks, and keep examples accurate.",
    skillSource: AUTOHAND_SKILLS_REGISTRY_URL,
    skills: ["documentation-writing", "technical-writing", "api-documentation", "changelog-maintenance"],
  },
  {
    id: "common-qa-engineer",
    title: "QA Engineer",
    label: "QA",
    accent: "green",
    avatar: "/avatars/common-qa-engineer.jpg",
    description:
      "A quality assurance role for general command-line tools and Web products, focused on test plan documentation, end-to-end testing, defect reproduction, and evidence-based reporting.",
    starter:
      "Act as a QA engineer. Do not fix issues or run unit tests unless explicitly asked. Reproduce defects, capture evidence, and report clear validation steps.",
    skillSource: AUTOHAND_SKILLS_REGISTRY_URL,
    skills: ["testing-strategies", "webapp-testing", "agent-browser", "frontend-responsive-design-standards"],
  },
  {
    id: "product-manager",
    title: "Product Manager",
    label: "PM",
    accent: "green",
    avatar: "/avatars/product-manager.jpg",
    description:
      "AI-native product management for software products, focused on user problems, requirements quality, prioritization, and launch clarity.",
    starter:
      "Act as a product manager. Clarify user value, constraints, tradeoffs, acceptance criteria, and launch risk before proposing implementation.",
    skillSource: AUTOHAND_SKILLS_REGISTRY_URL,
    skills: ["brainstorming", "writing-plans", "product-marketing-context", "changelog-maintenance"],
  },
  {
    id: "data-analyst",
    title: "Data Analyst",
    label: "Data",
    accent: "blue",
    avatar: "/avatars/data-analyst.jpg",
    description:
      "AI-native data analyst for problem framing, metric alignment, diagnostics, reporting, and insight synthesis.",
    starter:
      "Act as a data analyst. Define the metric question first, inspect available data, call out uncertainty, and summarize actionable findings.",
    skillSource: AUTOHAND_SKILLS_REGISTRY_URL,
    skills: ["data-analysis", "database-schema-design", "looker-studio-bigquery", "analytics-tracking"],
  },
  {
    id: "content-operations-specialist",
    title: "Content Operations Specialist",
    label: "Content",
    accent: "amber",
    avatar: "/avatars/content-operations-specialist.jpg",
    description:
      "AI-native content operations role for account positioning, trend analysis, editorial systems, and workflow consistency.",
    starter:
      "Act as a content operations specialist. Keep messaging consistent, cite source context, and organize content work into clear repeatable steps.",
    skillSource: AUTOHAND_SKILLS_REGISTRY_URL,
    skills: ["content-strategy", "product-marketing-context", "seo-audit", "social-content"],
  },
];

const handoffDemoAgents = [
  {
    id: "asq_noah_frontend",
    staffId: "member-002",
    employeeId: "emp_frontend_noah",
    name: "Noah",
    role: "Frontend Developer",
    status: "online",
    createdAt: "2026-05-25T08:30:00.000Z",
    updatedAt: "2026-05-25T08:45:00.000Z",
    lastConversationAt: "2026-05-25T09:18:00.000Z",
    avatar: "/avatars/frontend-developer.jpg",
    employeeType: "frontend-developer",
    workspace: "/Users/igorcosta/Documents/autohand/web/prototypes/dark-web-cli",
    description:
      "Focused on frontend implementation, interaction polish, accessibility, responsive behavior, and visual hierarchy for local Web products.",
    instructions:
      "Runs as a real Autohand CLI instance isolated to Noah's squad member profile. Continue parent tasks handed from QA, preserve evidence, and make scoped frontend changes with validation notes.",
    projects: [
      {
        id: "project_dark_web_cli",
        name: "dark-web-cli",
        label: "Documents/autohand/web/prototypes/dark-web-cli",
        path: "/Users/igorcosta/Documents/autohand/web/prototypes/dark-web-cli",
        kind: "git repo",
        addedAt: "2026-05-25T08:30:00.000Z",
      },
    ],
    skillSource: AUTOHAND_SKILLS_REGISTRY_URL,
    launch: {
      mode: "prompt",
      policy: "restricted",
      model: "",
      dryRun: false,
    },
    stats: {
      activeDays: 1,
      automations: 0,
      tasks: 1,
      projects: 1,
    },
    memory: [
      "Autohand Skill Installed: react-component-architecture",
      "Autohand Skill Installed: tailwind-ui-patterns",
      "Autohand Skill Installed: web-design-guidelines",
      "Autohand Skill Installed: testing-strategies",
    ],
    skills: ["react-component-architecture", "tailwind-ui-patterns", "web-design-guidelines", "testing-strategies"],
    tools: [
      { name: "Autohand CLI", policy: "restricted", status: "isolated" },
      { name: "Terminal", policy: "manual", status: "wired" },
      { name: "Browser", policy: "allow", status: "ready" },
      { name: "GitHub", policy: "ask", status: "ready" },
    ],
  },
  {
    id: "asq_iris_reviewer",
    staffId: "member-003",
    employeeId: "emp_reviewer_iris",
    name: "Iris",
    role: "Code Reviewer",
    status: "online",
    createdAt: "2026-05-25T08:35:00.000Z",
    updatedAt: "2026-05-25T09:25:00.000Z",
    lastConversationAt: "2026-05-25T09:25:00.000Z",
    avatar: "/avatars/solution-architect.jpg",
    employeeType: "solution-architect",
    workspace: "/Users/igorcosta/Documents/autohand/web/prototypes/dark-web-cli",
    description:
      "Review-focused squad member for diff review, regression risk, architecture fit, and evidence-based approval decisions.",
    instructions:
      "Runs as a real Autohand CLI instance isolated to Iris's squad member profile. Review handed-off frontend and backend changes, preserve task context, and return blocking findings first.",
    projects: [
      {
        id: "project_dark_web_cli",
        name: "dark-web-cli",
        label: "Documents/autohand/web/prototypes/dark-web-cli",
        path: "/Users/igorcosta/Documents/autohand/web/prototypes/dark-web-cli",
        kind: "git repo",
        addedAt: "2026-05-25T08:35:00.000Z",
      },
    ],
    skillSource: AUTOHAND_SKILLS_REGISTRY_URL,
    launch: {
      mode: "prompt",
      policy: "restricted",
      model: "",
      dryRun: false,
    },
    stats: {
      activeDays: 1,
      automations: 0,
      tasks: 1,
      projects: 1,
    },
    memory: [
      "Autohand Skill Installed: api-design-restful",
      "Autohand Skill Installed: git-workflow-mastery",
      "Autohand Skill Installed: documentation-writing",
      "Autohand Skill Installed: testing-strategies",
    ],
    skills: ["api-design-restful", "git-workflow-mastery", "documentation-writing", "testing-strategies"],
    tools: [
      { name: "Autohand CLI", policy: "restricted", status: "isolated" },
      { name: "Terminal", policy: "manual", status: "wired" },
      { name: "Browser", policy: "allow", status: "ready" },
      { name: "GitHub", policy: "ask", status: "ready" },
    ],
  },
  {
    id: "asq_kai_devops",
    staffId: "member-004",
    employeeId: "emp_devops_kai",
    name: "Kai",
    role: "DevOps Engineer",
    status: "online",
    createdAt: "2026-05-25T08:40:00.000Z",
    updatedAt: "2026-05-25T08:40:00.000Z",
    lastConversationAt: "2026-05-25T08:40:00.000Z",
    avatar: "/avatars/devops-engineer.jpg",
    employeeType: "devops-engineer",
    workspace: "/Users/igorcosta/Documents/autohand/web/prototypes/dark-web-cli",
    description:
      "Delivery infrastructure role for build validation, CI readiness, deployment checks, and release evidence.",
    instructions:
      "Runs as a real Autohand CLI instance isolated to Kai's squad member profile. Validate builds and deployment readiness when a parent task reaches release verification.",
    projects: [
      {
        id: "project_dark_web_cli",
        name: "dark-web-cli",
        label: "Documents/autohand/web/prototypes/dark-web-cli",
        path: "/Users/igorcosta/Documents/autohand/web/prototypes/dark-web-cli",
        kind: "git repo",
        addedAt: "2026-05-25T08:40:00.000Z",
      },
    ],
    skillSource: AUTOHAND_SKILLS_REGISTRY_URL,
    launch: {
      mode: "prompt",
      policy: "restricted",
      model: "",
      dryRun: false,
    },
    stats: {
      activeDays: 1,
      automations: 0,
      tasks: 0,
      projects: 1,
    },
    memory: [
      "Autohand Skill Installed: deployment-automation",
      "Autohand Skill Installed: monitoring-observability",
      "Autohand Skill Installed: environment-setup",
      "Autohand Skill Installed: git-workflow-mastery",
    ],
    skills: ["deployment-automation", "monitoring-observability", "environment-setup", "git-workflow-mastery"],
    tools: [
      { name: "Autohand CLI", policy: "restricted", status: "isolated" },
      { name: "Terminal", policy: "manual", status: "wired" },
      { name: "Browser", policy: "allow", status: "ready" },
      { name: "GitHub", policy: "ask", status: "ready" },
    ],
  },
];

export const roleTemplates = roleTemplateRows;

const generatedAvatarOptions = [
  { id: "nz-riso-set-1-01", label: "Riso 01", src: "/avatars/nz-riso-set-1-01.webp" },
  { id: "nz-riso-set-1-02", label: "Riso 02", src: "/avatars/nz-riso-set-1-02.webp" },
  { id: "nz-riso-set-1-03", label: "Riso 03", src: "/avatars/nz-riso-set-1-03.webp" },
  { id: "nz-riso-set-1-04", label: "Riso 04", src: "/avatars/nz-riso-set-1-04.webp" },
  { id: "nz-riso-set-1-05", label: "Riso 05", src: "/avatars/nz-riso-set-1-05.webp" },
  { id: "nz-riso-set-1-06", label: "Riso 06", src: "/avatars/nz-riso-set-1-06.webp" },
  { id: "nz-riso-set-1-07", label: "Riso 07", src: "/avatars/nz-riso-set-1-07.webp" },
  { id: "nz-riso-set-1-08", label: "Riso 08", src: "/avatars/nz-riso-set-1-08.webp" },
  { id: "nz-riso-set-1-09", label: "Riso 09", src: "/avatars/nz-riso-set-1-09.webp" },
  { id: "nz-riso-set-1-10", label: "Riso 10", src: "/avatars/nz-riso-set-1-10.webp" },
  { id: "nz-riso-set-1-11", label: "Riso 11", src: "/avatars/nz-riso-set-1-11.webp" },
  { id: "nz-riso-set-2-01", label: "Riso 12", src: "/avatars/nz-riso-set-2-01.webp" },
  { id: "nz-riso-set-2-02", label: "Riso 13", src: "/avatars/nz-riso-set-2-02.webp" },
  { id: "nz-riso-set-2-03", label: "Riso 14", src: "/avatars/nz-riso-set-2-03.webp" },
  { id: "nz-riso-set-2-04", label: "Riso 15", src: "/avatars/nz-riso-set-2-04.webp" },
  { id: "nz-riso-set-2-05", label: "Riso 16", src: "/avatars/nz-riso-set-2-05.webp" },
  { id: "nz-riso-set-2-06", label: "Riso 17", src: "/avatars/nz-riso-set-2-06.webp" },
  { id: "nz-riso-set-2-07", label: "Riso 18", src: "/avatars/nz-riso-set-2-07.webp" },
  { id: "nz-riso-set-2-08", label: "Riso 19", src: "/avatars/nz-riso-set-2-08.webp" },
  { id: "nz-riso-set-2-09", label: "Riso 20", src: "/avatars/nz-riso-set-2-09.webp" },
  { id: "nz-riso-set-2-10", label: "Riso 21", src: "/avatars/nz-riso-set-2-10.webp" },
  { id: "nz-riso-set-2-11", label: "Riso 22", src: "/avatars/nz-riso-set-2-11.webp" },
  { id: "nz-riso-set-2-12", label: "Riso 23", src: "/avatars/nz-riso-set-2-12.webp" },
  { id: "nz-riso-set-2-13", label: "Riso 24", src: "/avatars/nz-riso-set-2-13.webp" },
  { id: "nz-riso-set-2-14", label: "Riso 25", src: "/avatars/nz-riso-set-2-14.webp" },
  { id: "nz-riso-set-2-15", label: "Riso 26", src: "/avatars/nz-riso-set-2-15.webp" },
  { id: "nz-riso-set-2-16", label: "Riso 27", src: "/avatars/nz-riso-set-2-16.webp" },
];

export const builtInAvatarOptions = [
  ...roleTemplates.map((role) => ({
    id: role.id,
    label: role.title,
    src: role.avatar,
  })),
  ...generatedAvatarOptions,
];

export const initialAgents = [
  {
    id: "b3bc502e795a",
    staffId: "bczh5540",
    employeeId: "emp_01ks6na8x5744jk73307bxw3cf",
    name: "Eva",
    role: "QA Engineer",
    status: "online",
    createdAt: "2026-05-22T01:38:05.622Z",
    updatedAt: "2026-05-22T01:38:05.879Z",
    lastConversationAt: "2026-05-25T02:00:00.343Z",
    avatar: "/avatars/common-qa-engineer.jpg",
    employeeType: "common-qa-engineer",
    workspace: "/Users/igorcosta/Documents/autohand/web/prototypes/dark-web-cli",
    description:
      "A quality assurance role for general command-line tools and Web products, focused on test plan documentation, end-to-end testing, defect reproduction, and evidence-based reporting; does not run unit tests and does not fix issues.",
    instructions:
      "Runs as a real Autohand CLI instance isolated to Eva's squad member profile. It uses the selected conversation folder as the working tree, avoids code changes by default, and records evidence-rich QA findings.",
    projects: [
      {
        id: "project_dark_web_cli",
        name: "dark-web-cli",
        label: "Documents/autohand/web/prototypes/dark-web-cli",
        path: "/Users/igorcosta/Documents/autohand/web/prototypes/dark-web-cli",
        kind: "git repo",
        addedAt: "2026-05-25T01:54:00.000Z",
      },
    ],
    skillSource: AUTOHAND_SKILLS_REGISTRY_URL,
    launch: {
      mode: "prompt",
      policy: "restricted",
      model: "",
      dryRun: false,
    },
    stats: {
      activeDays: 3,
      automations: 1,
      tasks: 3,
      projects: 1,
    },
    memory: [
      "Autohand Skill Installed: testing-strategies",
      "Autohand Skill Installed: webapp-testing",
      "Autohand Skill Installed: agent-browser",
      "Autohand Skill Installed: frontend-responsive-design-standards",
    ],
    skills: [
      "testing-strategies",
      "webapp-testing",
      "agent-browser",
      "frontend-responsive-design-standards",
    ],
    tools: [
      { name: "Autohand CLI", policy: "restricted", status: "isolated" },
      { name: "Terminal", policy: "manual", status: "wired" },
      { name: "Browser", policy: "allow", status: "ready" },
      { name: "GitHub", policy: "ask", status: "ready" },
    ],
  },
  ...handoffDemoAgents,
];

export const initialTasks = [
  {
    id: "task_goal10_qa_frontend_reviewer",
    title: "QA to Frontend to Reviewer handoff chain",
    agentId: "asq_iris_reviewer",
    currentOwnerId: "asq_iris_reviewer",
    originAgentId: "b3bc502e795a",
    project: "dark-web-cli",
    status: "handoff-pending",
    source: "local-chat",
    createdAt: "2026-05-25T09:00:00.000Z",
    updatedAt: "2026-05-25T09:25:00.000Z",
    summary: "Iris is reviewing Noah's frontend fix after Eva reproduced the responsive navigation defect with evidence.",
    runtimeId: "run_goal10_noah_frontend_fix",
    assignments: [
      {
        id: "assign_goal10_eva_qa",
        agentId: "b3bc502e795a",
        sourceAgentId: "b3bc502e795a",
        status: "completed",
        reason: "Reproduce the reported navigation defect.",
        requiredContext: "Test the latest dark-web-cli code on the current branch.",
        expectedOutput: "Defect report with reproduction steps and evidence.",
        sourceEvidence: "Screenshot: mobile navigation overlap at 390px; route: /docs/agent-sdk.",
        createdAt: "2026-05-25T09:00:00.000Z",
        updatedAt: "2026-05-25T09:08:00.000Z",
        attempt: 1,
      },
      {
        id: "assign_goal10_noah_frontend",
        agentId: "asq_noah_frontend",
        sourceAgentId: "b3bc502e795a",
        status: "completed",
        reason: "Fix the reproduced responsive navigation defect.",
        requiredContext: "Eva found nav links overlapping page content on mobile.",
        expectedOutput: "Scoped frontend fix with browser evidence.",
        sourceEvidence: "Eva QA evidence packet, screenshot, and affected route.",
        createdAt: "2026-05-25T09:08:00.000Z",
        updatedAt: "2026-05-25T09:18:00.000Z",
        attempt: 1,
        handoffId: "handoff_goal10_eva_to_noah",
        runId: "run_goal10_noah_frontend_fix",
      },
      {
        id: "assign_goal10_iris_review",
        agentId: "asq_iris_reviewer",
        sourceAgentId: "asq_noah_frontend",
        status: "pending",
        reason: "Review the frontend diff before release validation.",
        requiredContext: "Noah says the nav overlap is fixed and needs review.",
        expectedOutput: "Blocking findings first, then approval or reroute.",
        sourceEvidence: "Run run_goal10_noah_frontend_fix and Eva evidence packet.",
        createdAt: "2026-05-25T09:18:00.000Z",
        updatedAt: "2026-05-25T09:25:00.000Z",
        attempt: 1,
        handoffId: "handoff_goal10_noah_to_iris",
      },
    ],
    handoffs: [
      {
        id: "handoff_goal10_eva_to_noah",
        fromAgentId: "b3bc502e795a",
        toAgentId: "asq_noah_frontend",
        status: "completed",
        reason: "Eva reproduced a frontend navigation defect that needs a UI fix.",
        requiredContext: "Mobile nav overlaps content on /docs/agent-sdk at 390px.",
        expectedOutput: "Fix the responsive nav issue and report browser validation.",
        sourceEvidence: "Eva QA screenshot, route, viewport, and reproduction notes.",
        createdAt: "2026-05-25T09:08:00.000Z",
        updatedAt: "2026-05-25T09:18:00.000Z",
        checkpointId: "checkpoint_goal10_eva_to_noah",
        attempt: 1,
      },
      {
        id: "handoff_goal10_noah_to_iris",
        fromAgentId: "asq_noah_frontend",
        toAgentId: "asq_iris_reviewer",
        status: "pending",
        reason: "Noah completed the UI fix and needs a review pass before DevOps validation.",
        requiredContext: "Review the frontend diff and Eva's reproduction evidence.",
        expectedOutput: "Return blocking findings first, or approve for DevOps validation.",
        sourceEvidence: "Run run_goal10_noah_frontend_fix; files touched: src/components/NavigationBar.vue, src/styles/mobile.css.",
        createdAt: "2026-05-25T09:18:00.000Z",
        updatedAt: "2026-05-25T09:25:00.000Z",
        checkpointId: "checkpoint_goal10_noah_to_iris",
        attempt: 1,
      },
    ],
    timeline: [
      {
        id: "timeline_goal10_task_created",
        type: "task.created",
        at: "2026-05-25T09:00:00.000Z",
        actorAgentId: "b3bc502e795a",
        targetAgentId: "b3bc502e795a",
        summary: "Eva opened the parent task after reproducing the defect.",
      },
      {
        id: "timeline_goal10_eva_to_noah",
        type: "handoff.created",
        at: "2026-05-25T09:08:00.000Z",
        actorAgentId: "b3bc502e795a",
        targetAgentId: "asq_noah_frontend",
        handoffId: "handoff_goal10_eva_to_noah",
        summary: "Eva handed the task to Noah for a frontend fix.",
        content: "Required context: mobile navigation overlap at 390px. Expected output: scoped UI fix with browser evidence.",
      },
      {
        id: "timeline_goal10_noah_run",
        type: "run.started",
        at: "2026-05-25T09:12:00.000Z",
        actorAgentId: "asq_noah_frontend",
        targetAgentId: "asq_noah_frontend",
        runId: "run_goal10_noah_frontend_fix",
        summary: "Noah started a child run to fix the responsive navigation defect.",
      },
      {
        id: "timeline_goal10_noah_to_iris",
        type: "handoff.created",
        at: "2026-05-25T09:18:00.000Z",
        actorAgentId: "asq_noah_frontend",
        targetAgentId: "asq_iris_reviewer",
        handoffId: "handoff_goal10_noah_to_iris",
        summary: "Noah handed the same parent task to Iris for review.",
        content: "Required context: inspect the frontend diff and Eva evidence. Expected output: blocking findings or approval.",
      },
    ],
  },
  {
    id: "task_goal10_blocked_deploy_handoff",
    title: "Blocked DevOps validation handoff",
    agentId: "asq_kai_devops",
    currentOwnerId: "asq_kai_devops",
    originAgentId: "asq_iris_reviewer",
    project: "dark-web-cli",
    status: "blocked",
    source: "conversation",
    createdAt: "2026-05-25T09:26:00.000Z",
    updatedAt: "2026-05-25T09:31:00.000Z",
    summary: "Kai could not validate the preview deploy because the build environment is missing the deployment token.",
    runtimeId: null,
    assignments: [
      {
        id: "assign_goal10_kai_devops_blocked",
        agentId: "asq_kai_devops",
        sourceAgentId: "asq_iris_reviewer",
        status: "failed",
        reason: "Validate preview deploy after review.",
        requiredContext: "Iris approved the frontend diff and asked for deployment validation.",
        expectedOutput: "Build and preview deploy evidence.",
        sourceEvidence: "Review approval plus Noah's frontend run.",
        createdAt: "2026-05-25T09:26:00.000Z",
        updatedAt: "2026-05-25T09:31:00.000Z",
        attempt: 1,
        handoffId: "handoff_goal10_iris_to_kai",
        failureReason: "Missing preview deployment token in the local environment.",
      },
    ],
    handoffs: [
      {
        id: "handoff_goal10_iris_to_kai",
        fromAgentId: "asq_iris_reviewer",
        toAgentId: "asq_kai_devops",
        status: "failed",
        reason: "Validate the reviewed frontend fix in the deployment path.",
        requiredContext: "Use the same parent task evidence from Eva, Noah, and Iris.",
        expectedOutput: "Preview deployment status and build evidence.",
        sourceEvidence: "Review approval, run run_goal10_noah_frontend_fix, and QA screenshot evidence.",
        createdAt: "2026-05-25T09:26:00.000Z",
        updatedAt: "2026-05-25T09:31:00.000Z",
        checkpointId: "checkpoint_goal10_iris_to_kai",
        attempt: 1,
        failureReason: "Missing preview deployment token in the local environment.",
      },
    ],
    timeline: [
      {
        id: "timeline_goal10_iris_to_kai",
        type: "handoff.created",
        at: "2026-05-25T09:26:00.000Z",
        actorAgentId: "asq_iris_reviewer",
        targetAgentId: "asq_kai_devops",
        handoffId: "handoff_goal10_iris_to_kai",
        summary: "Iris handed deployment validation to Kai.",
      },
      {
        id: "timeline_goal10_kai_failed",
        type: "handoff.failed",
        at: "2026-05-25T09:31:00.000Z",
        actorAgentId: "asq_kai_devops",
        targetAgentId: "asq_kai_devops",
        handoffId: "handoff_goal10_iris_to_kai",
        summary: "Handoff checkpoint failed: missing preview deployment token.",
      },
    ],
  },
  {
    id: "qs_01ksezvnvxah",
    title: "Please test the latest code from {repository} on {current branch}",
    agentId: "b3bc502e795a",
    project: "dark-web-cli",
    status: "completed",
    source: "local-chat",
    createdAt: "2026-05-25T01:54:00.000Z",
    updatedAt: "2026-05-25T01:54:00.000Z",
    summary: "Latest code review completed from the active local chat request.",
    runtimeId: null,
  },
  {
    id: "qs_01kseva3q96",
    title: "Capture Autohand Squad Eva workspace screenshot",
    agentId: "b3bc502e795a",
    project: "dark-web-cli",
    status: "completed",
    source: "local-chat",
    createdAt: "2026-05-25T01:44:00.000Z",
    updatedAt: "2026-05-25T01:44:00.000Z",
    summary: "Workspace screenshot captured for Eva's current chat surface.",
    runtimeId: null,
  },
  {
    id: "qs_01ks6muwz1",
    title: "Test latest code and record defects",
    agentId: "b3bc502e795a",
    project: "dark-web-cli",
    status: "completed",
    source: "local-chat",
    createdAt: "2026-05-22T04:20:00.000Z",
    updatedAt: "2026-05-22T04:20:00.000Z",
    summary: "Smoke test pass completed with evidence-oriented QA notes.",
    runtimeId: null,
  },
];

export const initialAutomations = [
  {
    id: "tr_c580fc22fb834a90",
    name: "Smoke test",
    schedule: "Every day",
    target: "local",
    status: "active",
    runCount: 1,
    createdAt: "2026-05-25T01:54:00.000Z",
    lastRun: "2026-05-25T02:00:00.000Z",
    prompt: "Keep the test running every day.",
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

export function buildActivity() {
  return Array.from({ length: 143 }, (_, index) => {
    const mod = index % 17;
    if (mod === 0 || mod === 7) return 3;
    if (mod === 4 || mod === 11) return 2;
    if (mod === 2 || mod === 15) return 1;
    return 0;
  });
}

export function initialMessages(agentName) {
  return [
    {
      id: "m1",
      role: "agent",
      body: `${agentName} is online. Pick a workspace, chat normally, or use the play button when you want an explicit Autohand run. Both paths use this squad member's isolated config.`,
      time: "Ready",
    },
  ];
}
