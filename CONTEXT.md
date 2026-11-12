# Adaptive skills domain vocabulary

Scope: terminology for the accepted [adaptive skills design](docs/superpowers/specs/2026-11-02-adaptive-skills-design.md), extending Squad's existing domain contracts.

| Term | Meaning |
| --- | --- |
| Skill | A portable package of reusable instructions and supporting resources. |
| Skill library | The durable collection of packages available under current source and scope policies. |
| Catalog | Searchable metadata derived from the library. The catalog is not the startup prompt. |
| Skill identity | Stable origin authority and package identity, independent of display name and current location. |
| Alias | A human-facing name that resolves under existing precedence rules. |
| Package revision | An immutable digest of the complete included package manifest and resource contents. |
| Locator | The current authorized place from which a package or resource can be resolved. |
| Scope | The personal, project, member, or explicitly shared boundary governing visibility and use. |
| Discovery | Finding authorized candidate skills, including an explicit no-match result. |
| Selection | Choosing a candidate for a task; selection is not loading. |
| Preparation | Resolving and validating the exact instructions and resources before attachment. |
| Attachment | Placing a prepared packet in an engine's working context through an observable adapter boundary. |
| Supplied | Instructions handed to an external engine when actual context attachment cannot be attested. |
| Context manifest | The exact skill revisions/resources known to be present in the current observable context. |
| Receipt | A persisted statement of an observed action and its evidence strength, rather than an inference about cognition. |
| Experience | Revision-scoped observations of application, outcome, checks, costs, and corrections. |
| Verified outcome | Task acceptance established by independent observable checks in a recorded environment. |
| Learned draft | A versioned candidate procedure derived from bounded task evidence, not yet verified for reuse. |
| Verified for scope | An exact revision passed fresh-input checks for a declared environment and use. |
| Preferred for scope | Held-out benefit supports ranking that revision more highly within its declared scope. |
| Derivative | A distinct local adaptation preserving its parent's identity and revision as lineage. |
| Decision model | An optional model used for bounded selection/classification, separate from the main task model. |
| Policy epoch | A version of the current provider/account/scope/consent route used to invalidate stale decisions. |
| Goal checkpoint | Existing authoritative persisted progress for an approved goal, including ownership and uncertain actions. |
| Restore | Reconstitute persisted goal metadata and references; this does not authorize execution. |
| Resume | Explicitly continue a restored goal after current ownership, workspace, permission, and revision checks. |
| Teaching | An explicit existing Squad delivery of shared knowledge to recipients, separate from local learning. |

## Ownership and portability

**Account identity**: A person identified by the immutable subject issued by Autohand's identity service. An email address and display name describe the person but do not identify ownership.

**Owner**: The account identity or Autohand team that owns an agent and its saved data. Ownership is distinct from the agent that authored a memory or file.

**Team**: An existing Autohand organization/account whose current human memberships authorize access to team-owned agents. A team is not an agent roster or the older Squad cloud-sync tenant.

**Member**: An agent in a Squad. A member is distinct from a human team membership.

**Ownership context**: One authenticated account identity accessing its personal Squad or one authorized team's Squad.

**Backup**: A versioned portable document containing selected agents, their saved data and managed file contents, with an explicit inventory of exclusions. JSON and YAML encode the same document.

**Legacy recovery**: The explicit import of data saved before its owner was recorded. That data has no inferred owner and is never assigned by signing in.
