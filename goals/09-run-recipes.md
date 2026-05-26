# Goal 09: Run Recipes

## Outcome

Add reusable workflows for common jobs: fix failing test, review PR, verify UI route, polish landing page, and prepare release.

## Why This Matters

Recipes make high-quality agent behavior repeatable. They encode model choice, tools, permission level, expected evidence, and done criteria.

## Scope

- Create a recipe catalog.
- Each recipe defines model, tools, permission level, context requirements, expected evidence, and done criteria.
- Let users launch recipes from chat, Mission Control, or member profiles.
- Map recipe outputs back to the evidence timeline.
- Recommend recipes based on the user request.

## Acceptance Criteria

- Users can select and launch a recipe.
- Recipe launch shows expected evidence before starting.
- Completed recipe runs show done criteria pass/fail state.
- Recipes can be role-specific.
- Existing run modes remain available.

## Evidence To Capture

- Screenshot of recipe catalog.
- Completed recipe run with evidence and done criteria.
- Example recommended recipe surfaced from a user request.

## Dependencies

- Task Evidence Timeline
- Permission Ladder
- Context Packs
- Evaluation Hooks

## Decisions

- Storage: built-in recipes should ship as versioned local app data. User recipes should live in local Squad/daemon state and be exportable later as portable recipe packages. Do not make recipes full skills initially, but keep the shape compatible with skill-like packaging later.
- Custom recipes: yes. Users should be able to create, edit, duplicate, import, and export custom recipes after the built-in catalog proves the model.
- Agent selection: recipes should recommend one or more agents automatically, but require user confirmation for ad hoc runs. Scheduled automations may use a saved default agent selection.
