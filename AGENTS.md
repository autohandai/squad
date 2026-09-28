# Repository Guidance

## Design Guidance

- Before changing visible UI, read `DESIGN.md` and preserve its product style.
- When the user gives a durable UI preference, or when the design contract changes, update `DESIGN.md` in the same change.
- Prefer shadcn/ui primitives from `src/components/ui` and the repo design tokens. If a needed shadcn component is missing, add it through the shadcn registry setup before hand-rolling a custom primitive.
- Avoid bento-style layouts, boxed dashboards, and card-heavy surfaces. Do not frame every designated area with borders, tinted backgrounds, or separate panel colors.
- Use whitespace, typography, alignment, subtle dividers, and simple controls to create hierarchy.
- Keep corners restrained. Avoid exaggerated bevels, overly rounded cards, and pill-like containers unless the existing component contract requires them.
- Default to a Notion-like minimal product surface: functional, calm, neutral, and direct.

## Documentation

Three places, each answering a different question. Update them in the same
change as the code, never in a follow-up pass.

- **`docs/adrs/ADR-00NN-<slug>.md`** — why. Write one whenever a change rests
  on a judgement someone could reasonably have made differently. It carries
  the context with the evidence that produced it (measurements, what was
  observed, what the old behaviour actually did), the decision, and the
  consequences. Consequences must name what was knowingly left undone or
  traded away; an ADR that only lists wins is not finished.
- **`DESIGN.md`** — the standing UI contract. Add a line when a durable rule
  emerges, so the next change inherits it instead of relitigating it.
- **`CHANGELOG.md`** — what shipped, in the user's language. Added, Changed,
  Fixed. A person reading it should recognise the thing they asked for.

An ADR is per decision, not per commit. A commit carrying three unrelated
judgements needs three records or one that covers all three; a commit that
only implements a decision already recorded amends that record instead of
opening a new one. Check before pushing: if a change would make someone ask
"why is it like this?", the answer belongs in `docs/adrs/` before it ships,
not after.

Two rules that make the rest worth reading.

- **Record what was learnt, not only what was done.** A fix whose cause was
  surprising is worth more written down than a feature that went to plan. When
  a diagnosis turns out wrong, say so in the ADR and keep the correction; the
  wrong first answer is usually the most useful part.
- **Claims carry their evidence.** A number in an ADR or a commit message
  should come from something that was run, and the ADR should say what.
