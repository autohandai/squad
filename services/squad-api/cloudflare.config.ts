import { bindings, defineConfig, triggers, exports as workerExports } from "cf/config";
import { env } from "node:process";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

// This service owns its resources. It has no general Autohand API database or
// R2 bindings; the identity origin verifies sign-in and current owner access.
export default defineConfig({
  worker: {
    name: "squad-api",
    entrypoint,
    exports: { MobileRelay: workerExports.durableObject({ storage: "sqlite" }) },
    compatibilityDate: "2026-10-27",
    // Identity and current team membership are served by another public Worker.
    compatibilityFlags: ["global_fetch_strictly_public"],
    domains: ["squad.autohand.ai"],
    triggers: [triggers.scheduled({ schedule: "17 * * * *" })],
    observability: { enabled: true, traces: { enabled: true, headSamplingRate: 0.1 } },
    env: {
      DB: bindings.d1({ name: "squad-control-plane", id: env.SQUAD_API_DATABASE_ID }),
      MEMORY: bindings.r2({ name: "squad-memory" }),
      RELEASES: bindings.r2({ name: "squad-releases" }),
      IDENTITY_ORIGIN: bindings.text("https://api.autohand.ai"),
      WEB_ORIGIN: bindings.text("https://squad.autohand.ai"),
      RELEASE_PUBLISHER_TOKEN: bindings.secret(),
    },
  },
});
