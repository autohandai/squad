// ACP registry route plug-in (docs/integration/acp.md, ADR-0122).
//
//   GET /api/acp/registry[?refresh=1]
//     { agents: [{ id, harnessId, name, description, version, installed,
//       fetchOnUse, available, launch, detail, setup, source, ... }],
//       fetchedAt, source: network|cache|bundled, stale, error, version, url }
//
// The chooser calls this when it opens; the registry is fetched at most once
// a day unless `refresh=1`, and the bundled snapshot answers offline.

import { configureAcpRegistry, listAcpAgents } from "../acp/registry.mjs";

export const name = "acp";

let autohandPath = () => "";

export async function init(ctx) {
  configureAcpRegistry({ stateDir: ctx.squadStateDir });
  autohandPath = () => {
    try {
      return String(ctx.getRuntime?.()?.autohandPath || "");
    } catch {
      return "";
    }
  };
}

export async function handle(req, res, url, ctx) {
  if (url.pathname !== "/api/acp/registry") return false;
  if (req.method !== "GET") {
    ctx.json(res, 405, { success: false, error: "GET only" });
    return true;
  }
  try {
    const refresh = url.searchParams.get("refresh") === "1";
    const data = await listAcpAgents({ refresh, network: true, context: { autohandPath: autohandPath() } });
    ctx.json(res, 200, { success: true, data });
  } catch (error) {
    ctx.json(res, 500, { success: false, error: error?.message || String(error) });
  }
  return true;
}
