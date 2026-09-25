// Route plug-ins. Every `*.route.mjs` file in this directory exports
//
//   export const name = "members";                 // for logs
//   export async function handle(req, res, url, ctx) // true when handled
//   export async function init(ctx)                 // optional, once at boot
//
// server.mjs calls `handle` for every /api/* request before its own routes,
// so a feature can add endpoints without touching the monolith. `ctx` is the
// bridge context described in docs/integration/CONTRACT.md.

import { readdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const routesDir = dirname(fileURLToPath(import.meta.url));
let plugins = null;

export async function loadRoutePlugins(ctx, { log = console.log } = {}) {
  if (plugins) return plugins;
  const entries = (await readdir(routesDir)).filter((name) => name.endsWith(".route.mjs")).sort();
  const loaded = [];
  for (const entry of entries) {
    try {
      const module = await import(pathToFileURL(join(routesDir, entry)).href);
      if (typeof module.handle !== "function") {
        log(`route plug-in ${entry} has no handle() export; skipped`);
        continue;
      }
      if (typeof module.init === "function") await module.init(ctx);
      loaded.push({ file: entry, name: module.name || entry.replace(/\.route\.mjs$/, ""), handle: module.handle });
    } catch (error) {
      log(`route plug-in ${entry} failed to load: ${error?.stack || error}`);
    }
  }
  plugins = loaded;
  if (loaded.length) log(`route plug-ins: ${loaded.map((plugin) => plugin.name).join(", ")}`);
  return plugins;
}

export async function handlePluginRoute(req, res, url, ctx) {
  const list = plugins || (await loadRoutePlugins(ctx));
  for (const plugin of list) {
    if (await plugin.handle(req, res, url, ctx)) return true;
  }
  return false;
}
