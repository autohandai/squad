// Blob avatars for the Grut skin (ADR-0058): a shape, a face, and a colour.
//
// These are drawn rather than downloaded. A blob is three choices and nothing
// else, so an SVG is a couple of hundred bytes, stays crisp from a 16px list
// row to a 96px profile header, and can be recoloured without touching a file.
// Every member gets the same blob every time: the choice is hashed from the
// member's id, so it survives a reload, a rename and a reinstall.

export const BLOB_SHAPES = ["circle", "pebble", "squircle", "capsule", "triangle", "hexagon", "cloud", "droplet"];

export const BLOB_EXPRESSIONS = [
  "neutral",
  "attentive",
  "surprised",
  "excited",
  "happy",
  "laughing",
  "angry",
  "sad",
  "scared",
  "suspicious",
  "confused",
  "curious",
  "proud",
  "shy",
  "unimpressed",
  "sleepy",
];

export const BLOB_COLOURS = [
  "#4d8df0",
  "#5bc4a4",
  "#f0a23c",
  "#a97bf0",
  "#ef6a8c",
  "#e5544b",
  "#8c6f4e",
  "#7f8896",
  "#3fb6c8",
  "#c9a227",
  "#6fbf5f",
  "#e8763c",
];

/**
 * A stable 32-bit hash with a final avalanche. Same member, same blob, forever.
 *
 * The avalanche is not decoration. Squad ids share a long prefix
 * ("asq_noah_frontend", "asq_kai_devops"), and plain FNV leaves that similarity
 * in the low bits: taking `hash % 8` for the shape gave every seeded member a
 * triangle. Mixing the whole word before it is sliced is what makes three
 * independent choices out of one seed.
 */
function hash(seed, salt) {
  let value = 2166136261 ^ salt;
  const text = String(seed || "");
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  value ^= value >>> 16;
  value = Math.imul(value, 2246822507);
  value ^= value >>> 13;
  value = Math.imul(value, 3266489909);
  value ^= value >>> 16;
  return value >>> 0;
}

/** The blob a member gets, derived from its id alone. */
export function blobFor(seed) {
  return {
    shape: BLOB_SHAPES[hash(seed, 0x9e3779b1) % BLOB_SHAPES.length],
    expression: BLOB_EXPRESSIONS[hash(seed, 0x85ebca6b) % BLOB_EXPRESSIONS.length],
    colour: BLOB_COLOURS[hash(seed, 0xc2b2ae35) % BLOB_COLOURS.length],
  };
}

// --- the body -------------------------------------------------------------
// Every shape is drawn inside a 100x100 box so the faces below can assume one
// coordinate space.

const BODIES = {
  circle: 'M50 8a42 42 0 1 1 0 84a42 42 0 1 1 0-84z',
  pebble: 'M50 8c22 0 42 16 42 38 0 24-18 46-42 46S8 70 8 46C8 24 28 8 50 8z',
  squircle: 'M50 8c30 0 42 12 42 42s-12 42-42 42S8 80 8 50 20 8 50 8z',
  capsule: 'M44 20h12a30 30 0 0 1 0 60H44a30 30 0 0 1 0-60z',
  triangle: 'M50 10c4 0 7 2 9 6l32 58c4 8 0 16-9 16H18c-9 0-13-8-9-16l32-58c2-4 5-6 9-6z',
  hexagon: 'M50 8l34 20v44L50 92 16 72V28z',
  cloud: 'M32 78a22 22 0 0 1-2-44 24 24 0 0 1 45-6 20 20 0 0 1 3 40z',
  droplet: 'M50 8c14 20 34 34 34 52a34 34 0 0 1-68 0c0-18 20-32 34-52z',
};

// --- the face -------------------------------------------------------------
// Eyes are cut out of the body, so they take the page background rather than a
// fill: a blob is one colour with holes in it, which is what makes the set read
// as one family. `rx`/`ry` size the eyes, `y` raises or lowers them, `tilt`
// offsets one against the other and `rotate` slants them: that is the whole
// emotional range, and it is enough.

function eyes({ rx = 5, ry = 9, y = 46, dx = 13, tilt = 0, rotate = 0 }) {
  return ellipse(50 - dx, y + tilt, rx, ry, -rotate) + ellipse(50 + dx, y - tilt, rx, ry, rotate);
}

// Even-odd fill applies within one path, not between sibling SVG elements.
// Keep each rotated eye as a subpath of the body so its centre is transparent.
function ellipse(cx, cy, rx, ry, degrees) {
  const angle = degrees * Math.PI / 180;
  const round = value => Math.round(value * 100) / 100;
  const x = round(rx * Math.cos(angle));
  const y = round(rx * Math.sin(angle));
  const arc = `A${rx} ${ry} ${degrees} 1 0`;
  return `M${round(cx + x)} ${round(cy + y)}${arc} ${round(cx - x)} ${round(cy - y)}${arc} ${round(cx + x)} ${round(cy + y)}z`;
}

const FACES = {
  neutral: () => eyes({}),
  attentive: () => eyes({ rx: 6, ry: 10 }),
  surprised: () => eyes({ rx: 8, ry: 8 }),
  excited: () => eyes({ rx: 7, ry: 12 }),
  happy: () => eyes({ rx: 6, ry: 6, y: 44 }),
  laughing: () => eyes({ rx: 7, ry: 3, y: 44 }),
  angry: () => eyes({ rx: 5, ry: 8, rotate: 22 }),
  sad: () => eyes({ rx: 5, ry: 8, rotate: -20 }),
  scared: () => eyes({ rx: 9, ry: 11 }),
  suspicious: () => eyes({ rx: 6, ry: 3, y: 48 }),
  confused: () => eyes({ rx: 5, ry: 9, tilt: 5 }),
  curious: () => eyes({ rx: 5, ry: 10, tilt: -4, dx: 14 }),
  proud: () => eyes({ rx: 5, ry: 5, y: 42 }),
  shy: () => eyes({ rx: 4, ry: 6, y: 50, dx: 11 }),
  unimpressed: () => eyes({ rx: 6, ry: 2.5, y: 46 }),
  sleepy: () => eyes({ rx: 6, ry: 1.8, y: 50 }),
};

/**
 * The blob as SVG markup. The eyes are punched out with `fill-rule: evenodd`,
 * so whatever is behind the avatar shows through them.
 */
export function blobSvg({ shape = "circle", expression = "neutral", colour = BLOB_COLOURS[0], title = "" } = {}) {
  const body = BODIES[shape] || BODIES.circle;
  const face = (FACES[expression] || FACES.neutral)();
  const label = title ? `<title>${escapeXml(title)}</title>` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="size-full" viewBox="0 0 100 100" role="img"${title ? "" : ' aria-hidden="true"'}>` +
    label +
    `<path fill="${colour}" fill-rule="evenodd" d="${body}${face}"/>` +
    `</svg>`
  );
}

function escapeXml(value) {
  return String(value).replace(/[<>&"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

/** The same blob as a data URI, for anything that wants an image `src`. */
export function blobDataUri(options) {
  return `data:image/svg+xml,${encodeURIComponent(blobSvg(options))}`;
}

/** Everything needed to draw a member's blob, from the member alone. */
export function blobForMember(member) {
  const seed = member?.id || member?.name || "squad";
  const blob = blobFor(seed);
  return { ...blob, title: member?.name || "" };
}
