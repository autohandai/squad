# ADR-0131: Select content, not app chrome

Date: 2026-10-14
Status: Accepted

## Context

The user showed Settings navigation, headings and button labels highlighted by
mouse selection across the whole window and asked for this to stop. Selection
was disabled only on the desktop drag region; ordinary UI text inherited the
browser default. A global prohibition without exceptions would also prevent
copying replies or editing a selected range.

## Decision

Use CSS selection rules: app chrome defaults to non-selectable; editable fields,
conversation/Markdown bodies, release notes, errors and code opt into text
selection. Buttons and menu controls remain non-selectable even inside content.
Do not cancel pointer events, keyboard events or context-menu events. Record
this as the standing UI contract in DESIGN.md.

## Consequences and validation

Chrome labels cannot be copied by selection; their keyboard navigation and
screen-reader semantics remain intact. Copyable content must carry the shared
`data-selectable` opt-in when it is not Markdown, code, an error or a field.
The update browser check drags headings in Default, Soft and Grut and verifies
an empty selection, then checks selectable conversation bodies and inputs.
This is browser proof; native WebKit inspection is recorded separately.
