// The Squad bird cast (ADR-0235): ten New Zealand birds, each drawn in three
// art directions. Which bird a member is never changes with the skin; the
// skin only chooses how that bird is drawn.
//
//   3D (default)  /avatars/birds/<bird>.webp      soft toy-like bust
//   Clay          /avatars/clay/<bird>.webp       plasticine bust, flat backdrop
//   Shapeless     drawn inline (src/lib/bird-faces.js)
//
// A member stores one URL, `member.avatar`, and it stays the 3D path. The menu
// bar reads that file straight out of the bundle and the iPhone app fetches it
// over HTTP, so new 3D art replaces the files behind the same URLs and every
// saved member updates without a data migration.

export const BIRDS = [
  { id: 'kiwi', label: 'Kiwi', line: 'The hero. Patient, low to the ground, finds what others miss.' },
  { id: 'tui', label: 'Tūī', line: 'The voice. Glossy blue-black with a white throat tuft; says what needs saying.' },
  { id: 'kea', label: 'Kea', line: 'The tinkerer. Olive mountain parrot with an orange underwing flash; takes things apart.' },
  { id: 'kereru', label: 'Kererū', line: 'The steady one. Green wood pigeon with a clean white bib.' },
  { id: 'pukeko', label: 'Pūkeko', line: 'The organiser. Violet-blue with a red forehead shield; always counting.' },
  { id: 'ruru', label: 'Ruru', line: 'The night watch. Morepork owl with big gold eyes; keeps an eye on things.' },
  { id: 'fantail', label: 'Pīwakawaka', line: 'The quick one. Fantail with a white brow, never still.' },
  { id: 'takahe', label: 'Takahē', line: 'The heavy lifter. Indigo and teal, big red beak, built to carry.' },
  { id: 'kakapo', label: 'Kākāpō', line: 'The thinker. Moss-green night parrot with a soft whiskered face.' },
  { id: 'kotare', label: 'Kōtare', line: 'The precise one. Turquoise kingfisher with a long straight beak.' },
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
export function birdForSeed(seed) {
  return BIRD_IDS[hash(seed || 'squad') % BIRD_IDS.length];
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
  const start = BIRD_IDS.indexOf(birdForSeed(seed));
  for (let step = 0; step < BIRD_IDS.length; step += 1) {
    const bird = BIRD_IDS[(start + step) % BIRD_IDS.length];
    if (!used.has(bird)) return bird;
  }
  return BIRD_IDS[start];
}

export function birdAvatarSrc(bird) { return `/avatars/birds/${bird}.webp`; }

/** The clay file for a member, or '' when its bird has no clay art installed. */
export function clayAvatarSrc(member) {
  const bird = birdFromAvatar(member?.avatar);
  return bird && INSTALLED_ART.clay.includes(bird) ? `/avatars/clay/${bird}.webp` : '';
}
