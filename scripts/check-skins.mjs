#!/usr/bin/env node
// Checks for skins and blob avatars (src/lib/skins.js, src/lib/blob-avatar.js,
// ADR-0058): a skin declares a complete palette or none at all, the default
// skin keeps the existing theme presets working, every member resolves to
// something drawable, and a blob is the same blob every time.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import {
  BLOB_COLOURS,
  BLOB_EXPRESSIONS,
  BLOB_SHAPES,
  blobFor,
  blobForMember,
  blobSvg,
} from "../src/lib/blob-avatar.js";
import {
  DEFAULT_SKIN_ID,
  SKINS,
  SKIN_VAR_DEFAULTS,
  isSkinId,
  SOFT_PORTRAIT_SLUGS,
  memberAvatar,
  skinById,
  surfaceForSkin,
} from "../src/lib/skins.js";

// The token list lives in App.jsx; a skin that names a colour must name all of
// them, or the preset underneath shows through in a way nobody designed.
const app = readFileSync("src/App.jsx", "utf8");
const tokenBlock = app.slice(app.indexOf("const THEME_TOKEN_NAMES = ["), app.indexOf("];", app.indexOf("const THEME_TOKEN_NAMES = [")));
const TOKEN_NAMES = [...tokenBlock.matchAll(/"([a-z0-9-]+)"/g)].map((match) => match[1]);
assert.ok(TOKEN_NAMES.length >= 20, `found ${TOKEN_NAMES.length} theme tokens`);

assert.ok(SKINS.length >= 3, `skins: ${SKINS.length}`);
assert.equal(SKINS[0].id, DEFAULT_SKIN_ID, "the default skin is first, so it is what a new install lands on");
assert.equal(new Set(SKINS.map((skin) => skin.id)).size, SKINS.length, "skin ids are unique");

for (const skin of SKINS) {
  assert.ok(skin.label && skin.description, `${skin.id} needs a label and a description`);
  assert.ok(Array.isArray(skin.swatches) && skin.swatches.length === 4, `${skin.id} needs four swatches`);
  for (const swatch of skin.swatches) assert.match(swatch, /^#[0-9a-f]{6}$/i, `${skin.id} swatch ${swatch}`);

  // All the colours or none: a half-declared palette is the bug where a skin
  // looks right until you open a chart or a destructive button.
  if (skin.tokens) {
    for (const token of TOKEN_NAMES) {
      assert.ok(skin.tokens[token], `${skin.id} is missing the ${token} token`);
      assert.match(skin.tokens[token], /^#[0-9a-f]{6}$/i, `${skin.id}.${token} = ${skin.tokens[token]}`);
    }
    assert.deepEqual(
      Object.keys(skin.tokens).filter((key) => !TOKEN_NAMES.includes(key)),
      [],
      `${skin.id} declares a token the app does not apply`
    );
  }

  // Every var a skin sets must be one the app writes, or it does nothing.
  for (const varName of Object.keys(skin.vars || {})) {
    assert.ok(varName in SKIN_VAR_DEFAULTS, `${skin.id} sets --${varName}, which the app never applies`);
  }
  assert.ok(["photo", "portrait", "blob"].includes(skin.avatars), `${skin.id} avatars: ${skin.avatars}`);
}

// The default skin must not force a surface or a palette: twenty theme presets
// and the user's own light/dark choice depend on it staying out of the way.
const fallback = skinById(DEFAULT_SKIN_ID);
assert.equal(fallback.tokens, null, "the default skin overrides no colours");
assert.equal(fallback.surface, null, "the default skin forces no surface");
assert.equal(surfaceForSkin(fallback, "light"), "light", "the default skin follows the user into light");
assert.equal(surfaceForSkin(fallback, "dark"), "dark", "the default skin follows the user into dark");
assert.equal(surfaceForSkin(skinById("soft"), "dark"), "light", "a light skin stays light");
assert.equal(surfaceForSkin(skinById("grut"), "light"), "dark", "a dark skin stays dark");

assert.ok(isSkinId("grut"));
assert.ok(!isSkinId("nope"));
assert.equal(skinById("nope").id, DEFAULT_SKIN_ID, "an unknown id falls back rather than throwing");
assert.equal(skinById(undefined).id, DEFAULT_SKIN_ID);

// Avatars: every skin returns something drawable for every member, including a
// member with a custom role that has no artwork on disk.
const member = { id: "asq_kai_devops", name: "Kai", employeeType: "devops-engineer", avatar: "/avatars/devops-engineer.jpg" };
const custom = { id: "asq_custom", name: "Zed", employeeType: "", avatar: "/avatars/custom.jpg" };
for (const skin of SKINS) {
  for (const subject of [member, custom]) {
    const face = memberAvatar(subject, skin);
    assert.ok(["image", "blob"].includes(face.kind), `${skin.id} returned ${face.kind}`);
    if (face.kind === "image") assert.ok(face.src, `${skin.id} gave ${subject.name} an empty image src`);
    else assert.ok(face.blob.shape && face.blob.expression && face.blob.colour, `${skin.id} gave an incomplete blob`);
  }
}
assert.equal(memberAvatar(custom, skinById("soft")).src, "/avatars/custom.jpg", "a custom role uses its own picture");
assert.equal(memberAvatar(member, skinById("default")).src, "/avatars/devops-engineer.jpg");

// Portraits are opt-in by slug because Radix unmounts an image that 404s: a
// skin pointing at art that is not installed shows an initial, not a photo.
// So every listed slug must have a file, and a slug that is not listed must
// fall back to the member's own picture.
for (const slug of SOFT_PORTRAIT_SLUGS) {
  assert.ok(existsSync(`public/avatars/soft/${slug}.jpg`), `SOFT_PORTRAIT_SLUGS lists ${slug} but public/avatars/soft/${slug}.jpg is missing`);
}
if (SOFT_PORTRAIT_SLUGS.includes("devops-engineer")) {
  assert.equal(memberAvatar(member, skinById("soft")).src, "/avatars/soft/devops-engineer.jpg");
  assert.equal(memberAvatar(member, skinById("soft")).fallbackSrc, "/avatars/devops-engineer.jpg");
} else {
  assert.equal(memberAvatar(member, skinById("soft")).src, "/avatars/devops-engineer.jpg", "an undrawn role keeps its photo");
}

// Blobs: stable, complete, and spread over the whole set.
assert.deepEqual(blobFor("asq_kai_devops"), blobFor("asq_kai_devops"), "the same member gets the same blob");
for (const shape of BLOB_SHAPES) {
  for (const expression of BLOB_EXPRESSIONS) {
    const svg = blobSvg({ shape, expression, colour: "#4d8df0" });
    assert.ok(svg.startsWith("<svg") && svg.endsWith("</svg>"), `${shape}/${expression} is not an svg`);
    assert.ok(svg.includes("fill-rule=\"evenodd\""), `${shape}/${expression} must punch the eyes out`);
    assert.ok(svg.length < 1200, `${shape}/${expression} is ${svg.length} bytes`);
  }
}
// Squad ids share a long prefix, and a hash whose low bits carry that
// similarity gave every seeded member the same shape. Every bucket must be
// reachable, or the set silently collapses to one look.
const seen = { shape: new Set(), expression: new Set(), colour: new Set() };
for (let index = 0; index < 4000; index += 1) {
  const blob = blobFor(`asq_member_${index}`);
  seen.shape.add(blob.shape);
  seen.expression.add(blob.expression);
  seen.colour.add(blob.colour);
}
assert.equal(seen.shape.size, BLOB_SHAPES.length, `shapes reached: ${seen.shape.size}/${BLOB_SHAPES.length}`);
assert.equal(seen.expression.size, BLOB_EXPRESSIONS.length, `expressions reached: ${seen.expression.size}/${BLOB_EXPRESSIONS.length}`);
assert.equal(seen.colour.size, BLOB_COLOURS.length, `colours reached: ${seen.colour.size}/${BLOB_COLOURS.length}`);
// The real roster, not just synthetic ids: four members must not be four of the
// same shape.
const roster = ["asq_noah_frontend", "asq_iris_reviewer", "asq_kai_devops", "asq_eva_qa"];
assert.ok(new Set(roster.map((id) => blobFor(id).shape)).size > 1, "the seeded members all got the same shape");

// A name reaches the markup so the blob is announced as somebody.
const titled = blobSvg(blobForMember({ id: "asq_kai_devops", name: "Kai" }));
assert.ok(titled.includes("<title>Kai</title>"), titled.slice(0, 120));
assert.ok(blobSvg({ shape: "circle" }).includes('aria-hidden="true"'), "an unnamed blob is decorative");

// Corner geometry against the window frame (ADR-0060). macOS masks the window
// at a fixed 12px - measured with an AppKit probe, not remembered, and not
// settable from Tauri or from public AppKit. Concentric corners need
// inner = outer - inset, so a panel radius above 12px cannot agree with the
// frame at ANY positive inset: at 20px inside a 10px inset the margin was 10px
// along the flat edges and 17.5px across the diagonal, and the page colour
// pooled in the corners. DESIGN.md asks for 4-8px and names bulbous corners
// explicitly.
const WINDOW_FRAME_RADIUS_PX = 12;
const SKIN_INSET_PX = { default: 0, soft: 4, grut: 0 };
const css = readFileSync("src/styles.css", "utf8");
for (const skin of SKINS) {
  const radius = parseFloat(skin.vars.radius) * 16;
  assert.ok(
    radius <= WINDOW_FRAME_RADIUS_PX,
    `${skin.id} asks for a ${radius}px radius; nothing above the window's ${WINDOW_FRAME_RADIUS_PX}px frame mask can agree with it at any inset`
  );
  const inset = SKIN_INSET_PX[skin.id];
  if (inset === undefined) continue;
  if (inset > 0) {
    assert.equal(
      radius,
      WINDOW_FRAME_RADIUS_PX - inset,
      `${skin.id} insets by ${inset}px, so concentric corners want a ${WINDOW_FRAME_RADIUS_PX - inset}px radius, not ${radius}px`
    );
  }
}
// The inset the stylesheet actually applies has to be the one assumed above.
const softInset = css.match(/data-skin="soft"\][^{]*\{[^}]*--skin-inset:\s*(\d+)px/);
assert.ok(softInset, "the soft skin must declare --skin-inset");
assert.equal(
  Number(softInset[1]),
  SKIN_INSET_PX.soft,
  `styles.css insets soft by ${softInset[1]}px but the radius is chosen for ${SKIN_INSET_PX.soft}px`
);

console.log(`check-skins: ok (${SKINS.length} skins, ${BLOB_SHAPES.length * BLOB_EXPRESSIONS.length * BLOB_COLOURS.length} blobs)`);
