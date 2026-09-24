# Autohand font attribution and provenance

Generated 2026-08-12. Build version 1.000.

This is an artifact-only font package. It does not install any family into
the Autohand website. The distributable files are narrow derivatives: upstream
outlines, spacing, kerning, and OpenType behavior are retained. Instrument Sans
statics are instantiated from the official variable fonts and receive the
pinned ttfautohint release pass; Ioskeley hint programs are retained.

## Autohand Sans

Autohand Sans is derived from Instrument Sans, designed by Rodrigo Fuenzalida
with direction from Jordan Egstad and released by the Instrument Sans Project
Authors under the SIL Open Font License 1.1.

- Official repository: `https://github.com/Instrument/instrument-sans`
- Immutable commit: `7fa22308a3d0c94ee2b3cd537a1196b65db34a3e`
- Roman variable source SHA-256: `b24f1812584816958afcf22e22d08e44318c5e51651e25d2438efdde389b33b1`
- Italic variable source SHA-256: `a74203cc5066a3b2f8de1a7b0887ef897773c2319dc86c911f8e85350cde0d07`
- OFL source SHA-256: `9e27a72ed30eb49a08678f6a5d6ed98ec7ba5368f541637ee0683ec9134ef966`

Changes: renamed to Autohand Sans, normal-width static instances generated at
400/500/600/700, static TTFs re-hinted with the pinned ttfautohint build,
derivative version/vendor metadata and Unicode range bits applied, invalidated
DSIG removed, and TTF/WOFF2 packages produced. No glyph outlines or spacing
were redrawn.
## Autohand Mono

Autohand Mono is derived from the no-ligatures build of Ioskeley Mono, an
Iosevka configuration by Ahmed Hatem. Iosevka was created by Renzhi Li
(Belleve Invis). Both layers are distributed under the SIL Open Font License
1.1.

- Official repository: `https://github.com/ahatem/IoskeleyMono`
- Release/tag: `v2.0.0` at `9d7d1ce72fcca2912077f800b5022cf475ac8d9a`
- Official release asset: `https://github.com/ahatem/IoskeleyMono/releases/download/v2.0.0/IoskeleyMono-NL.zip`
- Release archive SHA-256: `8480dbadb0c8c1739f338aba119dbc359b5d23f45bd1679e018964a77c602a8f`
- OFL source SHA-256: `1084285bd2bddf706d566e11a92fcbae2706da4a8eafac49ed34c871d01fb7fe`
- Selected hinted member SHA-256 values:
  - `Normal/Hinted/IoskeleyMonoNL-Regular.ttf`: `4a76e95ee8c023eefd4a1ae6f2138336d2f8a2eff0ac7a7fe17cddc574590649`
  - `Normal/Hinted/IoskeleyMonoNL-Italic.ttf`: `3748fe07f9460e45693dc8b5f462961788734cc3977c5a20945c9c1f8de72586`
  - `Normal/Hinted/IoskeleyMonoNL-Medium.ttf`: `d658cfc5f2a106257fc3eae3b9e485375cf2f669da0e278a16a3f18fbba165fb`
  - `Normal/Hinted/IoskeleyMonoNL-MediumItalic.ttf`: `2bc675169bacbd2886a29abb8c2c86fd11cdcf440b4d5e91ff8a0289d6d2f169`
  - `Normal/Hinted/IoskeleyMonoNL-SemiBold.ttf`: `225158e563892e55aa82d018e855b47ee95ea3aa36e66971e19f00a7a76e3030`
  - `Normal/Hinted/IoskeleyMonoNL-SemiBoldItalic.ttf`: `e477ca0c62d25afe23cf6e940371fef55d85cb2f46e3c0bedf8c563e967b2229`
  - `Normal/Hinted/IoskeleyMonoNL-Bold.ttf`: `8ff58529f3879c6e3b306dc63e6c5a8efe112bcd711fde211b5f65f28a19c55d`
  - `Normal/Hinted/IoskeleyMonoNL-BoldItalic.ttf`: `cb0aa9ab6aba992f9fadc33963d4c46af9458a99bc81f919f0a8467beefb46dc`

Changes: renamed to Autohand Mono, derivative version/vendor metadata and
Unicode range bits applied, invalidated DSIG removed, and WOFF2 packages
produced. The 600-unit cells, outlines, spacing, hint programs, coverage, and
no-ligatures behavior are retained.


## Reference boundary

The locally supplied Berkeley Mono and Cursor Gothic references are not direct
build inputs. Ioskeley Mono, the public OFL upstream used for Autohand Mono,
describes itself as an Iosevka configuration inspired by Berkeley Mono's look,
character variants, and metrics:
`https://github.com/ahatem/IoskeleyMono/blob/9d7d1ce72fcca2912077f800b5022cf475ac8d9a/README.md`.
This package uses only the checksum-verified Ioskeley release output. It does
not include a proprietary Berkeley Mono or Cursor Gothic binary, outline, or
font table.

Each included family directory contains the exact upstream OFL text that
applies to that derivative. The fonts must remain under OFL 1.1 and may not be
sold by themselves.
