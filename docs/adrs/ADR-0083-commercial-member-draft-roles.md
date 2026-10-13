# ADR-0083: Commercial intent and editable custom member titles

Date: 2026-10-13

## Context and evidence

The local candidate filled an APAC go-to-market leadership brief as Delta,
Data Engineer. The offline draft matcher treated the word `pipeline` as data
engineering; the commercial brief explicitly meant building a sales pipeline.
The custom title was a text label, so the person could change the name and bio
but could not correct that classification before creation.

`node scripts/check-member-draft.mjs` reproduces the reported commercial brief
and failed with actual `Data Engineer`, expected `GTM APAC Leader`. The red
output is retained in `.codex-artifacts/local-0.1.6/gtm-draft-red.log`. This is a
fallback classification defect, not evidence that saved role profiles or all
model-generated drafts lose their roles.

## Decision

Recognize explicit GTM/go-to-market intent before incidental engineering
keywords; preserve APAC scope in that fallback title. Keep ETL/data-warehouse
work classified as engineering when there is no explicit GTM responsibility.
Tell the designer model that squad jobs include commercial, creative and
business responsibilities, and distinguish sales from data pipelines.

Make a custom title editable in the existing header with the same input style
as the name. Update its generated leading `Act as <role>.` instruction when
the title changes, keeping authored instructions and persona files intact.
Keep the draft's role through persistence and preparation; do not
rewrite existing members or automatically reclassify a saved draft's bio.

## Consequences and limits

The fallback remains a small heuristic, not a universal job classifier. It
does not invent regional titles for every geography. A model can still propose
an unsuitable title; the editable field provides a direct correction before
creation. Business-specific permissions and tools remain configured through
the existing capability controls, not expanded by a job title. Existing drafts
need a title correction or a new design request; their authored text is kept.
