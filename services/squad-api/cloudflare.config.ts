import { bindings, defineConfig, triggers } from "cf/config";
import { env } from "node:process";

// This service owns its resources. It has no general Autohand API database or
// R2 bindings; the identity origin is used only when exchanging a sign-in.
export default defineConfig({
  worker: {
    name: "squad-api",
    entrypoint: "./src/index.ts",
    compatibilityDate: "2026-10-27",
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
