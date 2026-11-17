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
import { BIRDS, BIRD_IDS, INSTALLED_ART, birdById, birdForMember, birdFromAvatar, searchBirds, untakenBird } from "../src/lib/bird-cast.js";
import { COMPOSED_BIRDS } from "../src/lib/bird-species.js";
import { createHash } from "node:crypto";
import { AVATAR_STYLES, BIRD_FACE_IDS, DEFAULT_AVATAR_STYLE, birdFaceSvg } from "../src/lib/bird-faces.js";
import { birdAvatarForRole, builtInAvatarOptions, roleTemplates } from "../src/data.js";
import {
  DEFAULT_SKIN_ID,
  SKINS,
  SKIN_VAR_DEFAULTS,
  isSkinId,
  memberAvatar,
  skinById,
  tokensForSkin,
} from "../src/lib/skins.js";

// The token list lives in App.jsx; a skin that names a colour must name all of
// them, or the preset underneath shows through in a way nobody designed.
const app = readFileSync("src/App.jsx", "utf8");
const tokenBlock = app.slice(app.indexOf("const THEME_TOKEN_NAMES = ["), app.indexOf("];", app.indexOf("const THEME_TOKEN_NAMES = [")));
const TOKEN_NAMES = [...tokenBlock.matchAll(/"([a-z0-9-]+)"/g)].map((match) => match[1]);
assert.ok(TOKEN_NAMES.length >= 20, `found ${TOKEN_NAMES.length} theme tokens`);

assert.equal(SKINS.length, 8, 'the three existing skins and five new designs are available');
for (const id of ['paper', 'slate', 'grove', 'blueprint', 'ember']) assert.ok(isSkinId(id), `new skin ${id} is selectable`);
assert.equal(SKINS[0].id, DEFAULT_SKIN_ID, "the default skin is first, so it is what a new install lands on");
assert.equal(new Set(SKINS.map((skin) => skin.id)).size, SKINS.length, "skin ids are unique");

for (const skin of SKINS) {
  assert.ok(skin.label && skin.description, `${skin.id} needs a label and a description`);
  assert.ok(Array.isArray(skin.swatches) && skin.swatches.length === 4, `${skin.id} needs four swatches`);
  for (const swatch of skin.swatches) assert.match(swatch, /^#[0-9a-f]{6}$/i, `${skin.id} swatch ${swatch}`);

  // All the colours or none: a half-declared palette is the bug where a skin
  // looks right until you open a chart or a destructive button.
  if (skin.tokens) for (const surface of ['light', 'dark']) {
    const tokens = tokensForSkin(skin, surface);
    assert.ok(tokens, `${skin.id} has a ${surface} palette`);
    for (const token of TOKEN_NAMES) {
      assert.ok(tokens[token], `${skin.id}/${surface} is missing the ${token} token`);
      assert.match(tokens[token], /^#[0-9a-f]{6}$/i, `${skin.id}/${surface}.${token} = ${tokens[token]}`);
    }
    assert.deepEqual(
      Object.keys(tokens).filter((key) => !TOKEN_NAMES.includes(key)),
      [],
      `${skin.id} declares a token the app does not apply`
    );
  }

  // Every var a skin sets must be one the app writes, or it does nothing.
  for (const varName of Object.keys(skin.vars || {})) {
    assert.ok(varName in SKIN_VAR_DEFAULTS, `${skin.id} sets --${varName}, which the app never applies`);
  }
  assert.ok(["photo", "portrait", "blob", "clay"].includes(skin.avatars), `${skin.id} avatars: ${skin.avatars}`);
}

// Only Autohand inherits colour presets. Every custom skin draws both modes.
const fallback = skinById(DEFAULT_SKIN_ID);
assert.equal(fallback.tokens, null, "the default skin overrides no colours");
for (const surface of ['light', 'dark']) assert.equal(tokensForSkin(fallback, surface), null);
const linear = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const luminance = hex => [1,3,5].map(i => linear(parseInt(hex.slice(i,i+2),16)/255)).reduce((sum,c,i) => sum+c*[0.2126,0.7152,0.0722][i],0);
const contrast = (a,b) => (Math.max(luminance(a),luminance(b))+0.05)/(Math.min(luminance(a),luminance(b))+0.05);
for (const skin of SKINS.filter(skin => skin.tokens)) {
  assert.deepEqual(Object.keys(skin.tokens).sort(), ['dark','light'], `${skin.id} cannot pin or silently fall through to another surface`);
  assert.ok(luminance(tokensForSkin(skin,'light').background)>0.8, `${skin.id} Light is actually light`);
  assert.ok(luminance(tokensForSkin(skin,'dark').background)<0.1, `${skin.id} Dark is actually dark`);
  for (const surface of ['light','dark']) {
    const t=tokensForSkin(skin,surface);
    const pairs=[['foreground','background'],['foreground','card'],['foreground','popover'],['primary-foreground','primary'],
      ['secondary-foreground','secondary'],['accent-foreground','accent'],['muted-foreground','background'],['muted-foreground','muted'],['muted-foreground','card'],['muted-foreground','popover'],['destructive','background']];
    let weakest=Infinity;
    for(const [ink,paper]of pairs){const ratio=contrast(t[ink],t[paper]);weakest=Math.min(weakest,ratio);assert.ok(ratio>=4.5,`${skin.id}/${surface}: ${ink} on ${paper} is ${ratio.toFixed(2)}:1, below AA body text`);}
    assert.ok(contrast(t.ring,t.background)>=3,`${skin.id}/${surface}: focus ring must remain visible`);
    console.log(`${skin.id}/${surface}: weakest text contrast ${weakest.toFixed(2)}:1`);
  }
}

assert.ok(isSkinId("grut"));
assert.ok(!isSkinId("nope"));
assert.equal(skinById("nope").id, DEFAULT_SKIN_ID, "an unknown id falls back rather than throwing");
assert.equal(skinById(undefined).id, DEFAULT_SKIN_ID);

// Avatars: every skin returns something drawable for every member, including a
// member with a custom role that has no artwork on disk.
const member = { id: "asq_kai_devops", name: "Kai", employeeType: "devops-engineer", avatar: "/avatars/devops-engineer.jpg" };
const upload = "data:image/png;base64,iVBORw0KGgo=";
const custom = { id: "asq_custom", name: "Zed", employeeType: "", avatar: upload };
for (const skin of SKINS) {
  for (const subject of [member, custom]) {
    const face = memberAvatar(subject, skin);
    assert.ok(["image", "blob"].includes(face.kind), `${skin.id} returned ${face.kind}`);
    if (face.kind === "image") assert.ok(face.src, `${skin.id} gave ${subject.name} an empty image src`);
    else assert.ok(face.blob.shape && face.blob.expression && face.blob.colour, `${skin.id} gave an incomplete blob`);
  }
}
// One face per member in every skin (ADR-0240): a picked or uploaded picture
// is shown as it is everywhere; skins no longer swap in role portraits.
for (const skin of SKINS) {
  assert.equal(memberAvatar(custom, skin).src, upload, `${skin.id} keeps an uploaded picture`);
  assert.equal(memberAvatar(member, skin).kind, "blob", `${skin.id} draws the bird for a removed portrait`);
}
// Only birds are built in (ADR-0240): no other built-in portrait may surface.
for (const removed of ["soft", "nz-riso-set-1-01.webp", "devops-engineer.jpg"]) assert.ok(!existsSync(`public/avatars/${removed}`), `removed avatar ${removed} is back`);
assert.ok(builtInAvatarOptions.every(option => birdFromAvatar(option.src)), "the picker offers only birds");
assert.ok(roleTemplates.every(role => birdFromAvatar(role.avatar)), "every role template starts as a bird");
assert.equal(memberAvatar({ id: "x", name: "Old", avatar: "/avatars/devops-engineer.jpg" }, SKINS[0]).kind, "blob", "a saved old portrait draws the bird");

// The bird cast (ADR-0235). Grut draws the member's own bird as a shapeless
// face; a custom picture still gets a bird, always the same one.
const kiwiMember = { id: "asq_eva_qa", name: "Eva", employeeType: "common-qa-engineer", avatar: "/avatars/birds/kiwi.webp" };
// A cast bird, or no picture at all, is that bird's drawn face, identical in
// every skin; only the tile behind it follows the skin (AgentAvatar).
for (const skin of SKINS) {
  const face = memberAvatar(kiwiMember, skin);
  assert.equal(face.kind, "blob", `${skin.id} draws the bird`);
  assert.equal(face.bird, "kiwi", `${skin.id} draws the member's own bird`);
  assert.equal(face.svg, memberAvatar(kiwiMember, SKINS[0]).svg, `${skin.id} draws the same face as every other skin`);
  const bare = memberAvatar({ id: "asq_bare", name: "Bare", avatar: "" }, skin);
  assert.equal(bare.kind, "blob", `${skin.id}: a member with no picture gets a bird, not an initial`);
}
assert.ok(memberAvatar(kiwiMember, skinById("grut")).svg.includes("<title>Eva</title>"));
assert.equal(birdForMember(custom), birdForMember({ ...custom }), "a custom picture maps to a stable bird");
assert.equal(birdFromAvatar("/avatars/birds/tui.webp"), "tui");
assert.equal(birdFromAvatar("/avatars/birds/dodo.webp"), "", "only cast birds count");
assert.equal(birdFromAvatar("/avatars/nz-riso-set-1-01.webp"), "");
assert.deepEqual([...BIRD_FACE_IDS].sort(), [...BIRD_IDS].sort(), "every cast bird has a shapeless face");
for (const bird of BIRD_IDS) {
  assert.ok(existsSync(`public/avatars/birds/${bird}.webp`), `the default art for ${bird} is served`);
  const svg = birdFaceSvg(bird);
  assert.ok(svg.startsWith("<svg") && svg.endsWith("</svg>"), `${bird} is not an svg`);
  assert.ok(svg.includes('fill-rule="evenodd"'), `${bird} must punch its eyes out`);
  assert.ok(svg.length < 1600, `${bird} face is ${svg.length} bytes`);
  assert.ok(!svg.includes("NaN") && !svg.includes("undefined"), `${bird} face has a broken number`);
}
assert.equal(new Set(BIRD_IDS.map((bird) => birdFaceSvg(bird))).size, BIRD_IDS.length, "every bird has its own face");

// Ember shows clay only for birds whose clay file is installed: Radix drops an
// image that 404s, so pointing at missing art would turn a bird into an initial.
for (const bird of INSTALLED_ART.clay) assert.ok(existsSync(`public/avatars/clay/${bird}.webp`), `INSTALLED_ART lists clay ${bird} but the file is missing`);
// New members: a known role keeps its bird; anyone else gets an untaken one.
assert.equal(birdAvatarForRole("common-qa-engineer", "", "x", ["/avatars/birds/kiwi.webp"]), "/avatars/birds/kiwi.webp");
const roster10 = [];
for (let index = 0; index < 10; index += 1) roster10.push(birdAvatarForRole("", "Generalist", `member-${index}`, roster10));
assert.equal(new Set(roster10).size, 10, `ten unknown-role members get ten birds: ${roster10.join(", ")}`);
// Brazil and US birds (ADR-0241) never move an existing member: assignment
// still hashes over New Zealand, and they come only once NZ is full.
assert.ok(roster10.every(src => BIRDS.find(bird => bird.id === birdFromAvatar(src))?.region === "nz"), "the first ten members get New Zealand birds");
assert.equal(BIRDS.find(bird => bird.id === birdFromAvatar(birdAvatarForRole("", "Generalist", "eleventh", roster10))).region, "br", "the eleventh gets the next bird in cast order");

// 300 birds (ADR-0243): the 26 drawn faces unchanged, 274 composed from one
// line per species, no country grouping. Assignment still hashes over the
// ten New Zealand birds, so no member's bird moved when the cast grew.
assert.equal(BIRDS.length, 300, "the cast has 300 birds");
assert.equal(COMPOSED_BIRDS.length, 274, "274 composed birds");
assert.deepEqual(BIRDS.filter(bird => bird.region === "nz").map(bird => bird.id), ["kiwi", "tui", "kea", "kereru", "pukeko", "ruru", "fantail", "takahe", "kakapo", "kotare"]);
assert.ok(BIRD_IDS.every(id => /^[a-z]+$/.test(id)), "bird ids are lowercase letters (birdFromAvatar reads them from the URL)");
assert.equal(new Set(BIRD_IDS).size, 300, "bird ids are unique");
for (const id of BIRD_IDS) assert.equal(birdFromAvatar(`/avatars/birds/${id}.webp`), id, `${id} round-trips through its URL`);
assert.equal(createHash("sha256").update(BIRD_IDS.slice(0, 26).map(id => birdFaceSvg(id)).join("")).digest("hex"), "4cd1225793251d32a69a04d768cf563062a45a01d08a9eec0dcb0d2f37f0cfb9", "the 26 drawn faces are byte-identical to ADR-0241's");
assert.deepEqual(searchBirds("tui").map(bird => bird.id), ["tui"]);
assert.ok(searchBirds("owl").every(bird => !["peafowl", "guineafowl"].includes(bird.id)) && searchBirds("owl").some(bird => bird.id === "barnowl"), "search matches the start of a word");
assert.ok(searchBirds("silvereye").some(bird => bird.id === "silvereye") && searchBirds("kingfisher").some(bird => bird.id === "kotare"), "search knows English names for Māori and Portuguese labels");
assert.equal(birdById("TUI")?.label, "Tūī");
// Distinct by eye, not only by markup: two composed birds with the same head,
// beak, crest and marks must differ clearly in some colour.
{
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const signature = spec => [spec.shape, spec.beak[0], spec.crest?.[0] || "", spec.tail ? "tail" : "", ...spec.marks.map(([kind]) => kind).sort()].join(",");
  const colours = spec => [spec.body, spec.beak[1], spec.crest?.[1], spec.tail, ...[...spec.marks].sort(([a], [b]) => a.localeCompare(b)).map(([, colour]) => colour)].filter(Boolean);
  for (let i = 0; i < COMPOSED_BIRDS.length; i += 1) for (let j = i + 1; j < COMPOSED_BIRDS.length; j += 1) {
    const [a, b] = [COMPOSED_BIRDS[i], COMPOSED_BIRDS[j]];
    if (signature(a.spec) !== signature(b.spec)) continue;
    const gap = Math.max(...colours(a.spec).map((colour, k) => Math.hypot(...rgb(colour).map((value, c) => value - rgb(colours(b.spec)[k])[c]))));
    assert.ok(gap >= 60, `${a.id} and ${b.id} are the same face in nearly the same colours`);
  }
}

assert.equal(untakenBird("same-seed"), untakenBird("same-seed"));

// Blobs: stable, complete, and spread over the whole set.
assert.deepEqual(blobFor("asq_kai_devops"), blobFor("asq_kai_devops"), "the same member gets the same blob");
for (const shape of BLOB_SHAPES) {
  for (const expression of BLOB_EXPRESSIONS) {
    const svg = blobSvg({ shape, expression, colour: "#4d8df0" });
    assert.ok(svg.startsWith("<svg") && svg.endsWith("</svg>"), `${shape}/${expression} is not an svg`);
    assert.ok(svg.includes("fill-rule=\"evenodd\""), `${shape}/${expression} must punch the eyes out`);
    assert.equal((svg.match(/<path\b/g)||[]).length,1,`${shape}/${expression}: body and eyes must share one path; sibling shapes cannot cut holes`);
    assert.equal((svg.match(/M/g)||[]).length,3,`${shape}/${expression}: body plus two eye subpaths`);
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
const SKIN_INSET_PX = { default: 0, soft: 4, grut: 0, paper: 0, slate: 0, grove: 0, blueprint: 0, ember: 0 };
const css = readFileSync("src/styles.css", "utf8");
for (const skin of SKINS) {
  // The PANEL radius, not --radius. They are two jobs: --radius is the skin's
  // identity and reshapes every shadcn primitive through --radius-sm/md/lg/xl,
  // while this one answers to the window frame. Holding the identity token to
  // the frame's geometry reshapes every button in the skin for no reason.
  const panel = parseFloat(skin.vars["skin-panel-radius"]);
  assert.ok(Number.isFinite(panel), `${skin.id} must declare skin-panel-radius`);
  assert.ok(
    panel <= WINDOW_FRAME_RADIUS_PX,
    `${skin.id} panels ask for ${panel}px; nothing above the window's ${WINDOW_FRAME_RADIUS_PX}px frame mask can agree with it at any inset`
  );
  const inset = SKIN_INSET_PX[skin.id];
  assert.ok(inset !== undefined, `${skin.id} has no recorded inset`);
  if (inset > 0) {
    assert.equal(
      panel,
      WINDOW_FRAME_RADIUS_PX - inset,
      `${skin.id} insets by ${inset}px, so concentric corners want a ${WINDOW_FRAME_RADIUS_PX - inset}px panel radius, not ${panel}px`
    );
    // A shadow bigger than the gap it falls into fills the gap: the page
    // colour between frame and panel renders as a dark rim and the float reads
    // as a bevel, which DESIGN.md rules out.
    const elevation = skin.vars["skin-elevation"] || "none";
    const blurs = [...elevation.matchAll(/(\d+)px\s+(\d+)px/g)].map((m) => Number(m[2]));
    const worst = blurs.length ? Math.max(...blurs) : 0;
    assert.ok(
      worst <= inset * 2,
      `${skin.id} insets by ${inset}px but its panel shadow blurs ${worst}px, which fills the gap and reads as a bevel`
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

// Layout is its own choice (ADR-0233): no skin carries one, and only a Grut
// user without a saved layout is moved to Minified, once.
const { LAYOUTS, resolveLayoutId, topMembers } = await import("../src/lib/layouts.js");
for (const skin of SKINS) assert.equal(skin.layout, undefined, `${skin.id} must not choose a layout`);
assert.deepEqual(LAYOUTS.map(layout => layout.id), ["full", "minified"]);
assert.equal(resolveLayoutId(null, "grut"), "minified", "a Grut user keeps the conversation list once");
assert.equal(resolveLayoutId("full", "grut"), "full", "a saved choice beats the migration");
assert.equal(resolveLayoutId(null, "paper"), "full");
assert.equal(resolveLayoutId("nonsense", "default"), "full");
const people = [{ id: "a" }, { id: "b", pinned: true }, { id: "c" }, { id: "d", pinned: true }];
assert.deepEqual(topMembers(people).members.map(m => m.id), ["b", "d"], "pinned members lead, in pin order");
assert.deepEqual(topMembers(people.map(({ id }) => ({ id })), id => ({ a: 1, b: 3, c: 2, d: 0 })[id.id]).members.map(m => m.id), ["b", "c", "a", "d"]);
const css2 = readFileSync("src/styles.css", "utf8");
assert.ok(!/data-skin="grut"\][^{]*chat-(user-bubble|agent-answer)/.test(css2), "bubbles belong to the Minified layout, not the Grut skin");

console.log(`check-skins: ok (${SKINS.length} skins, ${BLOB_SHAPES.length * BLOB_EXPRESSIONS.length * BLOB_COLOURS.length} blobs)`);

// Avatar styles (ADR-0242): flat by default; 3D and clay are filters over the
// same face, so the bird and its shapes never change with the style.
assert.deepEqual(AVATAR_STYLES.map(style => style.id), ["flat", "3d", "clay"]);
assert.equal(DEFAULT_AVATAR_STYLE, "flat");
for (const bird of BIRD_IDS) {
  const flat = birdFaceSvg(bird);
  assert.equal(birdFaceSvg(bird, { style: "flat" }), flat, "flat is the default drawing");
  for (const style of ["3d", "clay"]) {
    const styled = birdFaceSvg(bird, { style });
    assert.ok(styled.includes(`filter="url(#squad-bird-${style})"`) && styled.includes(`<filter id="squad-bird-${style}"`), `${bird} ${style} carries its filter`);
    for (const path of flat.match(/<path [^>]*>/g)) assert.ok(styled.includes(path), `${bird} ${style} keeps the flat face's shapes`);
  }
}
console.log(`check-skins: avatar styles ok (${AVATAR_STYLES.length} styles x ${BIRD_IDS.length} birds)`);
