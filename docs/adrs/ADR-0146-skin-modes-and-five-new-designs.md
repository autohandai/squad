# ADR-0146: Every skin follows Mode; presets belong to Autohand

Date: 2026-10-23. Status: Accepted.

## Context and evidence

The reported Appearance screen selected Light while Grut remained dark. This
was not a stale preference: ADR-0058 deliberately let Soft force light and
Grut force dark. `surfaceForSkin` replaced the resolved user mode before the
app applied classes or colours. Both skins also had only one palette. Theme
presets remained editable under those skins even though their palettes won
over every preset token, so changing the controls did nothing visible.

Before the fix, `node scripts/check-appearance-skins-browser.mjs --repro=grut`
saved Light and observed `{mode:"light",surface:"dark",background:"#0d0d0f"}`.
`--repro=presets` independently failed because the preset controls were still
present under Grut. The old unit test explicitly required Grut to force dark;
that assertion encoded the original decision, not the user's current contract.

The user also requested five distinct skins. More colour presets would leave
the existing typography, density, corners and portraits unchanged, which is
why these designs extend the skin registry rather than the preset list.

Grut had a second rendering defect: its body and eyes were sibling SVG shapes.
Even-odd fill cannot cut holes between siblings. The previous check only
looked for the `evenodd` string and therefore passed a faceless avatar. In
Quick Chat the SVG could also inherit a button's small icon dimensions.

## Decision

Resolve System/Light/Dark independently of the skin. Each custom skin supplies
two complete 23-token palettes; Autohand supplies neither and continues using
the saved light/dark presets. Remove the surface override instead of adding
exceptions for individual skins. Main, Quick Chat and information windows use
the same registry and palette resolver. Information windows apply geometry
with actual CSS custom-property names (`--radius`, not `radius`).

Show Theme presets only under Autohand. Changing skins never rewrites those
saved choices. Keep Mode first and the skin picker as plain divider rows with
swatches, descriptions and a check. Use the existing shadcn single-select
ToggleGroup for radio semantics, roving keyboard focus and visible focus.

Add five designs through inherited tokens, without separate page components:

| Skin | Type and rhythm | Geometry and portraits |
| --- | --- | --- |
| Paper | Warm ivory/brown; installed serif headings; 1.02 density | 6px controls; soft square illustrated role portraits |
| Slate | Cool steel/blue; Sans at 90% width; 0.94 density | 4px controls; square bird portraits |
| Grove | Sage/forest; open 1.04 density | 8px controls; round illustrated role portraits |
| Blueprint | Drafting blue; bundled Mono; 0.96 density | 2px controls; square bird portraits |
| Ember | Warm ink/rust; Sans at 95% width; 1.03 density | 6px controls; soft square bird portraits |

Values above describe registry tokens at a 16px base, before density scales
rem units. Soft retains its existing floating layout; the five new designs use
the shared flat layout. Custom sidebars paint their card colour opaquely;
Autohand retains native desktop vibrancy. Reset all geometry/type variables
when switching skins, so condensed or monospaced type cannot leak into the
next selection.

Draw a blob as one path containing the body and both eye subpaths, with
even-odd fill. Give its SVG the full-size class so button icon rules exclude
it. Identity hashing, colours, shapes and expressions stay deterministic.

## Validation

- `node scripts/check-skins.mjs` checks the eight skins, complete paired
  palettes, installed portrait assets, geometry and 1,536 blob combinations.
  Across the fourteen custom palettes, the weakest declared text pair is
  Ember/light at **4.57:1**; every declared text pair is at least 4.5:1, and
  each focus ring against the page is at least 3:1.
- `node scripts/check-theme-tokens.mjs` retains the existing Autohand palette
  checks.
- `node scripts/check-appearance-skins-browser.mjs` exercises the actual
  settings controls and rendered conversation: eight skins in both explicit
  modes, System changes, Autohand preset retention, keyboard selection, reload,
  390px layout, and the separate About entry point. It samples both eyes and
  the body for all 128 shape/expression pairs on two backgrounds: **256 raster
  samples**. Screenshots and measured styles live under
  `.codex-artifacts/appearance/browser/`.
- The same script with `--desktop` enables the macOS user-agent styling,
  including the 28px native title-bar inset and custom opaque sidebars. Its
  artifacts live under `.codex-artifacts/appearance/desktop/`. Autohand's
  transparent desktop body is intentional and is checked separately from
  opaque custom skins.
- `node scripts/check-quick-chat-theme.mjs` changes all eight skins through
  both modes in an already-open second document at 380×520. Computed type,
  palette and geometry match the main document; its identity and unsent draft
  survive. The Grut SVG fills its avatar space.
- `node scripts/check-settings-browser.mjs` checks production Settings routes,
  Back/Forward, Escape, legacy links and the narrow section list.
- `bun run build` compiles the production bundle; its large-chunk warning
  remains. No dependency, native-shell or provider changes are required.

The browser harness initially performed a full navigation for every screen
and timed out on a later conversation load. Ordinary screen transitions now
exercise the app's client-side route handler; reload and About still load new
documents. A reload assertion initially could read the old DOM before the new
document started. It now waits for a document sentinel to disappear before
checking the restored controls. The earlier pass alone did not prove reload
persistence.

## Consequences and limits

- This supersedes ADR-0058's forced-surface decision and ADR-0141's statement
  that a skin may override System. A previously saved Dark or System preference
  under Soft can now produce its dark design; the saved preference itself is
  preserved.
- Soft's light primary text is dark ink and its muted text is stronger, to
  meet the declared contrast checks. This deliberately changes the old coral
  button treatment. These ratios do not certify every translucent or disabled
  combination in the entire product; chart colours remain visual accents.
- Paper uses available system serif fonts, so heading metrics can vary across
  platforms. No external font request or additional font payload is introduced.
  Existing bundled portraits are reused; custom roles retain their own photo.
- Custom palettes are cohesive and cannot be recoloured with Autohand presets.
  A user-authored skin editor, per-skin remembered modes, new artwork and
  separate per-skin page layouts are intentionally outside this change.
- Browser desktop styling is not native vibrancy, OS popover observation,
  notarization or a published/installed desktop release. This change does not
  install or publish a new app.
