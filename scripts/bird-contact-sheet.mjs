#!/usr/bin/env node
// Contact sheets of the bird cast, for checking faces by eye (ADR-0243):
// every face on the light and the dark avatar tile, named, at 96px and 32px.
//
//   node scripts/bird-contact-sheet.mjs <out-dir> [from] [count] [style]
//
// Writes <out-dir>/birds-<from>-<to>-<light|dark>.png.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { BIRDS } from '../src/lib/bird-cast.js';
import { birdFaceSvg } from '../src/lib/bird-faces.js';

const [out = 'bird-sheets', from = '0', count = '60', style = 'flat'] = process.argv.slice(2);
const dir = resolve(out);
mkdirSync(dir, { recursive: true });
const birds = BIRDS.slice(Number(from), Number(from) + Number(count));
const TILES = { light: ['#ffffff', '#eae9e4', '#37352f'], dark: ['#191919', '#323130', '#e6e6e3'] };

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
for (const [theme, [page_bg, tile, ink]] of Object.entries(TILES)) {
  const cells = birds.map((bird, index) => `<figure><div class="big">${birdFaceSvg(bird.id, { style })}</div><div class="small">${birdFaceSvg(bird.id, { style })}</div><figcaption>${Number(from) + index} ${bird.id}</figcaption></figure>`).join('');
  await page.setContent(`<html><body style="margin:0;background:${page_bg};font:11px system-ui;color:${ink}"><style>
    main{display:grid;grid-template-columns:repeat(10,1fr);gap:10px;padding:12px}
    figure{margin:0;display:grid;justify-items:center;gap:4px}
    .big,.small{background:${tile};border-radius:50%;display:grid;place-items:center;overflow:hidden}
    .big{width:96px;height:96px}.small{width:32px;height:32px}
    .big svg{width:84%;height:84%}.small svg{width:84%;height:84%}
    figcaption{max-width:110px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
  </style><main>${cells}</main></body></html>`);
  const file = join(dir, `birds-${from}-${Number(from) + birds.length - 1}-${theme}${style === 'flat' ? '' : `-${style}`}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(file);
}
await browser.close();
