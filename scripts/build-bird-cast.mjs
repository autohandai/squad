#!/usr/bin/env node
// The bird cast's raster pipeline (ADR-0235, ADR-0271).
//
//   node scripts/build-bird-cast.mjs prompt <flat|3d|clay> <bird>     print the prompt
//   node scripts/build-bird-cast.mjs generate <flat|3d|clay> [bird…]  masters via gpt-image-bridge
//   node scripts/build-bird-cast.mjs install <flat|3d|clay>           masters -> served WebP
//   node scripts/build-bird-cast.mjs faces [--all]                    drawn faces -> /avatars/birds WebP (missing ones; --all redraws every file)
//
// Masters are 1024px PNGs in assets/characters/<style>/<bird>.png, kept on the
// machine and git-ignored (124 MB for three styles). `install` writes 512px and
// 256px WebP and lists the installed birds in INSTALLED_ART (src/lib/bird-cast.js):
//   flat  public/avatars/birds/  (replaces the drawn faces at the URLs members
//         already store) plus a vtracer SVG in public/avatars/birds-svg/
//   3d    public/avatars/birds-3d/
//   clay  public/avatars/clay/
// A bird without an installed picture keeps its drawn face and style filter.
//
// Look at every master before installing. Regenerate any that are off-model,
// have text or a watermark, extra limbs or features, or drift from the set.

import { COMPOSED_BIRDS } from '../src/lib/bird-species.js';
const COMPOSED_BY_ID = new Map(COMPOSED_BIRDS.map(bird => [bird.id, bird]));
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BIRD_IDS, INSTALLED_ART } from '../src/lib/bird-cast.js';
import { birdFaceSvg } from '../src/lib/bird-faces.js';
import { tmpdir } from 'node:os';

const ROOT = new URL('..', import.meta.url).pathname;
const BRIDGE = join(homedir(), '.claude/skills/gpt-image-bridge/bin/gpt-image-2');
const STYLES = ['flat', '3d', 'clay'];
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const SPECIES = {
  kiwi: 'a North Island brown kiwi: round body of shaggy warm-brown hair-like feathers, very long thin slightly curved pale ivory beak with tiny whiskers at its base, small dark eyes',
  tui: 'a tūī: glossy iridescent blue-green-black plumage with a fine lacy white collar, and two distinctive small round white feather tufts at the throat, short dark curved beak',
  kea: 'a kea mountain parrot: olive-green scalloped feathers, strong long hooked grey beak, and a flash of bright orange-red under-wing feathers just visible at the shoulder',
  kereru: 'a kererū wood pigeon: iridescent green-bronze head and neck, a crisp clean white chest bib, small red beak and red eye-ring',
  pukeko: 'a pūkeko swamphen: deep violet-blue plumage, a bright red beak joined to a red forehead shield, alert stance',
  ruru: 'a ruru morepork owl: soft speckled chocolate-brown feathers with pale cream spots, large round yellow-gold eyes with a pale facial disc around them, small hooked beak',
  fantail: 'a pīwakawaka fantail: small cheeky bird with grey-brown head, a crisp white eyebrow stripe, white throat band, warm buff-orange chest, with the top of its fanned white-edged tail just peeking up behind one shoulder',
  takahe: 'a takahē: plump bird with rich indigo-blue head and neck shading to teal-green on the shoulders, a big heavy bright red-orange beak and red forehead shield',
  kakapo: 'a kākāpō night parrot: plump moss-green and yellow mottled feathers, a pale owl-like whiskered facial disc, and a large ivory-grey beak, gentle expression',
  kotare: 'a kōtare sacred kingfisher: turquoise-blue cap and back, a cream-buff collar and chest, a dark eye stripe, and a long straight black dagger beak',

  // Brazil
  tucano: 'a toco toucan: glossy black plumage, a white throat and bib, a bright blue eye-ring, and an enormous orange bill with a black tip',
  araraazul: 'a hyacinth macaw: deep cobalt-blue plumage all over, a bright yellow ring around the eye and a yellow strip at the base of a large black hooked beak',
  bemtevi: 'a great kiskadee (bem-te-vi): bold black-and-white striped head with a hidden yellow crown streak, bright lemon-yellow chest, rufous-brown back, short black beak',
  sabia: 'a rufous-bellied thrush (sabiá-laranjeira): soft olive-grey head and back, a warm rufous-orange belly, pale streaked throat, yellow-olive beak',
  beijaflor: 'a hummingbird (beija-flor): tiny bird with shimmering emerald-green iridescent feathers, a glittering violet throat patch, and a long fine straight needle beak',
  queroquero: 'a southern lapwing (quero-quero): grey head with a black face patch and throat, a thin black crest at the back of the head, red eye, short red-based beak',
  harpia: 'a harpy eagle: pale grey head with a dramatic split double crest of dark feathers, a black band across the chest, white front, powerful hooked black beak, intense eyes',
  joaodebarro: 'a rufous hornero (joão-de-barro): plain warm rufous-brown bird with a paler throat, a soft cinnamon tail, small dark eye, slender slightly curved beak',
  // United States
  baldeagle: 'a bald eagle: pure white head feathers, dark brown shoulders, a strong hooked bright yellow beak and pale yellow eyes',
  cardinal: 'a northern cardinal: brilliant red plumage, a pointed red crest, a black face mask around a thick conical orange-red beak',
  bluejay: 'a blue jay: bright blue crest and back, white face and chest, a black necklace collar, black-barred blue wing feathers just visible, short black beak',
  robin: 'an American robin: grey-brown head and back, a warm brick-orange breast, white eye-ring broken into crescents, yellow beak',
  roadrunner: 'a greater roadrunner: shaggy brown-and-white streaked crest, a patch of blue and orange bare skin behind the eye, long straight dark beak',
  puffin: 'an Atlantic puffin: black cap and back, pale grey-white face, and a large triangular beak striped bright orange, grey-blue and yellow',
  flamingo: 'an American flamingo: soft coral-pink plumage, a long curved neck just visible, and a pale pink beak bent downward with a black tip',
  chickadee: 'a black-capped chickadee: tiny round bird with a black cap and black bib, bright white cheeks, soft grey back, buff sides, tiny black beak',
};

const FRAMING = 'Framing: head-and-shoulders bust only, NOT full body, character centred, facing three-quarters toward the camera, top of head about 10% below the top edge, shoulders cropped by the bottom edge, face in the centre of the frame so it survives a circular crop.';
const CLEAN = 'Absolutely no text, no letters, no logo, no watermark, no border, no frame. Naturally proportioned and believable for the species: no human features, no hands, no clothing, no accessories. An original character, not resembling any existing brand mascot.';

// The flat mascot set (ADR-0271), from the owner's brief of 23 Nov 2026: one
// visual family, layered flat-colour feather shapes, negative-space eyes,
// 6–12 shapes per bird, head and upper neck only.
const FLAT_SPECIES = {
  kiwi: 'Kiwi (New Zealand): warm chestnut-brown (#8B6A4A) with lighter and darker brown feather layers; a soft, rounded, slightly pear-shaped head; asymmetrical shaggy feather tufts around the crown and cheeks; small oval negative-space eyes; a long, slender, gently curved pale tan beak (#D6BD8C); feather details along the side of the face. Friendly and endearing, but unmistakably a kiwi.',
  tucano: 'Toucan (Tucano, Brazil): deep charcoal or midnight-blue head; a large cream facial patch; a dramatic oversized yellow-orange beak with a dark tip; a rounded, compact head silhouette; bold, clean colour divisions; simple expressive eyes.',
  beijaflor: 'Hummingbird (Beija-flor, Americas): sleek emerald-teal head; elegant tapered silhouette; a long, thin, pointed dark beak; a bright magenta or ruby throat patch; subtle layered green feather accents; compact and energetic.',
};
const FLAT_BRIEF = [
  'Premium minimalist geometric vector mascot illustration for an app avatar, part of a cohesive collection of original bird mascots from New Zealand, Brazil and the United States that all look designed by the same illustrator with one design system.',
  'Flat solid colours only; smooth, organic, rounded geometric shapes; a distinctive recognisable bird-head silhouette, slightly asymmetrical for personality; a soft, friendly, approachable expression.',
  'Exactly two simple vertical oval eyes with no pupils and no highlights, as negative-space cut-outs where possible. A rounded, carefully constructed beak. Subtle layered feather shapes in 2–3 harmonious shades of the main colour, with a few well-placed feather details.',
  'About 6–12 carefully composed shapes: richer than a blob, never a detailed illustration.',
  'No outlines, no strokes, no gradients, no shadows, no textures, no lighting effects, no 3D. No human features, clothing, accessories, arms or legs. No text, letters, watermark, border or decoration.',
  'Square 1:1. Head and upper neck only, no body, centred, with the face and identifying features inside the central 80% so they survive a circular avatar crop; nothing touches the edges; generous even space around the bird. Perfectly plain pure white (#FFFFFF) background.',
].join(' ');

export function promptFor(style, bird) {
  if (style === 'flat') {
    const composed = COMPOSED_BY_ID.get(bird);
    const fromSpec = composed ? `a ${composed.label}: use this real species' true colours (main colour around ${composed.spec.body}${composed.spec.beak ? `, beak ${composed.spec.beak[1]}` : ''}${(composed.spec.marks || []).map(([mark, colour]) => `, ${mark} ${colour}`).join('')}${composed.spec.crest ? `, ${composed.spec.crest[0]} ${composed.spec.crest[1]}` : ''}) and its most recognisable head shape, beak, crest and face markings` : '';
    const species = FLAT_SPECIES[bird] || (SPECIES[bird] ? `${SPECIES[bird]}. Keep the species' real colours and its most recognisable head features, simplified into the shared mascot language.` : fromSpec ? `${fromSpec}, simplified into the shared mascot language.` : '');
    if (!species) throw new Error(`unknown bird ${bird}`);
    return `${FLAT_BRIEF} The bird: ${species}`;
  }
  const species = SPECIES[bird];
  if (!species) throw new Error(`unknown bird ${bird}`);
  if (style === '3d') return [
    `Square character portrait for an app avatar. Original mascot character design: ${species}.`,
    'Rendered as a high-end soft toy-like 3D character (premium 3D app mascot quality, designer-vinyl feel): soft velvety flocked and fluffy feather material, big simple readable shapes, slightly oversized head, small friendly glossy eyes with a single catch-light, gentle closed-mouth expression.',
    FRAMING,
    'Lighting: soft large studio key light from upper left, gentle fill, subtle rim light, soft contact shadow.',
    'Background: perfectly plain seamless warm off-white studio backdrop (#EFEDE8), no vignette, no props.',
    CLEAN,
  ].join(' ');
  if (style === 'clay') return [
    `Square character portrait for an app avatar. Original claymation character: ${species}.`,
    'Made entirely of handmade plasticine / modelling clay, stop-motion puppet style: visible soft fingerprint and tool marks, matte clay surfaces, simple sculpted shapes, slightly oversized head, small shiny black bead eyes, charming and friendly.',
    FRAMING,
    'Background: a single flat solid matte paper backdrop in a muted colour that complements the bird, no gradient, no props. Soft diffused studio light, gentle shadow.',
    CLEAN,
  ].join(' ');
  throw new Error(`unknown style ${style}`);
}

const master = (style, bird) => join(ROOT, 'assets/characters', style, `${bird}.png`);
// Painted 3D art lives beside the drawn faces, never over them: /avatars/birds
// holds the flat faces the menu bar, the iPhone and Quick Chat read (ADR-0240).
const served = (style, bird, size) => join(ROOT, 'public/avatars', style === '3d' ? 'birds-3d' : style === 'clay' ? 'clay' : 'birds', size === 512 ? '' : String(size), `${bird}.webp`);

function generate(style, birds) {
  for (const bird of birds) {
    const out = master(style, bird);
    mkdirSync(join(out, '..'), { recursive: true });
    console.log(`generating ${style}/${bird}…`);
    execFileSync(BRIDGE, [promptFor(style, bird), out, '--size', '1024x1024'], { stdio: 'inherit' });
  }
}

function install(style) {
  let total = 0;
  const installed = [];
  for (const bird of BIRD_IDS) {
    const source = master(style, bird);
    if (!existsSync(source)) { console.log(`skip ${style}/${bird}: no master`); continue; }
    // The flat set (ADR-0271) is drawn on white: the white around the bird
    // becomes transparent (enclosed white, the eye cut-outs, stays), the bird
    // is trimmed and centred with even padding, and an SVG is traced for the
    // website. 3D and clay keep their painted backdrops.
    const prepared = style === 'flat' ? join(tmpdir(), `flat-${bird}-${process.pid}.png`) : source;
    if (style === 'flat') {
      execFileSync('magick', [source, '-alpha', 'set', '-bordercolor', 'white', '-border', '2', '-fill', 'none', '-fuzz', '10%', '-draw', 'color 0,0 floodfill', '-shave', '2x2', '-trim', '+repage', '-gravity', 'center', '-background', 'none', '-extent', '%[fx:max(w,h)*1.16]x%[fx:max(w,h)*1.16]', '-resize', '1024x1024', prepared]);
      const svg = join(ROOT, 'public/avatars/birds-svg', `${bird}.svg`);
      mkdirSync(join(svg, '..'), { recursive: true });
      execFileSync(process.env.VTRACER_PYTHON || 'python3', ['-c', `import vtracer,sys; vtracer.convert_image_to_svg_py(sys.argv[1], sys.argv[2], colormode='color', hierarchical='stacked', mode='spline', filter_speckle=6, color_precision=6, layer_difference=24, corner_threshold=60, length_threshold=4.0, splice_threshold=45, path_precision=2)`, prepared, svg]);
      total += statSync(svg).size;
    }
    for (const size of [512, 256]) {
      const target = served(style, bird, size);
      mkdirSync(join(target, '..'), { recursive: true });
      execFileSync('magick', style === 'flat'
        ? [prepared, '-resize', `${size}x${size}`, '-strip', '-quality', '86', target]
        : [source, '-gravity', 'center', '-extent', '%[fx:min(w,h)]x%[fx:min(w,h)]', '-resize', `${size}x${size}`, '-strip', '-quality', '82', target]);
      total += statSync(target).size;
    }
    installed.push(bird);
  }
  // The app shows a painted picture only for a bird listed here (ADR-0271).
  const file = join(ROOT, 'src/lib/bird-cast.js');
  const key = style === '3d' ? "'3d'" : style;
  const pattern = new RegExp(`${key.replace(/'/g, "'")}: \\[[^\\]]*\\]`);
  writeFileSync(file, readFileSync(file, 'utf8').replace(pattern, `${key}: [${installed.map(bird => `'${bird}'`).join(', ')}]`));
  console.log(`installed ${installed.length} ${style} birds, ${total} bytes of WebP`);
}

// The drawn faces as files (ADR-0240). The app draws each face inline, but the
// menu bar reads /avatars/birds/<bird>.webp from the bundle and the iPhone and
// Quick Chat fetch it, so the same face is rendered into those files: a
// transparent tile (eyes stay holes), the face inset 8% like the in-app tile.
// Chrome draws the SVG exactly as the app does; ImageMagick's renderer drops
// stroked paths (the kiwi's beak, the tūī's stripe). One browser renders the
// whole cast (ADR-0243: 300 birds); only missing files are rendered unless
// --all is passed, so files already shipped do not churn.
async function faces(all = false) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
  const work = join(tmpdir(), `bird-faces-${process.pid}`);
  mkdirSync(work, { recursive: true });
  let total = 0, rendered = 0;
  try {
    for (const bird of BIRD_IDS) {
      if (!all && [512, 256].every(size => existsSync(served('flat', bird, size)))) continue;
      // A painted flat bird (ADR-0271) owns its files; the drawn face is only the fallback.
      if (INSTALLED_ART.flat?.includes(bird)) continue;
      const png = join(work, `${bird}.png`);
      await page.setContent(`<html><body style="margin:0;background:transparent"><div style="width:1024px;height:1024px;padding:82px;box-sizing:border-box">${birdFaceSvg(bird).replace('class="size-full"', 'width="860" height="860"')}</div></body></html>`);
      await page.screenshot({ path: png, omitBackground: true, clip: { x: 0, y: 0, width: 1024, height: 1024 } });
      for (const size of [512, 256]) {
        const target = served('flat', bird, size);
        mkdirSync(join(target, '..'), { recursive: true });
        execFileSync('magick', [png, '-resize', `${size}x${size}`, '-strip', '-define', 'webp:lossless=true', target]);
        total += statSync(target).size;
      }
      rendered += 1;
    }
  } finally {
    await browser.close();
  }
  console.log(`rendered ${rendered} of ${BIRD_IDS.length} drawn faces, ${total} bytes of WebP`);
}

const [command, style, ...birds] = process.argv.slice(2);
if (command === 'faces') { await faces(style === '--all'); process.exit(0); }
if (!STYLES.includes(style)) { console.error('style must be flat, 3d or clay'); process.exit(1); }
if (command === 'prompt') console.log(promptFor(style, birds[0] || 'kiwi'));
else if (command === 'generate') generate(style, birds.length ? birds : BIRD_IDS);
else if (command === 'install') install(style);
else { console.error('usage: build-bird-cast.mjs prompt|generate|install <3d|clay> [bird…]'); process.exit(1); }
