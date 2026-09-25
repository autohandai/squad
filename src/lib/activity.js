// Browser entry for the activity normaliser. The server module is pure ESM
// with no Node imports, so Vite bundles it as-is and Node checks import the
// same code. See docs/integration/activity.md.
export {
  activityFromTrace,
  activityStats,
  classifyTool,
  collapseActivity,
  isLogLine,
  normalizeActivity,
  summarizeQuiet,
  toolObject,
} from "../../server/activity/normalize.mjs";
