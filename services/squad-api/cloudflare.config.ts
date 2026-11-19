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
      // Public listings in their own database (ADR-0246): read-heavy public
      // traffic and its restores stay apart from accounts and memory. Bound
      // only when its ID is set, so the service deploys before the
      // marketplace launches; unbound, every marketplace route answers 404
      // and the desktop says the marketplace isn't open yet (ADR-0262).
      ...(env.SQUAD_MARKETPLACE_DATABASE_ID ? { MARKETPLACE: bindings.d1({ name: "squad-marketplace", id: env.SQUAD_MARKETPLACE_DATABASE_ID }) } : {}),
      MEMORY: bindings.r2({ name: "squad-memory" }),
      RELEASES: bindings.r2({ name: "squad-releases" }),
      IDENTITY_ORIGIN: bindings.text("https://api.autohand.ai"),
      WEB_ORIGIN: bindings.text("https://squad.autohand.ai"),
      RELEASE_PUBLISHER_TOKEN: bindings.secret(),
      // Held only by the website's admin functions (ADR-0246).
      MARKETPLACE_ADMIN_TOKEN: bindings.secret(),
      // Browser origins whose pages may send reports and listing events
      // straight to the API (ADR-0246, ADR-0253), comma separated.
      MARKETPLACE_SITE_ORIGINS: bindings.text("https://autohand.ai,https://www.autohand.ai"),
      // Agent email (ADR-0262): the routed domain, and which sign-in email
      // domains may give members addresses (comma separated).
      MAIL_DOMAIN: bindings.text("code.autohandai.com"),
      MAIL_ACCOUNT_DOMAINS: bindings.text("autohand.ai"),
      // Local parts other workers already own through their own routing
      // rules on the domain (checked 2026-11-19); Squad never assigns them.
      MAIL_RESERVED: bindings.text("noah,support,igor,steve,james,luiz.moore,lucia,robert,po-review"),
    },
  },
});
