import type { InferEnv } from "cf/config";
import type config from "../cloudflare.config.js";
export type Env = InferEnv<typeof config.worker>;
