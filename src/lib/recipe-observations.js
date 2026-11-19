// Recipes from the work actually being done (ADR-0259).
//
// The owner, 19 Nov 2026: "i don't understand the launch recipe feature, we
// should be more clever on that one and the recipes should be actually coming
// from observations of the chief of staff based on the work being done". The
// old catalogue was five fixed engineering workflows (fix a failing test,
// review a PR …) unrelated to what this Squad does.
//
// Pure: spots work the person keeps asking for. Requests to the same member
// whose words mostly overlap (Jaccard ≥ 0.5 on content words, with numbers,
// dates and links ignored) form one pattern; a pattern seen at least three
// times on at least two different days is a suggested recipe, with its
// evidence. The Chief of Staff saves the ones worth keeping
// (squad_save_recipe); the person can save a suggestion with one click.

const STOP = new Set("a an and are as at be but by can could do for from get give has have i in into is it its just let lets me my need of on or our please so that the their them then there these this to up us was we what when which will with would you your can't don't i'm it's".split(" "));
export const SPOT_MIN_RUNS = 3;
export const SPOT_MIN_DAYS = 2;
export const SPOT_SIMILARITY = 0.5;
const MAX_SUGGESTIONS = 6;

/** Content words of a request, without links, numbers, dates or punctuation. */
export function requestWords(text) {
  return new Set(String(text || "").toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\b\d[\d/:.\-]*\b/g, " ")
    .replace(/[^a-zÀ-ɏ'\s]/g, " ")
    .split(/\s+/)
    .map((word) => word.replace(/^'+|'+$/g, ""))
    .filter((word) => word.length > 2 && !STOP.has(word)));
}

export function similarity(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared);
}

const day = (value) => String(value || "").slice(0, 10);
const clip = (text, limit) => { const value = String(text || "").replace(/\s+/g, " ").trim(); return value.length > limit ? `${value.slice(0, limit - 1)}…` : value; };

/** A short name from the words the pattern's requests share most. */
function patternName(cluster) {
  const counts = new Map();
  for (const item of cluster) for (const word of item.words) counts.set(word, (counts.get(word) || 0) + 1);
  const shared = [...counts].filter(([, count]) => count >= Math.ceil(cluster.length * 0.6)).map(([word]) => word);
  // Keep the order the words have in the newest request.
  const newest = cluster[0].prompt.toLowerCase();
  const ordered = shared.sort((a, b) => newest.indexOf(a) - newest.indexOf(b)).slice(0, 5);
  const name = ordered.join(" ");
  return name ? name[0].toUpperCase() + name.slice(1) : clip(cluster[0].prompt, 40);
}

/**
 * Suggested recipes from run history (newest first or not; sorted here).
 * `runs`: [{ agentId, prompt, startedAt|createdAt, recipeId? }]. `members`:
 * [{ id, name }]. `known`: prompts already saved as recipes, so a saved one is
 * not suggested again.
 */
export function spotRecipes(runs = [], { members = [], known = [] } = {}) {
  const names = new Map(members.map((member) => [member.id, member.name]));
  const knownWords = known.map(requestWords);
  const items = runs
    .filter((run) => run && run.agentId && typeof run.prompt === "string" && run.prompt.trim().length >= 12 && !run.recipeId)
    .map((run) => ({ agentId: run.agentId, prompt: run.prompt.trim(), at: run.startedAt || run.createdAt || "", words: requestWords(run.prompt) }))
    .filter((item) => item.words.size >= 2)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const clusters = [];
  for (const item of items) {
    const home = clusters.find((cluster) => cluster.agentId === item.agentId && similarity(cluster.items[0].words, item.words) >= SPOT_SIMILARITY);
    if (home) home.items.push(item); else clusters.push({ agentId: item.agentId, items: [item] });
  }
  return clusters
    .filter((cluster) => cluster.items.length >= SPOT_MIN_RUNS && new Set(cluster.items.map((item) => day(item.at))).size >= SPOT_MIN_DAYS)
    .filter((cluster) => !knownWords.some((words) => similarity(words, cluster.items[0].words) >= SPOT_SIMILARITY))
    .sort((a, b) => b.items.length - a.items.length || String(b.items[0].at).localeCompare(String(a.items[0].at)))
    .slice(0, MAX_SUGGESTIONS)
    .map((cluster) => {
      const member = names.get(cluster.agentId) || "a member";
      const first = cluster.items.at(-1).at;
      return {
        id: `spotted-${cluster.agentId}-${[...cluster.items[0].words].slice(0, 4).join("-")}`,
        source: "spotted",
        name: patternName(cluster.items),
        description: `You asked ${member} for this ${cluster.items.length} times since ${day(first)}.`,
        prompt: cluster.items[0].prompt,
        memberId: cluster.agentId,
        evidence: { runs: cluster.items.length, firstAt: first, lastAt: cluster.items[0].at },
        roleId: null,
      };
    });
}
