// How the app is arranged, chosen independently of the skin (ADR-0233).
// A skin is colour, type, shape and portraits; a layout is what the sidebar
// holds and how a conversation reads. Every skin works with every layout.
export const LAYOUT_STORAGE_KEY = 'autohandSquad.v1.layout';
export const DEFAULT_LAYOUT_ID = 'full';

export const LAYOUTS = [
  { id: 'full', label: 'Full',
    description: 'Everything in the sidebar: Needs you, Squad, Memory, channel sections and direct messages.' },
  { id: 'minified', label: 'Minified',
    description: 'A calm, chat-first squad: your pinned teammates up top, one list of conversations, and replies as bubbles.' },
];

const IDS = new Set(LAYOUTS.map(layout => layout.id));
export function isLayoutId(id) { return IDS.has(String(id || '')); }
export function layoutById(id) { return LAYOUTS.find(layout => layout.id === id) || LAYOUTS[0]; }

// Grut used to be the only way to get the conversation list and bubbles. A
// person who chose Grut before the layout existed chose that arrangement, so
// they keep it once; after that the saved layout is theirs.
export function resolveLayoutId(stored, skinId) {
  if (isLayoutId(stored)) return stored;
  return skinId === 'grut' ? 'minified' : DEFAULT_LAYOUT_ID;
}

// The members shown as large faces at the top of the Minified sidebar:
// pinned members in their pin order, or, with nothing pinned, the few most
// recently spoken to, so the row is never an empty promise.
export const TOP_MEMBER_LIMIT = 8;
export function topMembers(members = [], lastAt = () => 0, limit = TOP_MEMBER_LIMIT) {
  const pinned = members.filter(member => member?.pinned === true);
  if (pinned.length) return { members: pinned.slice(0, limit), pinned: true };
  const recent = [...members].sort((a, b) => (lastAt(b) || 0) - (lastAt(a) || 0));
  return { members: recent.slice(0, 4), pinned: false };
}
