import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { telemetryHost } from "../server/product-telemetry.mjs";

/** Public ingestion configuration only; never copy a full .env into the app. */
export async function stageProductTelemetry({ rootDir, runtimeDir, env = process.env, envFile = join(rootDir, ".env") }) {
  let local = {};
  try {
    const text = await readFile(envFile, "utf8");
    for (const key of ["AUTOHAND_SQUAD_POSTHOG_KEY", "AUTOHAND_SQUAD_POSTHOG_HOST", "NEXT_PUBLIC_POSTHOG_KEY", "NEXT_PUBLIC_POSTHOG_HOST"]) {
      const line = text.split(/\r?\n/).find(value => value.startsWith(`${key}=`));
      if (line) local[key] = line.slice(key.length + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    }
  } catch { /* Disabled unless the actual ingestion settings are configured. */ }
  const key = env.AUTOHAND_SQUAD_POSTHOG_KEY || env.NEXT_PUBLIC_POSTHOG_KEY || local.AUTOHAND_SQUAD_POSTHOG_KEY || local.NEXT_PUBLIC_POSTHOG_KEY || "";
  const host = telemetryHost(env.AUTOHAND_SQUAD_POSTHOG_HOST || env.NEXT_PUBLIC_POSTHOG_HOST || local.AUTOHAND_SQUAD_POSTHOG_HOST || local.NEXT_PUBLIC_POSTHOG_HOST);
  const enabled = Boolean(key && host);
  await writeFile(join(runtimeDir, "PRODUCT_TELEMETRY.json"), `${JSON.stringify(enabled ? { key, host } : {}, null, 2)}\n`);
  return { enabled };
}

// CLI for the release workflow's web bundle: stage into the given runtime folder.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const runtimeDir = process.argv[2];
  if (!runtimeDir) { console.error("usage: stage-product-telemetry.mjs <runtime-dir>"); process.exit(2); }
  const { enabled } = await stageProductTelemetry({ rootDir: resolve(fileURLToPath(new URL("..", import.meta.url))), runtimeDir });
  console.log(`Product telemetry ${enabled ? "enabled" : "off (no public PostHog key and host)"} in ${runtimeDir}`);
}
