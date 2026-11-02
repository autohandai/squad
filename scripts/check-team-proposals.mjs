#!/usr/bin/env node
// A member's squad_propose_team arguments become the proposal New team already
// imports (ADR-0161). Deterministic; no bridge.
import assert from "node:assert/strict";

import { TeamProposalError, memberTeamProposal, teamProposalReceipts, teamProposalSummary } from "../src/lib/team-proposals.js";
import { teamDocumentFromProposal } from "../src/lib/team-builder.js";
import { validateTeamFile } from "../src/lib/teams.js";
import { roleTemplates } from "../src/lib/member-profiles.js";

{
  const proposal = memberTeamProposal({
    name: "CST compliance",
    objective: "Design and run the customer security and trust practice in the cst repo.",
    members: [
      { role: "Answers Curator", purpose: "Owns answers/ as the canonical source of truth and its review cadence." },
      { role: "SOC 2 Auditor", purpose: "Maps controls to SOC 2 criteria and keeps evidence current.", skills: ["soc2-audit"] },
      { role: "ISO 27001 Auditor", purpose: "Maps the ISMS to ISO 27001 Annex A." },
      { name: "Eva", role: "QA Engineer", purpose: "Tests the trust centre and questionnaire exports." },
    ],
    lead: "Answers Curator",
  }, { existingNames: ["Chief of Staff", "Eva"], roleTemplates });
  assert.equal(proposal.kind, "member");
  assert.equal(proposal.name, "CST compliance");
  assert.equal(proposal.members.length, 4);
  assert.deepEqual(proposal.members.map((member) => member.name), ["Answers Curator", "SOC 2 Auditor", "ISO 27001 Auditor", "Eva 2"], "a missing name is the role; a taken name is numbered");
  assert.equal(proposal.leadKey, proposal.members[0].key);
  assert.equal(proposal.members[3].templateId, "common-qa-engineer", "a role that matches a built-in template takes it");
  assert.ok(proposal.members[3].skills.length > 0, "and its catalog skills");
  assert.deepEqual(proposal.members[1].skills, ["soc2-audit"], "given skills are kept");
  assert.equal(proposal.channel.section, "Teams");
  assert.match(teamProposalSummary(proposal, "Chief of Staff"), /^Chief of Staff proposes the CST compliance team: Answers Curator \(Answers Curator\), SOC 2 Auditor/);

  // The same document New team imports, valid for the same validator.
  const document = teamDocumentFromProposal(proposal, { roleTemplates, app: "autohand-squad" });
  const validated = validateTeamFile(document);
  assert.equal(validated.ok, true, JSON.stringify(validated.problems || validated.error || validated));
  assert.equal(document.members.length, 4);
  assert.equal(document.team.lead, "Answers Curator");
  assert.ok(document.members[0].instructions.includes("Owns answers/"), "the purpose reaches the member's instructions");
  assert.ok(document.channels[0].members.includes("Eva 2"));
}

{
  const fail = (raw, pattern) => assert.throws(() => memberTeamProposal(raw), (error) => error instanceof TeamProposalError && pattern.test(error.message), String(pattern));
  fail(null, /objective and members/);
  fail({ members: [{ role: "x", purpose: "y" }] }, /objective/);
  fail({ objective: "o", members: [] }, /at least one member/);
  fail({ objective: "o", members: Array.from({ length: 9 }, () => ({ role: "r", purpose: "p" })) }, /at most 8/);
  fail({ objective: "o", members: [{ purpose: "p" }] }, /needs a role/);
  fail({ objective: "o", members: [{ role: "Auditor" }] }, /Auditor needs a purpose/);
  // The pinned CLI can hand members over as JSON strings; "Role: purpose" works too.
  const stringy = memberTeamProposal({ objective: "o", members: [
    JSON.stringify({ role: "SOC 2 Auditor", purpose: "Maps controls to SOC 2." }),
    "ISO 27001 Auditor: Maps the ISMS to Annex A.",
    "Eva (QA Engineer) — Tests the exports.",
  ] });
  assert.deepEqual(stringy.members.map((member) => [member.name, member.role, member.purpose]), [["SOC 2 Auditor", "SOC 2 Auditor", "Maps controls to SOC 2."], ["ISO 27001 Auditor", "ISO 27001 Auditor", "Maps the ISMS to Annex A."], ["Eva", "QA Engineer", "Tests the exports."]]);
  fail({ objective: "o", members: ["just words"] }, /Member 1 must be an object/);
  // The placeholder word taken literally (0.9.9 produced "Role: Frontend Developer — owns the pages").
  const literal = memberTeamProposal({ objective: "o", members: ["Role: Frontend Developer — owns the HTML, CSS and JS.", "Role: QA Engineer: verifies the order flow."] });
  assert.deepEqual(literal.members.map((member) => [member.role, member.purpose]), [["Frontend Developer", "owns the HTML, CSS and JS."], ["QA Engineer", "verifies the order flow."]]);
  // A team without a name is named after its first role.
  assert.equal(memberTeamProposal({ objective: "o", members: [{ role: "Release Manager", purpose: "p" }] }).name, "Release Manager team");
}

{
  const receipts = [
    { type: "team", status: "proposed", proposal: { members: [{}] } },
    { type: "team", status: "failed", message: "no" },
    { type: "profile", status: "applied", patch: {} },
    { type: "team", status: "proposed", proposal: { members: [] } },
  ];
  assert.equal(teamProposalReceipts(receipts).length, 1, "only undecided proposals with members render a card");
  assert.equal(teamProposalReceipts(undefined).length, 0);
}

console.log("check-team-proposals: ok");
