// Saved recipes (ADR-0259): repeatable work the Chief of Staff (or the person)
// saved from what this Squad actually does. One JSON file in the owned Squad
// state; built-in starters stay in the app (src/data.js).
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readPersistentJson, writePersistentJson } from '../persistent-json.mjs';

export const RECIPES_FILE = 'recipes.json';
const MAX_RECIPES = 100;
const clean = (value, limit) => String(value ?? '').replace(/\r\n/g, '\n').trim().slice(0, limit);
const SOURCES = new Set(['chief-of-staff', 'member', 'person', 'spotted']);

export function createRecipeStore(directory) {
  const file = join(directory, RECIPES_FILE);
  let chain = Promise.resolve();
  const serial = fn => { const result = chain.then(fn); chain = result.catch(() => {}); return result; };
  const read = async () => {
    const state = await readPersistentJson(file, { version: 1, recipes: [] }).catch(() => ({ version: 1, recipes: [] }));
    return Array.isArray(state?.recipes) ? state.recipes : [];
  };
  return {
    list: async () => (await read()).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    save: input => serial(async () => {
      const name = clean(input.name, 80), prompt = clean(input.prompt, 4000);
      if (name.length < 3) throw Object.assign(new Error('Give the recipe a short name.'), { status: 400 });
      if (prompt.length < 8) throw Object.assign(new Error('Say what the member should do when the recipe runs.'), { status: 400 });
      const recipes = await read();
      // Saving the same request again updates it instead of adding a copy.
      const same = recipes.find(recipe => recipe.prompt === prompt && recipe.memberId === (input.memberId || null));
      const recipe = {
        id: same?.id || `recipe-${randomUUID()}`,
        name, prompt,
        description: clean(input.description, 400),
        memberId: typeof input.memberId === 'string' && input.memberId.trim() ? input.memberId.trim().slice(0, 160) : null,
        source: SOURCES.has(input.source) ? input.source : 'person',
        savedBy: clean(input.savedBy, 80),
        evidence: clean(input.evidence, 400),
        createdAt: same?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const next = [recipe, ...recipes.filter(item => item.id !== recipe.id)];
      if (next.length > MAX_RECIPES) throw Object.assign(new Error(`This Squad holds ${MAX_RECIPES} recipes. Remove one first.`), { status: 409 });
      await writePersistentJson(file, { version: 1, recipes: next });
      return recipe;
    }),
    remove: id => serial(async () => {
      const recipes = await read();
      if (!recipes.some(recipe => recipe.id === id)) throw Object.assign(new Error('That recipe is not saved here.'), { status: 404 });
      await writePersistentJson(file, { version: 1, recipes: recipes.filter(recipe => recipe.id !== id) });
      return { removed: id };
    }),
  };
}

const stores = new Map();
export function recipeStoreFor(directory) {
  if (!stores.has(directory)) stores.set(directory, createRecipeStore(directory));
  return stores.get(directory);
}
