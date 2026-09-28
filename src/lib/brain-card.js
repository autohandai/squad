// The brain card's fields: what a squad member is for, how it works, and when
// it stops and asks.
//
// This lives in src/lib rather than src/data.js because the bridge needs it
// too. Only src/lib ships inside the desktop app (scripts/stage-desktop.mjs),
// so a route plug-in reaching outside it loads fine in development and is
// missing from the installed app, where the loader skips the route and the
// feature is simply absent. src/data.js re-exports this, so every existing
// importer is unchanged.

export const brainCardFields = [
  {
    id: "purpose",
    label: "Purpose",
    prompt: "What this squad member is for and the kind of work it should own.",
  },
  {
    id: "defaultWorkflow",
    label: "Default workflow",
    prompt: "The repeatable operating pattern this squad member should follow.",
  },
  {
    id: "allowedTools",
    label: "Allowed tools",
    prompt: "Tool categories and boundaries the squad member can use under its permission policy.",
  },
  {
    id: "escalationRules",
    label: "Escalation rules",
    prompt: "When to stop, ask, hand off, or request user confirmation.",
  },
  {
    id: "definitionOfDone",
    label: "Definition of done",
    prompt: "The standard this squad member must satisfy before reporting completion.",
  },
  {
    id: "reviewStyle",
    label: "Review style",
    prompt: "How this squad member critiques work, risk, and evidence.",
  },
  {
    id: "memoryPolicy",
    label: "Memory policy",
    prompt: "What can become durable memory and what must stay session scoped.",
  },
];
