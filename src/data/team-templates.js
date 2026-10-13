// The built-in team templates, bundled from the bridge's own folder so the
// Templates dialog works offline and against an older bridge. The bridge
// serves the same files at GET /api/teams/templates (server/teams/package.mjs
// `listTemplates`); the app prefers the bridge's copy when it answers, so a
// newer bridge can add a template without a new bundle. Browser only: Vite
// resolves the glob at build time (ADR-0118).

import { validateTeamFile } from "@/lib/teams";

const files = import.meta.glob("../../server/teams/templates/*.squad-team.json", { eager: true, import: "default" });

export const builtInTeamTemplates = Object.entries(files)
  .map(([path, document]) => {
    const result = validateTeamFile(document);
    if (!result.ok) return null;
    const id = path.split("/").pop().replace(/\.squad-team\.json$/, "");
    return { id, name: result.document.team.name, description: result.document.team.description, document: result.document };
  })
  .filter(Boolean)
  .sort((a, b) => a.id.localeCompare(b.id));
