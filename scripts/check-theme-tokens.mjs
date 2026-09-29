#!/usr/bin/env node
// The Autohand palette is written twice: as a token map in THEME_PRESETS
// (src/App.jsx) and as CSS custom properties in src/styles.css. The App.jsx
// copy is applied to the document root at runtime and so wins, which means
// editing only the stylesheet looks like the change did nothing, and editing
// only App.jsx leaves the first paint - before React runs - on the old colour.
//
// This check makes the two agree, and holds both to WCAG AA for body text
// (ADR-0059). Contrast is computed here rather than asserted in a comment,
// because a palette is exactly the kind of thing that gets nudged later.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync("src/App.jsx", "utf8");
const css = readFileSync("src/styles.css", "utf8");

function presetTokens(id) {
  const at = app.indexOf(`id: "${id}"`);
  assert.ok(at > 0, `${id} is missing from THEME_PRESETS`);
  const open = app.indexOf("tokens: {", at);
  const close = app.indexOf("},", open);
  const body = app.slice(open, close);
  const tokens = {};
  for (const [, name, value] of body.matchAll(/"?([a-z0-9-]+)"?:\s*"(#[0-9a-fA-F]{6})"/g)) tokens[name] = value.toLowerCase();
  return tokens;
}

function cssTokens(selector) {
  const at = css.indexOf(selector);
  assert.ok(at > 0, `${selector} is missing from styles.css`);
  const close = css.indexOf("\n}", at);
  const body = css.slice(at, close);
  const tokens = {};
  for (const [, name, value] of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6});/g)) tokens[name] = value.toLowerCase();
  return tokens;
}

// --- contrast ---------------------------------------------------------------

const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const linear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (hex) => {
  const [r, g, b] = channels(hex).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

const AA_BODY = 4.5;

for (const [id, selector] of [
  ["autohand-dark", ":root {"],
  ["autohand-light", ".light {"],
]) {
  const fromApp = presetTokens(id);
  const fromCss = cssTokens(selector);

  // Surfaces and ink must be declared in both and agree. Charts are allowed to
  // inherit: `.light` is a partial override of `:root`, and a chart colour that
  // is briefly wrong before React runs is not worth forcing duplication for.
  const MUST_DECLARE = [
    "background", "foreground", "card", "card-foreground", "popover", "popover-foreground",
    "primary", "primary-foreground", "secondary", "secondary-foreground",
    "muted", "muted-foreground", "accent", "accent-foreground", "destructive",
    "border", "input", "ring",
  ];
  for (const name of MUST_DECLARE) {
    assert.ok(fromApp[name], `${id} does not declare ${name}`);
    assert.ok(fromCss[name], `${selector} is missing --${name}, which ${id} declares`);
    assert.equal(
      fromCss[name],
      fromApp[name],
      `${id}.${name} is ${fromApp[name]} in App.jsx but --${name} is ${fromCss[name]} in styles.css - the App.jsx copy wins at runtime, so the stylesheet is only what the first paint uses`
    );
  }
  // Anything the stylesheet does declare must still match, so a stale extra
  // cannot sit there disagreeing.
  for (const [name, value] of Object.entries(fromCss)) {
    if (!fromApp[name]) continue;
    assert.equal(value, fromApp[name], `${selector} --${name} is ${value} but ${id} says ${fromApp[name]}`);
  }

  // Readability, computed. These four are the pairings that carry body text.
  const pairs = [
    ["foreground on background", fromApp.foreground, fromApp.background],
    ["muted-foreground on background", fromApp["muted-foreground"], fromApp.background],
    ["muted-foreground on muted", fromApp["muted-foreground"], fromApp.muted],
    ["foreground on card", fromApp.foreground, fromApp.card],
    ["muted-foreground on card", fromApp["muted-foreground"], fromApp.card],
  ];
  for (const [label, front, back] of pairs) {
    const ratio = contrast(front, back);
    assert.ok(
      ratio >= AA_BODY,
      `${id}: ${label} is ${ratio.toFixed(2)}:1 (${front} on ${back}), below AA body text ${AA_BODY}:1`
    );
  }

  // Surfaces have to separate by value: this product draws few borders, so a
  // popover that matches the page behind it has nothing but its shadow. That
  // was the state of the dark theme before ADR-0059 - card and popover were
  // the same colour.
  assert.notEqual(fromApp.card, fromApp.background, `${id}: card matches the page`);
  assert.notEqual(fromApp.popover, fromApp.card, `${id}: popover matches card, so a menu over the sidebar has no lift`);
}

// One ink per theme for anything carrying body text. Four different near-blacks
// is why the same small type used to look subtly different in different places.
for (const id of ["autohand-dark", "autohand-light"]) {
  const tokens = presetTokens(id);
  const inks = new Set([
    tokens.foreground,
    tokens["card-foreground"],
    tokens["popover-foreground"],
    tokens["secondary-foreground"],
    tokens["accent-foreground"],
  ]);
  assert.equal(inks.size, 1, `${id} uses ${inks.size} different inks for body text: ${[...inks].join(", ")}`);
}

// The meta the browser paints its own chrome with must not be hardcoded to a
// colour no theme uses; App.jsx keeps it in step at runtime.
const html = readFileSync("index.html", "utf8");
const metas = [...html.matchAll(/<meta name="theme-color"[^>]*>/g)];
assert.equal(metas.length, 1, `index.html has ${metas.length} theme-color metas; one, updated at runtime, is the contract`);
assert.ok(app.includes('meta[name="theme-color"]'), "App.jsx must keep theme-color in step with the active theme");

console.log("check-theme-tokens: ok (both palettes agree, AA body text, one ink each)");
