// Channel names are one word like the placeholder ("release-reviews"), so
// "#launch-plan" can be typed and matched; "Launch Plan" could not
// (bug hunt 2026-10, #65). Applied as the person types and on save.
export function channelSlug(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_-]/gu, "").replace(/-{2,}/g, "-").slice(0, 80);
}
