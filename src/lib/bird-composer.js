// The bird face composer (ADR-0243). The first 26 birds are drawn by hand in
// bird-faces.js; the rest of the cast is composed from a short description of
// each species (bird-species.js): a head shape, a beak, and a few species
// marks, in the same 100x100 box and the same drawing rules:
//
// - one soft silhouette, two short eye marks cut out as holes;
// - species marks follow the silhouette's own edge (they are traced along the
//   same ellipse arcs), so nothing pokes out of the head except crests, tails
//   and beaks, which are meant to;
// - when the topmost layer at the eyes is pale, the eyes are cut through it
//   alone and sit over a dark mark, so they never vanish on a light tile
//   (the bald eagle and puffin rule from ADR-0241). Otherwise they are cut
//   through every layer and take the tile's colour, as before.
//
// The output is the hand-drawn FACES shape ({ eyes, eye, layers }), so
// birdFaceSvg renders composed and drawn birds the same way.

const r = value => Math.round(value * 10) / 10;
const DARK = '#26272b';
const CREAM = '#eceae3';

// Head shapes. An egg: centre, half width, top and bottom heights. Front
// faces have their eyes either side of the centre; side faces look right,
// with the beak leaving the right edge.
const PRESETS = {
  round: { cx: 50, cy: 52, rx: 38, rt: 40, rb: 38, eyes: [-12, 12], ey: 45 },
  tall: { cx: 50, cy: 50, rx: 29, rt: 38, rb: 40, eyes: [-11, 11], ey: 42 },
  wide: { cx: 50, cy: 55, rx: 41, rt: 38, rb: 35, eyes: [-14, 14], ey: 48 },
  squat: { cx: 50, cy: 60, rx: 39, rt: 34, rb: 30, eyes: [-13, 13], ey: 54 },
  side: { cx: 44, cy: 52, rx: 34, rt: 38, rb: 38, eyes: [-10, 6], ey: 45, side: true },
  sidesmall: { cx: 40, cy: 56, rx: 30, rt: 34, rb: 34, eyes: [-9, 6], ey: 50, side: true },
};
export const PRESET_IDS = Object.keys(PRESETS);

function geometry(name) {
  const p = PRESETS[name];
  if (!p) throw new Error(`unknown head shape ${name}`);
  const g = { ...p, top: p.cy - p.rt, bottom: p.cy + p.rb, ex: p.eyes.map(dx => p.cx + dx) };
  g.mid = (g.ex[0] + g.ex[1]) / 2;
  // Front beaks hang from just under the eyes; side beaks leave the right edge.
  g.by = g.ey + 7;
  g.ax = g.cx + g.rx - 5;
  g.ay = g.ey + 6;
  g.crestX = g.side ? g.cx - 6 : g.cx;
  return g;
}

// Half width of the egg at height y (0 outside it).
function halfWidth(g, y) {
  const h = y < g.cy ? g.rt : g.rb;
  const t = (y - g.cy) / h;
  return Math.abs(t) >= 1 ? 0 : g.rx * Math.sqrt(1 - t * t);
}

// Angle of a boundary point, clockwise on screen from the right-hand side.
function angleAt(g, x, y) {
  const h = y < g.cy ? g.rt : g.rb;
  let a = Math.atan2((y - g.cy) / h, (x - g.cx) / g.rx);
  if (a < 0) a += Math.PI * 2;
  return a;
}

function pointAt(g, a) {
  const s = Math.sin(a);
  return [g.cx + g.rx * Math.cos(a), g.cy + (s >= 0 ? g.rb : g.rt) * s];
}

// Follow the head's edge clockwise from angle a to angle b, as elliptical
// arcs that switch radius where the egg's two halves meet.
function edge(g, a, b) {
  if (b <= a) b += Math.PI * 2;
  let out = '';
  let at = a;
  while (at < b - 1e-6) {
    const next = Math.min(b, (Math.floor(at / Math.PI + 1e-9) + 1) * Math.PI);
    const [x, y] = pointAt(g, next);
    const lower = Math.sin((at + next) / 2) >= 0;
    out += `A${g.rx} ${lower ? g.rb : g.rt} 0 0 1 ${r(x)} ${r(y)}`;
    at = next;
  }
  return out;
}

// The part of the head between two horizontal edges. `from`/`to` are heights
// (null for the head's own top or bottom); `bow` lifts the middle of an edge
// (negative raises it, so a bib's top edge arches like the kererū's).
function band(g, from, to, { bowTop = 0, bowBottom = 0 } = {}) {
  const top = from == null || from <= g.top + 0.5 ? null : from;
  const bottom = to == null || to >= g.bottom - 0.5 ? null : to;
  const left = y => [g.cx - halfWidth(g, y), y];
  const right = y => [g.cx + halfWidth(g, y), y];
  const p = ([x, y]) => `${r(x)} ${r(y)}`;
  if (top == null && bottom == null) return body(g);
  if (top == null) {
    const [l, rr] = [left(bottom), right(bottom)];
    return `M${p(l)}${edge(g, angleAt(g, ...l), angleAt(g, ...rr))}Q${r(g.cx)} ${r(bottom + 2 * bowBottom)} ${p(l)}z`;
  }
  const [l1, r1] = [left(top), right(top)];
  if (bottom == null) {
    return `M${p(l1)}Q${r(g.cx)} ${r(top + 2 * bowTop)} ${p(r1)}${edge(g, angleAt(g, ...r1), angleAt(g, ...l1))}z`;
  }
  const [l2, r2] = [left(bottom), right(bottom)];
  return `M${p(l1)}Q${r(g.cx)} ${r(top + 2 * bowTop)} ${p(r1)}${edge(g, angleAt(g, ...r1), angleAt(g, ...r2))}Q${r(g.cx)} ${r(bottom + 2 * bowBottom)} ${p(l2)}${edge(g, angleAt(g, ...l2), angleAt(g, ...l1))}z`;
}

function body(g) {
  return `M${g.cx - g.rx} ${g.cy}A${g.rx} ${g.rt} 0 0 1 ${g.cx + g.rx} ${g.cy}A${g.rx} ${g.rb} 0 0 1 ${g.cx - g.rx} ${g.cy}z`;
}

const ellipse = (x, y, rx, ry = rx) => `M${r(x - rx)} ${r(y)}a${rx} ${ry} 0 1 0 ${r(rx * 2)} 0a${rx} ${ry} 0 1 0 ${r(-rx * 2)} 0z`;
const ring = (x, y, radius) => `M${r(x - radius)} ${r(y)}a${radius} ${radius} 0 1 0 ${r(radius * 2)} 0a${radius} ${radius} 0 1 0 ${r(-radius * 2)} 0`;

// Beaks. Front beaks are anchored under the eyes at (mid, by); side beaks at
// the right edge (ax, ay). Each returns layers (some beaks have two colours).
const BEAKS = {
  tri: (g, c) => [{ fill: c, d: `M${r(g.mid - 5)} ${g.by}h10l-5 6z` }],
  small: (g, c) => [{ fill: c, d: `M${r(g.mid - 3.5)} ${g.by}h7l-3.5 4.5z` }],
  cone: (g, c) => [{ fill: c, d: `M${r(g.mid - 6)} ${g.by - 1}h12c0 4-3 8-6 9-3-1-6-5-6-9z` }],
  thick: (g, c) => [{ fill: c, d: `M${r(g.mid - 7.5)} ${g.by - 2}h15c0 6-4 11-7.5 12-3.5-1-7.5-6-7.5-12z` }],
  long: (g, c) => [{ fill: c, d: `M${r(g.mid - 4)} ${g.by}h8l-4 15z` }],
  drop: (g, c) => [{ fill: c, d: `M${r(g.mid - 5)} ${g.by}h10c0 5-2 9-5 12-3-3-5-7-5-12z` }],
  hook: (g, c) => [{ fill: c, d: `M${r(g.mid - 6)} ${g.by}h12c4 0 7 4 7 8 0 5-4 9-8 10 1-4-1-7-4-8h-7z` }],
  bighook: (g, c) => [{ fill: c, d: `M${r(g.mid - 8)} ${g.by}h14c7 0 11 5 11 11 0 7-5 12-11 14 1-5-1-10-6-11h-8z` }],
  // Side beaks.
  short: (g, c) => [{ fill: c, d: `M${g.ax - 2} ${g.ay - 4}L${g.ax + 12} ${g.ay}L${g.ax - 2} ${g.ay + 4}z` }],
  dagger: (g, c) => [{ fill: c, d: `M${g.ax - 2} ${g.ay - 4}L${g.ax + 27} ${g.ay + 0.5}L${g.ax - 2} ${g.ay + 4}z` }],
  needle: (g, c) => [{ stroke: c, width: 2.6, d: `M${g.ax - 2} ${g.ay}L${g.ax + 29} ${g.ay + 3}` }],
  curve: (g, c) => [{ stroke: c, width: 3, d: `M${g.ax - 2} ${g.ay}c12 0 21 5 27 15` }],
  upturn: (g, c) => [{ fill: c, d: `M${g.ax - 2} ${g.ay - 3}c10 1 19-2 27-10-4 8-12 13-27 14z` }],
  spoon: (g, c) => [{ stroke: c, width: 3, d: `M${g.ax - 2} ${g.ay}L${g.ax + 19} ${g.ay + 1}` }, { fill: c, d: ellipse(g.ax + 22, g.ay + 1, 5.5, 4) }],
  sidehook: (g, c) => [{ fill: c, d: `M${g.ax - 4} ${g.ay - 5}h8c6 0 10 4 10 9 0 4-3 7-6 8 0-3-2-5-5-5h-7z` }],
  bill: (g, c) => [{ fill: c, d: `M${g.ax - 3} ${g.ay - 4}h15c4 0 6 3 5 6-1 3-3 4-7 4H${g.ax - 3}z` }],
  sidecone: (g, c) => [{ fill: c, d: `M${g.ax - 3} ${g.ay - 6}c6 0 12 3 14 6-2 3-8 6-14 6z` }],
  big: (g, c) => [{ fill: c, d: `M${g.ax - 5} ${g.ay - 4}c10-8 22-9 31-5-3 8-14 13-31 13z` }],
  pouch: (g, c, extra = '#e8a54a') => [
    { fill: extra, d: `M${g.ax - 3} ${g.ay + 1}L${g.ax + 25} ${g.ay + 1}c-4 8-14 12-28 10z` },
    { fill: c, d: `M${g.ax - 3} ${g.ay - 4}L${g.ax + 27} ${g.ay}L${g.ax - 3} ${g.ay + 2}z` },
  ],
  none: () => [],
};
export const BEAK_IDS = Object.keys(BEAKS);

// Crests sit behind the head.
const CRESTS = {
  peak: (g, c) => ({ fill: c, d: `M${g.crestX - 13} ${g.top + 12}L${g.crestX + 5} ${g.top - 11}L${g.crestX + 13} ${g.top + 12}z` }),
  tuft: (g, c) => ({ stroke: c, width: 3.2, d: `M${g.crestX} ${g.top + 3}l-2-11M${g.crestX + 5} ${g.top + 3}l3-9M${g.crestX - 5} ${g.top + 4}l-7-7` }),
  plume: (g, c) => [{ stroke: c, width: 3, d: `M${g.crestX} ${g.top + 3}c-1-6 3-10 9-11` }, { fill: c, d: ellipse(g.crestX + 9.5, g.top - 8, 3.4) }],
  swept: (g, c) => ({ stroke: c, width: 3, d: `M${g.crestX - 2} ${g.top + 5}c-6-8-16-11-28-9` }),
  fan: (g, c) => ({ fill: c, d: `M${g.crestX - 16} ${g.top + 12}L${g.crestX - 23} ${g.top - 12}L${g.crestX - 8} ${g.top + 3}L${g.crestX - 3} ${g.top - 20}L${g.crestX + 3} ${g.top + 3}L${g.crestX + 14} ${g.top - 15}L${g.crestX + 14} ${g.top + 12}z` }),
  horns: (g, c) => ({ fill: c, d: `M${g.cx - 22} ${g.top + 14}L${g.cx - 27} ${g.top - 6}L${g.cx - 11} ${g.top + 7}zM${g.cx + 22} ${g.top + 14}L${g.cx + 27} ${g.top - 6}L${g.cx + 11} ${g.top + 7}z` }),
  mohawk: (g, c) => ({ fill: c, d: ellipse(g.crestX, g.top + 4, 11, 10) }),
  spray: (g, c) => [
    { stroke: c, width: 1.8, d: `M${g.crestX} ${g.top + 4}l-11-11M${g.crestX} ${g.top + 4}l-4-14M${g.crestX} ${g.top + 4}l4-14M${g.crestX} ${g.top + 4}l11-11` },
    { fill: c, d: [[-11, -7], [-4, -10], [4, -10], [11, -7]].map(([dx, dy]) => ellipse(g.crestX + dx, g.top + dy, 1.8)).join('') },
  ],
  wisp: (g, c) => [
    { stroke: c, width: 1.6, d: `M${g.crestX} ${g.top + 4}l-7-11M${g.crestX} ${g.top + 4}v-13M${g.crestX} ${g.top + 4}l7-11` },
    { fill: c, d: [[-7, -7], [0, -9], [7, -7]].map(([dx, dy]) => ellipse(g.crestX + dx, g.top + dy, 2.6)).join('') },
  ],
  helmet: (g, c) => ({ fill: c, d: `M${g.crestX - 9} ${g.top + 8}c0-10 4-18 9-20 5 2 9 10 9 20z` }),
  comb: (g, c) => ({ fill: c, d: `M${g.crestX - 11} ${g.top + 7}c-2-6 2-10 6-7 0-6 7-8 9-3 3-4 9-3 8 3 4 0 6 4 4 9z` }),
};
export const CREST_IDS = Object.keys(CRESTS);

// Species marks drawn over the head. `covers` marks a layer that lies over
// the eyes, so it carries the eye holes (see the rule at the top).
const MARKS = {
  cap: (g, c) => ({ fill: c, d: band(g, null, g.ey - 9, { bowBottom: -4 }) }),
  hood: (g, c) => ({ fill: c, d: band(g, null, g.by + 5, { bowBottom: -4 }), covers: true }),
  mask: (g, c) => ({ fill: c, d: band(g, g.ey - 6.5, g.ey + 6.5), covers: true }),
  stripe: (g, c) => ({ fill: c, d: band(g, g.ey - 4, g.ey + 3.5), covers: true }),
  front: (g, c) => ({ fill: c, d: band(g, g.ey - 10, null, { bowTop: -3 }), covers: true }),
  bib: (g, c) => ({ fill: c, d: band(g, g.by + 9, null, { bowTop: -5 }) }),
  breast: (g, c) => ({ fill: c, d: band(g, g.by + 3, null, { bowTop: -5 }) }),
  belly: (g, c) => ({ fill: c, d: band(g, g.by + 17, null, { bowTop: -4 }) }),
  // Low on the chest: just under the beak, a band read as a grin.
  collar: (g, c) => ({ fill: c, d: band(g, g.by + 16, g.by + 22, { bowTop: -4, bowBottom: -4 }) }),
  face: (g, c) => ({ fill: c, d: ellipse(g.mid, g.ey + 3, (g.ex[1] - g.ex[0]) / 2 + 10, 14), covers: true }),
  disc: (g, c) => ({ fill: c, d: g.ex.map(x => ellipse(x, g.ey, 10.5)).join(''), covers: true }),
  spectacles: (g, c) => ({ fill: c, d: g.ex.map(x => ellipse(x, g.ey, 7.5)).join(''), covers: true }),
  eyering: (g, c) => ({ stroke: c, width: 2.2, d: g.ex.map(x => ring(x, g.ey, 6.2)).join('') }),
  brow: (g, c) => ({ stroke: c, width: 2.8, d: g.ex.map(x => `M${r(x - 6)} ${g.ey - 8.5}q6-4 12 0`).join('') }),
  cheek: (g, c) => ({ fill: c, d: g.ex.map((x, i) => ellipse(x + (i ? 5 : -5), g.ey + 11, 5)).join('') }),
  ear: (g, c) => ({ fill: c, d: g.ex.map((x, i) => ellipse(x + (i ? 11 : -11), g.ey + 3, 4.5)).join('') }),
  // A throat hangs from the beak like the chickadee's bib. A free oval under
  // the beak read as an open mouth on the first contact sheet.
  throat: (g, c) => {
    const [x, y] = g.side ? [g.ax - 8, g.ay + 9] : [g.mid, g.by + 11];
    return { fill: c, d: `M${r(x - 12)} ${y}c3-4 7-6 12-6s9 2 12 6c-1 7-6 11-12 11s-11-4-12-11z` };
  },
  // A forehead runs down into the beak (a dot between the eyes read as a
  // third eye); on a side face it is the knob at the base of the bill.
  forehead: (g, c) => ({ fill: c, d: g.side ? ellipse(g.ax - 1, g.ay - 5, 4, 3.2) : `M${r(g.mid)} ${g.ey - 13}c3 0 4 3 4 6v${r(g.by - g.ey + 5)}h-8v${r(-(g.by - g.ey + 5))}c0-3 1-6 4-6z` }),
  crown: (g, c) => ({ fill: c, d: ellipse(g.side ? g.cx - 2 : g.cx, g.top + 9, 7) }),
  tie: (g, c) => ({ fill: c, d: `M${r(g.mid - 4)} ${g.by + 3}h8l-1 ${r(g.bottom - g.by - 12)}c0 3-6 3-6 0z` }),
  spots: (g, c) => ({ fill: c, d: [[-10, 14], [10, 14], [0, 19], [-5, 26], [5, 26]].map(([dx, dy]) => ellipse(g.cx + dx, g.by + dy, 1.9)).join('') }),
  streaks: (g, c) => ({ stroke: c, width: 1.8, d: [[-14, 13], [-4, 18], [6, 13], [14, 19], [-9, 25], [2, 26]].map(([dx, dy]) => `M${g.cx + dx} ${g.by + dy}l2 4`).join('') }),
  // Slanted outwards: straight down from the eyes read as tears.
  moustache: (g, c) => ({ stroke: c, width: 3.4, d: `M${g.ex[0]} ${g.ey + 8}l-4 8M${g.ex[1]} ${g.ey + 8}l4 8` }),
  patches: (g, c) => ({ fill: c, d: [-1, 1].map(s => ellipse(g.cx + s * (g.rx - 11), g.by + 16, 5, 4)).join('') }),
  wattle: (g, c) => ({ fill: c, d: `M${r((g.side ? g.ax - 4 : g.mid) - 3)} ${g.by + 7}c0-3 6-3 6 0 0 5-1 9-3 9s-3-4-3-9z` }),
  shield: (g, c) => ({ fill: c, d: `M${g.mid - 4} ${g.top + 5}c0-3 8-3 8 0v${r(g.by - g.top - 10)}c4 2 6 5 6 9L${g.mid} ${g.by + 15}L${g.mid - 10} ${g.by + 4}c0-4 2-7 6-9z` }),
  casque: (g, c) => ({ fill: c, d: `M${g.ax - 6} ${g.ay - 5}c4-8 18-12 27-8-6 2-16 5-27 8z` }),
};
export const MARK_IDS = Object.keys(MARKS);
const BEHIND = new Set(['tail']);

function luminance(hex) {
  const value = parseInt(String(hex).slice(1), 16);
  const channel = shift => {
    const c = ((value >> shift) & 255) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
}
export const isPale = hex => luminance(hex) > 0.55;
const isInk = hex => luminance(hex) < 0.045;

/**
 * A face from a species description:
 *   { shape, body, beak: [kind, colour, extra?], crest: [kind, colour],
 *     tail: colour, marks: [[kind, colour], …], eye: [rx, ry] }
 * Marks are drawn in the order given.
 */
export function composeFace(spec) {
  const g = geometry(spec.shape);
  const layers = [];
  if (spec.tail) layers.push({ fill: spec.tail, d: g.side ? `M${g.cx - 14} ${g.cy}L${g.cx - 30} ${g.top - 2}c-10 4-14 12-14 22z` : `M${g.cx + 6} ${g.cy}L${g.cx + 14} ${g.top - 4}c12 0 22 6 28 16z` });
  if (spec.crest) {
    const crest = CRESTS[spec.crest[0]];
    if (!crest) throw new Error(`unknown crest ${spec.crest[0]}`);
    layers.push(...[].concat(crest(g, spec.crest[1])));
  }
  const head = { fill: spec.body, d: body(g), covers: true };
  layers.push(head);
  const beakKind = spec.beak?.[0] || 'tri';
  const beak = BEAKS[beakKind];
  if (!beak) throw new Error(`unknown beak ${beakKind}`);
  if (Boolean(g.side) !== ['short', 'dagger', 'needle', 'curve', 'upturn', 'spoon', 'sidehook', 'bill', 'sidecone', 'big', 'pouch'].includes(beakKind) && beakKind !== 'none') {
    throw new Error(`${spec.shape} cannot take a ${beakKind} beak`);
  }
  const late = [];
  for (const [kind, colour] of spec.marks || []) {
    const mark = MARKS[kind];
    if (!mark || BEHIND.has(kind)) throw new Error(`unknown mark ${kind}`);
    const layer = mark(g, colour);
    // Small marks that sit on the beak or below it come after the beak.
    (['wattle', 'casque'].includes(kind) ? late : layers).push(layer);
  }
  layers.push(...beak(g, spec.beak?.[1] || DARK, spec.beak?.[2]));
  layers.push(...late);

  // The eyes (see the rule at the top of this file).
  const covering = layers.filter(layer => layer.covers);
  const top = covering[covering.length - 1];
  if (isPale(top.fill) || isInk(top.fill)) {
    // Pale face: dark eyes. Near-black face: cream eyes, which look the same
    // as a hole on a light tile and do not vanish on a dark one.
    top.eyes = true;
    layers.splice(layers.indexOf(top), 0, { fill: isPale(top.fill) ? DARK : CREAM, d: '', eyes: true });
  } else {
    for (const layer of covering) layer.eyes = true;
  }
  return {
    eyes: g.ex.map(x => [x, g.ey]),
    ...(spec.eye ? { eye: spec.eye } : {}),
    layers: layers.map(({ covers, ...layer }) => layer),
  };
}
