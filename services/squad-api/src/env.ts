import type { InferEnv } from "cf/config";
import type config from "../cloudflare.config.js";
// MARKETPLACE is bound only once its database exists (see the config). Code
// past the `unopened` guard in marketplace.ts may treat it as present.
export type Env = Omit<InferEnv<typeof config.worker>, "MARKETPLACE"> & { MARKETPLACE: D1Database };
