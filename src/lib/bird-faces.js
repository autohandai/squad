// Shapeless bird faces (ADR-0235): the Grut skin's cast. Each bird is one soft
// silhouette in its own colour, two short eye marks, and at most two touches
// that say which bird it is (the kiwi's long beak, the tūī's white tuft).
//
// Drawn, not downloaded, for the same reasons as the blobs before them
// (ADR-0058): a face is under a kilobyte, crisp from a 16px row to a 96px
// header, and recolourable without a file. The eyes are holes, as with blobs,
// so the page shows through them in light and dark alike.
//
// Coordinates are a 100x100 box. A layer marked `eyes` must contain both eye
// marks entirely: the marks are even-odd subpaths of that layer, and a subpath
// outside its layer would fill instead of cut.

const ink = { cream: '#f4f1e8' };

const FACES = {
  kiwi: {
    eyes: [[40, 41], [55, 41]], eye: [2.4, 4.6],
    layers: [
      { fill: '#8b6a4a', eyes: true, d: 'M46 14c18 0 32 14 34 32 2 20-10 44-34 44S10 72 12 52C14 30 28 14 46 14z' },
      { stroke: '#d6bd8c', width: 3.6, d: 'M66 50c10 4 20 15 26 31' },
    ],
  },
  tui: {
    eyes: [[42, 42], [58, 42]],
    layers: [
      { fill: '#2b3c5e', eyes: true, d: 'M50 10c20 0 36 16 36 38 0 24-16 42-36 42S14 72 14 48C14 26 30 10 50 10z' },
      { stroke: '#4fa3a0', width: 3, d: 'M25 38c3-10 11-17 21-19' },
      { fill: ink.cream, d: 'M46.5 66a3.6 3.6 0 1 1 0 7.2a3.6 3.6 0 1 1 0-7.2zM53.5 66a3.6 3.6 0 1 1 0 7.2a3.6 3.6 0 1 1 0-7.2z' },
    ],
  },
  kea: {
    eyes: [[40, 38], [57, 38]],
    layers: [
      { fill: '#6b7a3a', eyes: true, d: 'M50 8c16 0 30 12 32 30 2 22-8 42-32 52C26 80 16 60 18 38 20 20 34 8 50 8z' },
      { fill: '#4b4f55', d: 'M49 47h9c6 0 9 4 9 9 0 5-3 9-7 11 1-4 0-8-4-9h-7z' },
      { fill: '#ec6b2d', d: 'M19 44c1 17 9 30 22 41-15-3-24-18-22-41z' },
    ],
  },
  kereru: {
    eyes: [[40, 41], [60, 41]],
    layers: [
      { fill: '#3e7b5c', eyes: true, d: 'M50 12c24 0 40 16 40 38 0 24-18 40-40 40S10 74 10 50c0-22 16-38 40-38z' },
      { fill: ink.cream, d: 'M17 64c6-5 19-7 33-7s27 2 33 7c-4 15-17 26-33 26S21 79 17 64z' },
      { fill: '#d8443a', d: 'M46 51h8l-4 6.5z' },
    ],
  },
  pukeko: {
    eyes: [[37, 40], [63, 40]],
    layers: [
      { fill: '#3a4fae', eyes: true, d: 'M50 12c15 0 27 10 27 26v26c0 16-12 26-27 26S23 80 23 64V38c0-16 12-26 27-26z' },
      { fill: '#e2392d', d: 'M45 9c3-2 7-2 10 0l2 19c0 7-3 14-7 21-4-7-7-14-7-21z' },
    ],
  },
  ruru: {
    eyes: [[37, 47], [63, 47]], eye: [2.6, 5.4],
    layers: [
      { fill: '#6a4a34', eyes: true, d: 'M14 30c0-12 6-18 14-14 6 3 14 4 22 4s16-1 22-4c8-4 14 2 14 14v26c0 22-16 36-36 36S14 78 14 56z' },
      { fill: '#ecc04a', eyes: true, d: 'M37 36a11 11 0 1 1 0 22a11 11 0 1 1 0-22zM63 36a11 11 0 1 1 0 22a11 11 0 1 1 0-22z' },
      { fill: '#3a2a1f', d: 'M46.5 58h7L50 64.5z' },
      { fill: '#e6d3b0', d: 'M40 72a1.8 1.8 0 1 1 0 3.6a1.8 1.8 0 1 1 0-3.6zM50 76a1.8 1.8 0 1 1 0 3.6a1.8 1.8 0 1 1 0-3.6zM60 72a1.8 1.8 0 1 1 0 3.6a1.8 1.8 0 1 1 0-3.6zM45 83a1.8 1.8 0 1 1 0 3.6a1.8 1.8 0 1 1 0-3.6zM55 83a1.8 1.8 0 1 1 0 3.6a1.8 1.8 0 1 1 0-3.6z' },
    ],
  },
  fantail: {
    eyes: [[36, 55], [54, 55]], eye: [2.3, 4.4],
    layers: [
      { fill: '#4a3f37', stroke: ink.cream, width: 2, d: 'M56 52L64 8c12 0 22 6 28 16z' },
      { fill: '#786656', eyes: true, d: 'M45 30c16 0 28 12 28 28s-12 30-28 30S17 74 17 58s12-28 28-28z' },
      { fill: '#e3a868', d: 'M23 72c6 10 13 16 22 16s16-6 22-16c-6 3-14 5-22 5s-16-2-22-5z' },
      { stroke: ink.cream, width: 2.6, d: 'M31 46l8-2.5M50 43.5l8 2.5' },
    ],
  },
  takahe: {
    eyes: [[34, 42], [66, 42]],
    layers: [
      { fill: '#2d4796', eyes: true, d: 'M50 14c24 0 40 18 40 40 0 22-18 36-40 36S10 76 10 54c0-22 16-40 40-40z' },
      { fill: '#2f8c84', d: 'M12 64c5 13 15 22 28 25-10-6-17-15-19-26z' },
      { fill: '#e4472c', d: 'M46 16c0-2.5 8-2.5 8 0v21c5 2 8 6 8 11L50 70 38 48c0-5 3-9 8-11z' },
    ],
  },
  kakapo: {
    eyes: [[41, 46], [59, 46]],
    layers: [
      { fill: '#6f9a3b', eyes: true, d: 'M26 28c5-12 19-18 31-15 14-1 27 11 27 26 6 9 6 22-2 32-8 12-21 19-35 19S16 84 12 70c-6-13-1-29 14-42z' },
      { fill: '#ddd69e', eyes: true, d: 'M50 31c14 0 23 8 23 17s-10 16-23 16-23-6-23-16 9-17 23-17z' },
      { fill: '#8f8562', d: 'M46 53c0-3 8-3 8 0l-4 8z' },
    ],
  },
  kotare: {
    eyes: [[42, 39], [58, 39]],
    layers: [
      { fill: '#ecc999', eyes: true, d: 'M52 16c18 0 32 14 32 34 0 22-14 40-34 40S18 76 18 54c0-22 14-38 34-38z' },
      { fill: '#2a8fb4', eyes: true, d: 'M18 54c0-22 14-38 34-38 18 0 32 14 32 34-10-4-22-6-34-6-12 0-22 4-32 10z' },
      { fill: '#1f2328', d: 'M30 45L3 49.5 30 53z' },
    ],
  },
  // Brazil (ADR-0241). Where a face is pale, a darker layer sits under it so
  // the eye holes show that colour rather than the tile.
  tucano: {
    eyes: [[34, 40], [50, 40]],
    layers: [
      { fill: '#1f2024', eyes: true, d: 'M44 12c20 0 34 16 34 38s-14 40-34 40S10 72 10 50 24 12 44 12z' },
      { fill: '#f6e3a8', d: 'M16 62c6 6 16 10 28 10s22-4 28-10c-4 16-14 26-28 26S20 78 16 62z' },
      { fill: '#f08a24', d: 'M50 46c14-10 32-12 46-6-4 10-18 18-46 16z' },
      { fill: '#1f2024', d: 'M90 37c3 1 5 2 6 3-1 3-3 5-6 7z' },
    ],
  },
  araraazul: {
    eyes: [[36, 40], [64, 40]],
    layers: [
      { fill: '#2b4aa8', eyes: true, d: 'M50 10c20 0 34 16 34 38 0 24-14 42-34 42S16 72 16 48c0-22 14-38 34-38z' },
      { fill: '#f3c623', eyes: true, d: 'M36 32a8 8 0 1 1 0 16a8 8 0 1 1 0-16zM64 32a8 8 0 1 1 0 16a8 8 0 1 1 0-16z' },
      { fill: '#363a42', d: 'M42 50h14c7 0 11 5 11 11 0 7-5 12-11 14 1-5-1-10-6-11h-8z' },
      { stroke: '#f3c623', width: 3, d: 'M42 66c3 3 7 4 11 3' },
    ],
  },
  bemtevi: {
    eyes: [[38, 45], [62, 45]],
    layers: [
      { fill: '#7b5c3e', eyes: true, d: 'M50 12c22 0 38 16 38 38s-16 40-38 40S12 72 12 50 28 12 50 12z' },
      { fill: '#222326', d: 'M14 40c2-16 16-28 36-28s34 12 36 28c-10-5-22-7-36-7s-26 2-36 7z' },
      { stroke: '#f4f1e8', width: 4, d: 'M17 38c10-5 22-7 33-7s23 2 33 7' },
      { fill: '#f2c516', d: 'M14 60c10-4 22-6 36-6s26 2 36 6c-4 18-18 30-36 30S18 78 14 60z' },
      { fill: '#2a2a2a', d: 'M45 51h10l-5 6z' },
    ],
  },
  sabia: {
    eyes: [[38, 42], [62, 42]],
    layers: [
      { fill: '#8a7a64', eyes: true, d: 'M50 12c21 0 36 16 36 37 0 23-15 41-36 41S14 72 14 49c0-21 15-37 36-37z' },
      { fill: '#d9772f', d: 'M17 62c9-4 20-6 33-6s24 2 33 6c-4 16-17 28-33 28S21 78 17 62z' },
      { stroke: '#e8c34a', width: 2.2, d: 'M31.5 42a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0-13 0zM55.5 42a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0-13 0z' },
      { fill: '#c9a640', d: 'M46 50h8l-4 6z' },
    ],
  },
  beijaflor: {
    eyes: [[34, 44], [50, 44]],
    layers: [
      { fill: '#2e9e6b', eyes: true, d: 'M42 18c17 0 30 14 30 32s-13 36-30 36S12 70 12 50s13-32 30-32z' },
      { fill: '#c2385a', d: 'M30 62c4 4 8 5 12 5s8-1 12-5c-1 8-6 13-12 13s-11-5-12-13z' },
      { stroke: '#232528', width: 2.6, d: 'M58 50L96 56' },
    ],
  },
  queroquero: {
    eyes: [[38, 44], [62, 44]],
    layers: [
      { fill: '#9aa1a8', eyes: true, d: 'M50 16c21 0 36 15 36 36 0 22-15 38-36 38S14 74 14 52c0-21 15-36 36-36z' },
      { stroke: '#2a2c30', width: 3, d: 'M46 18c-6-8-16-12-28-10' },
      { fill: '#2a2c30', d: 'M44 50h12v4c0 6-3 10-6 12-3-2-6-6-6-12z' },
      { fill: '#26282b', d: 'M16 66c10 5 22 7 34 7s24-2 34-7c-5 14-18 24-34 24S21 80 16 66z' },
      { fill: '#e5737a', d: 'M46 50h8l-4 4z' },
    ],
  },
  harpia: {
    eyes: [[37, 46], [63, 46]],
    layers: [
      { fill: '#3a3b40', d: 'M30 24L22 4l18 14zM70 24l8-20-18 14z' },
      { fill: '#9a9ba1', eyes: true, d: 'M50 16c22 0 38 14 38 34 0 22-16 40-38 40S12 72 12 50c0-20 16-34 38-34z' },
      { fill: '#2b2c30', d: 'M14 66c10 6 22 9 36 9s26-3 36-9c-5 14-19 24-36 24S19 80 14 66z' },
      { fill: '#26272b', d: 'M44 50h12c4 0 7 4 7 8 0 5-4 9-8 10 1-4-1-7-4-8h-7z' },
    ],
  },
  joaodebarro: {
    eyes: [[38, 43], [62, 43]],
    layers: [
      { fill: '#b5673a', eyes: true, d: 'M50 14c21 0 36 16 36 36 0 22-15 40-36 40S14 72 14 50c0-20 15-36 36-36z' },
      { fill: '#ecd0a6', d: 'M24 62c7 4 16 6 26 6s19-2 26-6c-3 16-14 26-26 26S27 78 24 62z' },
      { fill: '#5a3b26', d: 'M45 50h10l-5 7z' },
    ],
  },
  // United States (ADR-0241).
  baldeagle: {
    eyes: [[38, 40], [62, 40]],
    layers: [
      { fill: '#5a3a24', d: 'M50 12c22 0 38 16 38 38s-16 40-38 40S12 72 12 50 28 12 50 12z' },
      { fill: '#f4f1e8', eyes: true, d: 'M14 46c0-20 16-34 36-34s36 14 36 34c0 8-2 14-6 18-8-4-18-6-30-6s-22 2-30 6c-4-4-6-10-6-18z' },
      { fill: '#f2b31c', d: 'M42 46h16c6 0 10 5 10 11 0 7-5 12-11 14 1-5-1-9-6-10h-9z' },
    ],
  },
  cardinal: {
    eyes: [[38, 46], [62, 46]],
    layers: [
      { fill: '#c8262c', eyes: true, d: 'M50 4l14 20c14 6 22 18 22 32 0 20-16 34-36 34S14 76 14 56c0-14 8-26 22-32z' },
      { fill: '#1d1d20', d: 'M40 52c3-4 7-6 10-6s7 2 10 6v8c-3 4-6 6-10 6s-7-2-10-6z' },
      { fill: '#f08a24', d: 'M45 51h10l-5 9z' },
    ],
  },
  bluejay: {
    eyes: [[38, 42], [62, 42]],
    layers: [
      { fill: '#3d78c6', eyes: true, d: 'M40 22L44 4l12 16c18 4 30 18 30 34 0 20-16 36-36 36S14 74 14 54c0-16 10-28 26-32z' },
      { fill: '#eef1f4', d: 'M20 56c8-4 18-6 30-6s22 2 30 6c-2 18-14 30-30 30S22 74 20 56z' },
      { stroke: '#1d1f24', width: 2.4, d: 'M24 70c8 2 17 3 26 3s18-1 26-3' },
      { fill: '#1d1f24', d: 'M45 48h10l-5 6z' },
    ],
  },
  robin: {
    eyes: [[38, 40], [62, 40]],
    layers: [
      { fill: '#4d4844', eyes: true, d: 'M50 14c21 0 36 15 36 36 0 22-15 40-36 40S14 72 14 50c0-21 15-36 36-36z' },
      { fill: '#d9622b', d: 'M16 58c9-5 21-8 34-8s25 3 34 8c-3 18-16 32-34 32S19 76 16 58z' },
      { stroke: '#f4f1e8', width: 1.8, d: 'M33 34.5a5.5 5.5 0 0 1 10 0M57 34.5a5.5 5.5 0 0 1 10 0' },
      { fill: '#f2b31c', d: 'M45 46h10l-5 6z' },
    ],
  },
  roadrunner: {
    eyes: [[34, 44], [50, 44]],
    layers: [
      { fill: '#3b3530', d: 'M24 26L10 6l22 10zM34 18L32 2l12 14z' },
      { fill: '#8a6b4a', eyes: true, d: 'M42 14c20 0 34 16 34 36s-14 40-34 40S8 70 8 50s14-36 34-36z' },
      { stroke: '#f4f1e8', width: 1.8, d: 'M22 64l4 4M32 70l4 4M44 72l3 5M18 54l4 3' },
      { stroke: '#4aa3d8', width: 3, d: 'M54 41c3-1 6-1 9 1' },
      { fill: '#2a2624', d: 'M56 48L96 52 56 56z' },
    ],
  },
  puffin: {
    eyes: [[38, 40], [60, 40]],
    layers: [
      { fill: '#1f2024', d: 'M50 10c22 0 38 18 38 40s-16 40-38 40S12 72 12 50 28 10 50 10z' },
      { fill: '#eef0f2', eyes: true, d: 'M22 42c0-14 12-22 28-22s28 8 28 22c0 14-12 24-28 24S22 56 22 42z' },
      { fill: '#3e4a5a', d: 'M43 46h14v6H43z' },
      { fill: '#f07a1e', d: 'M43 52h14c4 6 4 14-7 22-11-8-11-16-7-22z' },
    ],
  },
  flamingo: {
    eyes: [[38, 40], [60, 40]],
    layers: [
      { fill: '#f08aa6', eyes: true, d: 'M50 14c21 0 36 15 36 36 0 22-15 40-36 40S14 72 14 50c0-21 15-36 36-36z' },
      { fill: '#f7ece6', d: 'M44 46c8-3 18-2 22 4 3 4 3 9 1 14l-7-1c1-4 0-7-3-9-3-2-7-3-13-3z' },
      { fill: '#1f2024', d: 'M67 64c-1 4-3 7-6 9-1-3-1-7 0-10z' },
    ],
  },
  chickadee: {
    eyes: [[38, 35], [62, 35]], eye: [2.4, 4.4],
    layers: [
      { fill: '#9aa0a6', d: 'M50 14c21 0 36 15 36 36 0 22-15 40-36 40S14 72 14 50c0-21 15-36 36-36z' },
      { fill: '#1d1e21', eyes: true, d: 'M14 46c0-18 16-32 36-32s36 14 36 32c-10-3-22-4-36-4s-26 1-36 4z' },
      { fill: '#f4f1e8', d: 'M14 50c10-3 22-4 36-4s26 1 36 4c-2 10-8 18-16 22-6-4-13-6-20-6s-14 2-20 6c-8-4-14-12-16-22z' },
      { fill: '#1d1e21', d: 'M42 60c2-4 5-6 8-6s6 2 8 6c-1 6-4 10-8 10s-7-4-8-10z' },
      { fill: '#2a2a2a', d: 'M46 47h8l-4 5z' },
    ],
  },
};

export const BIRD_FACE_IDS = Object.keys(FACES);

const round = value => Math.round(value * 100) / 100;

// A short upright mark: an ellipse as two arcs.
function mark([cx, cy], [rx, ry]) {
  return `M${round(cx - rx)} ${cy}a${rx} ${ry} 0 1 0 ${round(rx * 2)} 0a${rx} ${ry} 0 1 0 ${round(-rx * 2)} 0z`;
}

function escapeXml(value) {
  return String(value).replace(/[<>&"']/g, character => `&#${character.charCodeAt(0)};`);
}

// Avatar styles (ADR-0242): the same face, drawn flat (the default), as a soft
// glossy 3D toy, or as matte clay. Both are SVG lighting filters over the flat
// face, so a style never changes which bird or which face, only the material,
// and needs no image file. The eye holes become shallow pits under the light.
export const AVATAR_STYLES = [
  { id: 'flat', label: 'Flat', description: 'Drawn cartoon faces. The default.' },
  { id: '3d', label: '3D', description: 'The same faces as soft, glossy toys.' },
  { id: 'clay', label: 'Clay', description: 'The same faces in handmade matte clay.' },
];
export const DEFAULT_AVATAR_STYLE = 'flat';
export function isAvatarStyle(value) { return AVATAR_STYLES.some(style => style.id === value); }

const SHADOW = (blur, dy, alpha) => `<feGaussianBlur in="SourceAlpha" stdDeviation="${blur}" result="sh"/><feOffset dy="${dy}" in="sh" result="sho"/><feComponentTransfer in="sho" result="shadow"><feFuncA type="linear" slope="${alpha}"/></feComponentTransfer>`;
const FILTERS = {
  '3d': `<filter id="squad-bird-3d" x="-15%" y="-15%" width="130%" height="135%" color-interpolation-filters="sRGB">` +
    `<feGaussianBlur in="SourceAlpha" stdDeviation="3.2" result="blur"/>` +
    `<feSpecularLighting in="blur" surfaceScale="5" specularConstant="0.7" specularExponent="22" lighting-color="#fff" result="spec"><fePointLight x="28" y="10" z="70"/></feSpecularLighting>` +
    `<feComposite in="spec" in2="SourceAlpha" operator="in" result="specIn"/>` +
    `<feDiffuseLighting in="blur" surfaceScale="4" diffuseConstant="1" lighting-color="#fff" result="diff"><feDistantLight azimuth="235" elevation="55"/></feDiffuseLighting>` +
    `<feComposite in="SourceGraphic" in2="diff" operator="arithmetic" k1="1.06" k2="0" k3="0" k4="0" result="lit"/>` +
    `<feComposite in="lit" in2="SourceAlpha" operator="in" result="litIn"/>` +
    `<feComposite in="specIn" in2="litIn" operator="arithmetic" k1="0" k2="0.5" k3="1" k4="0" result="shaded"/>` +
    SHADOW(2.4, 2.6, 0.35) + `<feMerge><feMergeNode in="shadow"/><feMergeNode in="shaded"/></feMerge></filter>`,
  clay: `<filter id="squad-bird-clay" x="-15%" y="-15%" width="130%" height="135%" color-interpolation-filters="sRGB">` +
    `<feTurbulence type="fractalNoise" baseFrequency="0.07" numOctaves="3" seed="7" result="noise"/>` +
    `<feDisplacementMap in="SourceGraphic" in2="noise" scale="1.2" xChannelSelector="R" yChannelSelector="G" result="wob"/>` +
    `<feGaussianBlur in="SourceAlpha" stdDeviation="2.4" result="blur"/>` +
    `<feComposite in="blur" in2="noise" operator="arithmetic" k1="0" k2="1" k3="0.3" k4="0" result="bump"/>` +
    `<feDiffuseLighting in="bump" surfaceScale="3.4" diffuseConstant="1.04" lighting-color="#fff" result="diff"><feDistantLight azimuth="235" elevation="48"/></feDiffuseLighting>` +
    `<feComposite in="wob" in2="diff" operator="arithmetic" k1="1.08" k2="0" k3="0" k4="0" result="lit"/>` +
    `<feComposite in="lit" in2="SourceAlpha" operator="in" result="litIn"/>` +
    SHADOW(1.6, 1.8, 0.3) + `<feMerge><feMergeNode in="shadow"/><feMergeNode in="litIn"/></feMerge></filter>`,
};

/** The bird's face as SVG markup; an unknown bird draws the kiwi. */
export function birdFaceSvg(bird, { title = '', style = DEFAULT_AVATAR_STYLE } = {}) {
  const face = FACES[bird] || FACES.kiwi;
  const eyes = face.eyes.map(point => mark(point, face.eye || [2.6, 5])).join('');
  const label = title ? `<title>${escapeXml(title)}</title>` : '';
  const paths = face.layers.map(layer => {
    const d = layer.eyes ? layer.d + eyes : layer.d;
    const fill = layer.fill ? `fill="${layer.fill}"${layer.eyes ? ' fill-rule="evenodd"' : ''}` : 'fill="none"';
    const stroke = layer.stroke ? ` stroke="${layer.stroke}" stroke-width="${layer.width}" stroke-linecap="round" stroke-linejoin="round"` : '';
    return `<path ${fill}${stroke} d="${d}"/>`;
  }).join('');
  const filter = FILTERS[style];
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="size-full" viewBox="0 0 100 100" role="img"${title ? '' : ' aria-hidden="true"'}>` +
    label + (filter ? `<defs>${filter}</defs><g filter="url(#squad-bird-${style})">${paths}</g>` : paths) + `</svg>`
  );
}
