// The Squad bird cast: 300 birds, each drawn as one flat face
// (src/lib/bird-faces.js) that every skin and theme shows the same way
// (ADR-0240). A member stores one URL, `member.avatar`, at
// /avatars/birds/<bird>.webp. The app draws the face inline from the id in
// that URL; the menu bar reads the same file out of the bundle and the iPhone
// fetches it, so the file and the drawing are always the same bird.
//
// The first 26 are drawn by hand (ADR-0235, ADR-0241); the other 274 are
// composed from bird-species.js (ADR-0243). Their `region` is kept only
// because assignment hashes over the ten New Zealand birds; the app never
// groups or labels birds by country.

import { COMPOSED_BIRDS } from './bird-species.js';

export const BIRDS = [
  { id: 'kiwi', region: 'nz', label: 'Kiwi', line: 'The hero. Patient, low to the ground, finds what others miss.' },
  { id: 'tui', region: 'nz', label: 'Tūī', line: 'The voice. Glossy blue-black with a white throat tuft; says what needs saying.' },
  { id: 'kea', region: 'nz', label: 'Kea', line: 'The tinkerer. Olive mountain parrot with an orange underwing flash; takes things apart.' },
  { id: 'kereru', region: 'nz', label: 'Kererū', line: 'The steady one. Green wood pigeon with a clean white bib.' },
  { id: 'pukeko', region: 'nz', label: 'Pūkeko', line: 'The organiser. Violet-blue with a red forehead shield; always counting.' },
  { id: 'ruru', region: 'nz', label: 'Ruru', line: 'The night watch. Morepork owl with big gold eyes; keeps an eye on things.' },
  { id: 'fantail', region: 'nz', label: 'Pīwakawaka', line: 'The quick one. Fantail with a white brow, never still.' },
  { id: 'takahe', region: 'nz', label: 'Takahē', line: 'The heavy lifter. Indigo and teal, big red beak, built to carry.' },
  { id: 'kakapo', region: 'nz', label: 'Kākāpō', line: 'The thinker. Moss-green night parrot with a soft whiskered face.' },
  { id: 'kotare', region: 'nz', label: 'Kōtare', line: 'The precise one. Turquoise kingfisher with a long straight beak.' },
  // Brazil and the United States (ADR-0241). New Zealand stays the default
  // cast; the rest join the picker and are assigned, in cast order, only once
  // all ten NZ birds are taken.
  { id: 'tucano', region: 'br', label: 'Tucano', line: 'Black with a white throat and a huge orange beak.' },
  { id: 'araraazul', region: 'br', label: 'Arara-azul', line: 'Hyacinth macaw: cobalt blue with yellow eye rings.' },
  { id: 'bemtevi', region: 'br', label: 'Bem-te-vi', line: 'Brown, a white brow under a black cap, a yellow belly.' },
  { id: 'sabia', region: 'br', label: 'Sabiá', line: 'Rufous-bellied thrush with yellow eye rings.' },
  { id: 'beijaflor', region: 'br', label: 'Beija-flor', line: 'Green hummingbird with a long fine beak and a ruby throat.' },
  { id: 'queroquero', region: 'br', label: 'Quero-quero', line: 'Grey lapwing with a thin crest and a black chest.' },
  { id: 'harpia', region: 'br', label: 'Harpia', line: 'Harpy eagle: grey head, double crest, black breast band.' },
  { id: 'joaodebarro', region: 'br', label: 'João-de-barro', line: 'Rufous hornero, the mud-nest builder.' },
  { id: 'baldeagle', region: 'us', label: 'Bald eagle', line: 'White head, brown shoulders, a big yellow beak.' },
  { id: 'cardinal', region: 'us', label: 'Cardinal', line: 'Red, crested, with a black mask round an orange beak.' },
  { id: 'bluejay', region: 'us', label: 'Blue jay', line: 'Blue crest, white face and a black necklace.' },
  { id: 'robin', region: 'us', label: 'Robin', line: 'American robin: dark head, orange breast, white eye arcs.' },
  { id: 'roadrunner', region: 'us', label: 'Roadrunner', line: 'Streaked and crested, with a long straight beak.' },
  { id: 'puffin', region: 'us', label: 'Puffin', line: 'Black cap, white face and a bright orange beak.' },
  { id: 'flamingo', region: 'us', label: 'Flamingo', line: 'Pink, with a bent black-tipped beak.' },
  { id: 'chickadee', region: 'us', label: 'Chickadee', line: 'Black cap and bib, white cheeks, grey body.' },
  ...COMPOSED_BIRDS.map(({ id, label, aliases }) => ({ id, label, ...(aliases.length ? { aliases } : {}) })),
];

export const BIRD_IDS = BIRDS.map(bird => bird.id);
const BIRD_SET = new Set(BIRD_IDS);

// Raster art that is installed, per style. A skin only points at a file listed
// here: Radix drops an <img> that 404s and shows an initial instead, so an
// unlisted bird keeps the member's own picture. scripts/build-bird-cast.mjs
// rewrites this list when it installs art.
export const INSTALLED_ART = {
  clay: [],
};

/** The bird behind an avatar URL, or '' when the avatar is not a cast bird. */
export function birdFromAvatar(src) {
  const match = /^\/avatars\/(?:birds|clay)\/(?:\d+\/)?([a-z]+)\.(?:webp|png|jpg)$/i.exec(String(src || ''));
  return match && BIRD_SET.has(match[1].toLowerCase()) ? match[1].toLowerCase() : '';
}

/** A stable 32-bit hash with a final avalanche (see blob-avatar.js for why). */
function hash(seed) {
  let value = 2166136261;
  for (const character of String(seed || '')) {
    value ^= character.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  value ^= value >>> 16;
  value = Math.imul(value, 2246822507);
  value ^= value >>> 13;
  value = Math.imul(value, 3266489909);
  value ^= value >>> 16;
  return value >>> 0;
}

/** The bird a seed lands on when nothing else decides. */
// Assignment hashes over the New Zealand cast only, so adding birds from
// other countries never moves a member who already has a bird (ADR-0241).
const DEFAULT_CAST = BIRDS.filter(bird => bird.region === 'nz').map(bird => bird.id);

const BIRD_BY_ID = new Map(BIRDS.map(bird => [bird.id, bird]));
/** A cast bird by id, or null. */
export function birdById(id) { return BIRD_BY_ID.get(String(id || '').toLowerCase()) || null; }

// Search folds accents and punctuation, so "tui" finds Tūī and "kaka" Kākā.
const fold = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// English names for the drawn birds whose label is Māori or Portuguese.
const ALIASES = { tui: 'parson bird', kereru: 'wood pigeon', pukeko: 'swamphen', ruru: 'morepork owl', fantail: 'fantail', kakapo: 'night parrot', kotare: 'sacred kingfisher', tucano: 'toco toucan', araraazul: 'hyacinth macaw', bemtevi: 'great kiskadee', sabia: 'rufous-bellied thrush', beijaflor: 'hummingbird', queroquero: 'southern lapwing', harpia: 'harpy eagle', joaodebarro: 'rufous hornero', robin: 'american robin', puffin: 'atlantic puffin', chickadee: 'black-capped chickadee', cardinal: 'northern cardinal' };
const SEARCH_TEXT = new Map(BIRDS.map(bird => [bird.id, ` ${fold([bird.label, ...(bird.aliases || []), ALIASES[bird.id] || ''].join(' '))} ${bird.id} `]));
/** Birds whose names start words with every word of the query, in cast order. */
export function searchBirds(query = '') {
  const words = fold(query).split(' ').filter(Boolean);
  if (!words.length) return BIRDS;
  // Each word must start a word of the name ("owl" finds Barn owl, not Peafowl).
  return BIRDS.filter(bird => words.every(word => SEARCH_TEXT.get(bird.id).includes(` ${word}`)));
}
export function birdForSeed(seed) {
  return DEFAULT_CAST[hash(seed || 'squad') % DEFAULT_CAST.length];
}

/**
 * The bird a member is: the one in its avatar URL, or for a member with a
 * custom picture, one derived from its id so it is the same bird every time.
 */
export function birdForMember(member) {
  return birdFromAvatar(member?.avatar) || birdForSeed(member?.id || member?.name);
}

/**
 * A bird nobody in `taken` has yet, starting from the seed's own bird so the
 * same seed asks for the same bird first. When all ten are taken the seed's
 * bird is shared rather than failing.
 */
export function untakenBird(seed, taken = []) {
  const used = new Set([...taken].map(birdFromAvatar).filter(Boolean));
  const start = DEFAULT_CAST.indexOf(birdForSeed(seed));
  for (let step = 0; step < DEFAULT_CAST.length; step += 1) {
    const bird = DEFAULT_CAST[(start + step) % DEFAULT_CAST.length];
    if (!used.has(bird)) return bird;
  }
  // All ten NZ birds are taken: the rest of the cast, in cast order.
  const next = BIRD_IDS.find(bird => !DEFAULT_CAST.includes(bird) && !used.has(bird));
  return next || DEFAULT_CAST[start];
}

export function birdAvatarSrc(bird) { return `/avatars/birds/${bird}.webp`; }

/** The clay file for a member, or '' when its bird has no clay art installed. */
export function clayAvatarSrc(member) {
  const bird = birdFromAvatar(member?.avatar);
  return bird && INSTALLED_ART.clay.includes(bird) ? `/avatars/clay/${bird}.webp` : '';
}
