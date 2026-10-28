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

// A chat receipt records useful work, while the answer and transport diagnostics
// have their own presentation. Keep the complete event stream for explicit debugging.
export function chatWorkActivity(items = [], { diagnostics = false } = {}) {
  if (diagnostics) return items;
  return items.filter(item => !["message", "thought", "status"].includes(item.kind) || item.state === "failed");
}
