#!/usr/bin/env node
// The bird cast's raster pipeline (ADR-0235).
//
//   node scripts/build-bird-cast.mjs prompt <3d|clay> <bird>     print the prompt
//   node scripts/build-bird-cast.mjs generate <3d|clay> [bird…]  masters via gpt-image-bridge
//   node scripts/build-bird-cast.mjs install <3d|clay>           masters -> served WebP
//   node scripts/build-bird-cast.mjs faces                       drawn faces -> /avatars/birds WebP (the default, ADR-0240)
//
// Masters are 1024px PNGs in assets/characters/<style>/<bird>.png (kept, not
// served). `install` writes 512px and 256px WebP:
//   3d    public/avatars/birds/<bird>.webp and public/avatars/birds/256/<bird>.webp
//   clay  public/avatars/clay/<bird>.webp  and public/avatars/clay/256/<bird>.webp
// The 3D files replace the bird portraits at the URLs members already store,
// so nothing saved needs rewriting. For clay it then lists the installed birds
// in INSTALLED_ART (src/lib/bird-cast.js), which is what lets the Ember skin
// point at them; until then Ember shows the member's own bird.
//
// Look at every master before installing. Regenerate any that are off-model,
// have text or a watermark, extra limbs or features, or drift from the set.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BIRD_IDS } from '../src/lib/bird-cast.js';
import { birdFaceSvg } from '../src/lib/bird-faces.js';
import { tmpdir } from 'node:os';

const ROOT = new URL('..', import.meta.url).pathname;
const BRIDGE = join(homedir(), '.claude/skills/gpt-image-bridge/bin/gpt-image-2');
const STYLES = ['3d', 'clay'];
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
};

const FRAMING = 'Framing: head-and-shoulders bust only, NOT full body, character centred, facing three-quarters toward the camera, top of head about 10% below the top edge, shoulders cropped by the bottom edge, face in the centre of the frame so it survives a circular crop.';
const CLEAN = 'Absolutely no text, no letters, no logo, no watermark, no border, no frame. Naturally proportioned and believable for the species: no human features, no hands, no clothing, no accessories. An original character, not resembling any existing brand mascot.';

export function promptFor(style, bird) {
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
const served = (style, bird, size) => join(ROOT, 'public/avatars', style === '3d' ? 'birds' : 'clay', size === 512 ? '' : String(size), `${bird}.webp`);

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
    for (const size of [512, 256]) {
      const target = served(style, bird, size);
      mkdirSync(join(target, '..'), { recursive: true });
      execFileSync('magick', [source, '-gravity', 'center', '-extent', '%[fx:min(w,h)]x%[fx:min(w,h)]', '-resize', `${size}x${size}`, '-strip', '-quality', '82', target]);
      total += statSync(target).size;
    }
    installed.push(bird);
  }
  if (style === 'clay') {
    const file = join(ROOT, 'src/lib/bird-cast.js');
    const source = readFileSync(file, 'utf8');
    const next = source.replace(/clay: \[[^\]]*\]/, `clay: [${installed.map(bird => `'${bird}'`).join(', ')}]`);
    writeFileSync(file, next);
  }
  console.log(`installed ${installed.length} ${style} birds, ${total} bytes of WebP`);
}

// The drawn faces as files (ADR-0240). The app draws each face inline, but the
// menu bar reads /avatars/birds/<bird>.webp from the bundle and the iPhone and
// Quick Chat fetch it, so the same face is rendered into those files: a
// transparent tile (eyes stay holes), the face inset 8% like the in-app tile.
function faces() {
  let total = 0;
  const work = join(tmpdir(), `bird-faces-${process.pid}`);
  mkdirSync(work, { recursive: true });
  for (const bird of BIRD_IDS) {
    // Chrome draws the SVG exactly as the app does; ImageMagick's renderer
    // drops stroked paths (the kiwi's beak, the tūī's stripe).
    const page = join(work, `${bird}.html`), png = join(work, `${bird}.png`);
    writeFileSync(page, `<html><body style="margin:0;background:transparent"><div style="width:1024px;height:1024px;padding:82px;box-sizing:border-box">${birdFaceSvg(bird).replace('class="size-full"', 'width="860" height="860"')}</div></body></html>`);
    execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--default-background-color=00000000', `--screenshot=${png}`, '--window-size=1024,1024', `file://${page}`], { stdio: 'ignore' });
    for (const size of [512, 256]) {
      const target = served('3d', bird, size);
      mkdirSync(join(target, '..'), { recursive: true });
      execFileSync('magick', [png, '-resize', `${size}x${size}`, '-strip', '-define', 'webp:lossless=true', target]);
      total += statSync(target).size;
    }
  }
  console.log(`rendered ${BIRD_IDS.length} drawn faces, ${total} bytes of WebP`);
}

const [command, style, ...birds] = process.argv.slice(2);
if (command === 'faces') { faces(); process.exit(0); }
if (!STYLES.includes(style)) { console.error('style must be 3d or clay'); process.exit(1); }
if (command === 'prompt') console.log(promptFor(style, birds[0] || 'kiwi'));
else if (command === 'generate') generate(style, birds.length ? birds : BIRD_IDS);
else if (command === 'install') install(style);
else { console.error('usage: build-bird-cast.mjs prompt|generate|install <3d|clay> [bird…]'); process.exit(1); }
