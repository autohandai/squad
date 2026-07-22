# Repository Guidance

## Design Guidance

- Before changing visible UI, read `DESIGN.md` and preserve its product style.
- When the user gives a durable UI preference, or when the design contract changes, update `DESIGN.md` in the same change.
- Prefer shadcn/ui primitives from `src/components/ui` and the repo design tokens. If a needed shadcn component is missing, add it through the shadcn registry setup before hand-rolling a custom primitive.
- Avoid bento-style layouts, boxed dashboards, and card-heavy surfaces. Do not frame every designated area with borders, tinted backgrounds, or separate panel colors.
- Use whitespace, typography, alignment, subtle dividers, and simple controls to create hierarchy.
- Keep corners restrained. Avoid exaggerated bevels, overly rounded cards, and pill-like containers unless the existing component contract requires them.
- Default to a Notion-like minimal product surface: functional, calm, neutral, and direct.
