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

/** The bird's face as SVG markup; an unknown bird draws the kiwi. */
export function birdFaceSvg(bird, { title = '' } = {}) {
  const face = FACES[bird] || FACES.kiwi;
  const eyes = face.eyes.map(point => mark(point, face.eye || [2.6, 5])).join('');
  const label = title ? `<title>${escapeXml(title)}</title>` : '';
  const paths = face.layers.map(layer => {
    const d = layer.eyes ? layer.d + eyes : layer.d;
    const fill = layer.fill ? `fill="${layer.fill}"${layer.eyes ? ' fill-rule="evenodd"' : ''}` : 'fill="none"';
    const stroke = layer.stroke ? ` stroke="${layer.stroke}" stroke-width="${layer.width}" stroke-linecap="round" stroke-linejoin="round"` : '';
    return `<path ${fill}${stroke} d="${d}"/>`;
  }).join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="size-full" viewBox="0 0 100 100" role="img"${title ? '' : ' aria-hidden="true"'}>` +
    label + paths + `</svg>`
  );
}
