// Which birds sit on the perch of the sign-in and update screens (ADR-0245).
//
// The kiwi is always there: it is the cast's hero and the one that carries an
// update along the perch. The rest are drawn from the whole cast, so a bigger
// cast shows up here without a change. A seed makes the pick repeatable (the
// browser check uses one); without it every visit meets different birds.

import { BIRD_FACE_IDS } from './bird-faces.js';

export const FLOCK_LEAD = 'kiwi';

function generator(seed) {
  let state = 0;
  for (const character of String(seed)) state = (Math.imul(state ^ character.charCodeAt(0), 2654435761) + 0x9e3779b9) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `count` distinct birds, the lead first. Fewer are returned only when the
 * cast itself is smaller than `count`.
 */
export function pickFlock(count = 5, { seed, cast = BIRD_FACE_IDS } = {}) {
  const random = seed === undefined || seed === null || seed === '' ? Math.random : generator(seed);
  const others = cast.filter(bird => bird !== FLOCK_LEAD);
  for (let index = others.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [others[index], others[swap]] = [others[swap], others[index]];
  }
  const lead = cast.includes(FLOCK_LEAD) ? [FLOCK_LEAD] : [];
  return [...lead, ...others].slice(0, Math.max(0, count));
}
