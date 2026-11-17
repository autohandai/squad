#!/usr/bin/env node
// The agent marketplace (ADR-0246), pure parts: the template validator, the
// canonical hash, deep links and pasted links, and Grok Bot page parsing.
// Bridge and browser checks live in check-marketplace-bridge.mjs and
// check-marketplace-browser.mjs.

import assert from "node:assert/strict";
import {
  APP_ROUTE_PREFIX, ATTRIBUTION_ID, CATEGORIES, TEAM_APP_ROUTE_PREFIX, listingSummary, newAttributionId, teamTemplateFindings, teamTemplateFromMembers, validateTeamTemplate, appRouteForRequest, buildDeepLink, canonicalJson, contentHash, grokTemplate, memberTemplateFindings, parseDeepLink,
  parseGrokBotPage, parseMarketplaceLink, requestFromAppRoute, seedListingId, templateFromMember, validateAgentTemplate, validateListingInput,
} from "../src/lib/marketplace.js";
import { validateTeamFile } from "../src/lib/teams.js";

const member = {
  name: "Quill", role: "Release notes writer", description: "Writes release notes.", instructions: "Act as a release notes writer.",
  brainCard: { purpose: "Write release notes." }, look: { avatar: "/avatars/birds/tui.webp", employeeType: "" }, skills: ["release-checklist"], harness: { id: "autohand" },
};
const skill = { name: "release-checklist", description: "Checks a release.", text: "---\nname: release-checklist\ndescription: Checks a release.\n---\n\n# Release checklist\n" };

// --- templates ---------------------------------------------------------------
{
  const document = templateFromMember({ member, skills: [skill], tagline: "Turns merged changes into notes." });
  const result = validateAgentTemplate(document);
  assert.ok(result.ok, result.error);
  assert.equal(result.document.members.length, 1);
  assert.equal(result.document.team.lead, "Quill");
  assert.ok(validateTeamFile(result.document).ok, "a template is a team file Import team reads");
  // Key order and whitespace do not change the hash; content does.
  const reverse = (value) => Array.isArray(value) ? value.map(reverse) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).reverse().map((key) => [key, reverse(value[key])])) : value;
  const reordered = reverse(result.document);
  assert.notEqual(JSON.stringify(reordered), JSON.stringify(result.document));
  assert.equal(canonicalJson(reordered), canonicalJson(result.document));
  assert.equal(await contentHash(reordered), await contentHash(result.document));
  const changed = structuredClone(result.document); changed.members[0].instructions += ".";
  assert.notEqual(await contentHash(changed), await contentHash(result.document));
  assert.match(await contentHash(result.document), /^[a-f0-9]{64}$/);

  const refuse = (value, pattern) => { const outcome = validateAgentTemplate(value); assert.equal(outcome.ok, false); assert.match(outcome.error, pattern); return outcome; };
  refuse({ ...result.document, members: [...result.document.members, { ...result.document.members[0], name: "Two" }] }, /exactly one member/);
  refuse({ ...result.document, channels: [{ name: "general" }] }, /no place for channels/);
  refuse({ ...result.document, members: [{ ...result.document.members[0], look: { avatar: "/uploads/me.png" } }] }, /Squad birds/);
  refuse({ ...result.document, skills: [] }, /release-checklist is named but its SKILL.md/);
  refuse({ ...result.document, format: "something-else" }, /autohand.squad-team/);
  refuse("{not json", /not JSON/);
  const secret = refuse({ ...result.document, members: [{ ...result.document.members[0], notes: "Use password: hunter2-very-secret" }] }, /members\[0\]\.notes/);
  assert.equal(secret.code, "template_secrets");
  refuse({ ...result.document, skills: Array.from({ length: 11 }, (_, index) => ({ ...skill, name: `s${index}` })) }, /at most 10 skills/);
  refuse({ ...result.document, members: [{ ...result.document.members[0], notes: "x".repeat(4001) }] }, /Starter memory/);
  const big = structuredClone(result.document); big.skills[0].text = `---\nname: release-checklist\n---\n${"word ".repeat(13000)}`;
  big.members[0].instructions = "y ".repeat(9000);
  big.skills.push(...Array.from({ length: 4 }, (_, index) => ({ name: `bulk-${index}`, description: "", text: "z ".repeat(30000) })));
  refuse(big, /256 KB/);
  // Building a team file redacts silently, so the raw inputs are scanned first.
  const leaky = { ...member, instructions: "Deploy with api_key=abcd1234efgh5678." };
  assert.ok(validateAgentTemplate(templateFromMember({ member: leaky, skills: [skill] })).ok, "the built document no longer shows the key");
  assert.deepEqual(memberTemplateFindings({ member: leaky, skills: [skill] }).map((finding) => finding.path), ["members[0].instructions"]);
  assert.deepEqual(memberTemplateFindings({ member, skills: [{ ...skill, text: `${skill.text}\nghp_${"a".repeat(36)}` }] }).map((finding) => finding.path), ["skills[0].text"]);
  assert.deepEqual(memberTemplateFindings({ member, skills: [skill], notes: "password: hunter2-very-secret" }).map((finding) => finding.path), ["members[0].notes"]);
  assert.deepEqual(memberTemplateFindings({ member, skills: [skill] }), []);
  // Unknown fields cannot ride along: the allowlist rebuilds the member.
  const extra = validateAgentTemplate({ ...result.document, members: [{ ...result.document.members[0], permissions: { level: "full" }, workspace: "/private/x" }] });
  assert.ok(extra.ok); assert.equal(extra.document.members[0].permissions, undefined); assert.equal(extra.document.members[0].workspace, undefined);
}

// --- listings ----------------------------------------------------------------
{
  assert.equal(CATEGORIES.length, 10);
  assert.ok(validateListingInput({ tagline: "Writes notes.", category: "engineering", tags: ["Release Notes", "release notes"] }).ok);
  assert.deepEqual(validateListingInput({ tagline: "Writes notes.", category: "engineering", tags: ["Release Notes", "release notes"] }).listing.tags, ["release-notes"]);
  assert.match(validateListingInput({ tagline: "", category: "engineering" }).error, /tagline/);
  assert.match(validateListingInput({ tagline: "x".repeat(141), category: "engineering" }).error, /140/);
  assert.match(validateListingInput({ tagline: "ok", category: "astrology" }).error, /category/);
  assert.match(validateListingInput({ tagline: "token=abcd1234efgh", category: "engineering" }).error, /tagline/);
  assert.equal(await seedListingId("engineering-flaky-tests"), await seedListingId("engineering-flaky-tests"));
  assert.match(await seedListingId("x"), /^[a-z0-9]{12}$/);
}

// --- links ---------------------------------------------------------------------
{
  const hash = "a".repeat(64);
  const link = buildDeepLink({ id: "abcdefgh1234", version: 3, sha256: hash });
  assert.equal(link, `squad://app/v1/agent-template?id=abcdefgh1234&version=3&sha256=${hash}`);
  assert.deepEqual(parseDeepLink(link), { kind: "marketplace", listing: "agent", id: "abcdefgh1234", version: 3, sha256: hash });
  assert.equal(appRouteForRequest(parseDeepLink(link)), `${APP_ROUTE_PREFIX}abcdefgh1234?version=3&sha256=${hash}`);
  assert.deepEqual(requestFromAppRoute("/marketplace/agents/abcdefgh1234", `?version=3&sha256=${hash}`), { kind: "marketplace", listing: "agent", id: "abcdefgh1234", version: 3, sha256: hash });
  for (const bad of [
    "squad://app/v1/agent-template?id=ABCDEFGH1234", "squad://app/v1/agent-template?id=abc", "squad://evil/v1/agent-template?id=abcdefgh1234",
    "squad://app/v1/agent-template/../x?id=abcdefgh1234", "squad://app/v2/agent-template?id=abcdefgh1234", "https://app/v1/agent-template?id=abcdefgh1234",
    "squad://app/v1/agent-template?id=abcdefgh1234&url=https://evil.example", "squad://app/v1/agent-template?id=abcdefgh1234&id=zzzzzzzzzzzz",
    "squad://app/v1/agent-template?id=abcdefgh1234&sha256=xyz", "squad://app/v1/agent-template?id=abcdefgh1234&version=0", "squad://user:pw@app/v1/agent-template?id=abcdefgh1234",
    "squad://app:99/v1/agent-template?id=abcdefgh1234", `squad://app/v1/agent-template?id=abcdefgh1234#x`, `squad://app/v1/agent-template?id=abcdefgh1234&pad=${"x".repeat(600)}`, "", null,
  ]) assert.equal(parseDeepLink(bad), null, `refuses ${String(bad).slice(0, 80)}`);
  assert.equal(requestFromAppRoute("/marketplace/agents/abcdefgh1234", "?next=/settings"), null);

  assert.deepEqual(parseMarketplaceLink("abcdefgh1234"), { kind: "marketplace", listing: "agent", id: "abcdefgh1234" });
  assert.deepEqual(parseMarketplaceLink("https://autohand.ai/squad/marketplace/abcdefgh1234/?utm_source=x"), { kind: "marketplace", listing: "agent", id: "abcdefgh1234" });
  assert.deepEqual(parseMarketplaceLink("https://x.ai/bot/pXNvc_U2cGyZmheYrUuF_"), { kind: "grok", id: "pXNvc_U2cGyZmheYrUuF_", url: "https://x.ai/bot/pXNvc_U2cGyZmheYrUuF_" });
  assert.deepEqual(parseMarketplaceLink("grokbot://app/v1/bot-template?id=pXNvc_U2cGyZmheYrUuF_"), { kind: "grok", id: "pXNvc_U2cGyZmheYrUuF_", url: "https://x.ai/bot/pXNvc_U2cGyZmheYrUuF_" });
  for (const bad of ["https://evil.example/squad/marketplace/abcdefgh1234", "http://x.ai/bot/pXNvc_U2cGyZmheYrUuF_", "https://x.ai/legal/terms", "https://x.ai.evil.example/bot/pXNvc_U2cGyZmheYrUuF_", "javascript:alert(1)", "file:///etc/passwd", "https://autohand.ai/pricing/"]) {
    assert.equal(parseMarketplaceLink(bad).kind, "invalid", bad);
  }
}

// --- Grok Bot pages -------------------------------------------------------------
{
  // The shape observed on x.ai on 17 Nov 2026 (ADR-0246), with invented content:
  // escaped JSON in a script string plus Open Graph tags.
  const id = "Zq3Lk9TestBot_01";
  const data = { id, ownerType: "USER", sharerName: null, botName: "tide clock", description: "Plans a fishing day around tides & weather, and says when \"not\" to go.", addHref: `grokbot://app/v1/bot-template?id=${id}`, color: "#22AA88", shape: "wave" };
  const payload = `47:["$","$L5e",null,{"state":{"queries":[{"state":{"data":${JSON.stringify(data)}},"queryKey":["bot-template","${id}"]}]}}]`;
  const page = `<html><head><title>tide clock</title><meta property="og:url" content="https://x.ai/bot/${id}"/><meta property="og:title" content="tide clock"/><meta name="description" content="Plans a fishing day around tides &amp; weather..."/></head><body><script>self.__next_f.push([1,${JSON.stringify(payload)}])</script></body></html>`;
  const bot = parseGrokBotPage(page, id);
  assert.equal(bot.source, "page-data");
  assert.equal(bot.name, "tide clock");
  assert.equal(bot.description, data.description);
  assert.equal(bot.sharerName, ""); assert.equal(bot.color, "#22AA88");
  assert.equal(parseGrokBotPage(page, "SomeOtherBot1"), null, "a page for another bot is refused");
  const metaOnly = parseGrokBotPage(page.replace(/<script>[\s\S]*<\/script>/, ""), id);
  assert.equal(metaOnly.source, "meta"); assert.equal(metaOnly.name, "tide clock"); assert.equal(metaOnly.description, "Plans a fishing day around tides & weather...");
  assert.equal(parseGrokBotPage("<html><title>Not found</title></html>", id), null);
  const starter = validateAgentTemplate(grokTemplate(bot));
  assert.ok(starter.ok, starter.error);
  assert.equal(starter.document.members[0].role, "Grok Bot template");
  assert.match(starter.document.members[0].instructions, /by a Grok Bot user \(https:\/\/x\.ai\/bot\/Zq3Lk9TestBot_01\)/);
  assert.match(starter.document.members[0].instructions, /Grok does not publish a bot's own instructions/);
  const pasted = validateAgentTemplate(grokTemplate({ ...bot, sharerName: "Mere" }, { instructions: "You plan tides first, weather second." }));
  assert.match(pasted.document.members[0].instructions, /^You plan tides first/);
  assert.match(pasted.document.members[0].instructions, /by Mere/);
}

// --- team templates and attribution (ADR-0248) ------------------------------------
{
  const teammate = (name, bird, skillName) => ({ member: { ...member, key: name.toLowerCase(), name, look: { avatar: `/avatars/birds/${bird}.webp`, employeeType: "" }, skills: [skillName] }, skills: [{ ...skill, name: skillName, text: skill.text.replace("release-checklist", skillName) }] });
  const members = [teammate("Quill", "tui", "release-checklist"), teammate("Rua", "kea", "triage-pass"), teammate("Mere", "kiwi", "notes-pass")];
  const document = teamTemplateFromMembers({ name: "Release desk", tagline: "Three people for a release.", lead: "Rua", members, channels: [{ name: "release" }] });
  const result = validateTeamTemplate(document);
  assert.ok(result.ok, result.error);
  assert.equal(result.document.team.lead, "Rua");
  assert.equal(result.document.members.length, 3);
  assert.deepEqual(result.document.channels.map((channel) => [channel.name, channel.members.length]), [["release", 3]]);
  assert.ok(validateTeamFile(result.document).ok, "a team template is a team file Import team reads");
  assert.equal(validateAgentTemplate(result.document).ok, false, "an agent-only reader refuses a team");
  const summary = listingSummary("team", result.document);
  assert.equal(summary.role, "Team of 3"); assert.equal(summary.bird, "kea", "the lead's face leads"); assert.deepEqual(summary.members.map((item) => item.lead), [false, true, false]);
  const refuse = (value, pattern) => { const outcome = validateTeamTemplate(value); assert.equal(outcome.ok, false, String(pattern)); assert.match(outcome.error, pattern); return outcome; };
  refuse({ ...result.document, members: result.document.members.slice(0, 1) }, /2 to 8 members/);
  refuse({ ...result.document, members: Array.from({ length: 9 }, (_, index) => ({ ...result.document.members[0], key: `m${index}`, name: `M${index}` })) }, /2 to 8 members/);
  refuse({ ...result.document, routines: [{ title: "Nightly", member: "Rua" }] }, /no place for routines/);
  refuse({ ...result.document, connectors: [{ name: "x", kind: "url", url: "https://example.test" }] }, /no place for connectors/);
  refuse({ ...result.document, workflows: [{ name: "w", channel: "release", steps: [] }] }, /no place for workflows/);
  refuse({ ...result.document, channels: Array.from({ length: 4 }, (_, index) => ({ name: `c${index}`, members: [] })) }, /at most 3 channels/);
  refuse({ ...result.document, skills: [...result.document.skills, { ...skill, name: "orphan-skill" }] }, /no member uses it/);
  refuse({ ...result.document, members: [...result.document.members.slice(0, 2), { ...result.document.members[2], name: "Quill" }] }, /share a name/);
  refuse({ ...result.document, members: [result.document.members[0], { ...result.document.members[1], look: { avatar: "/uploads/me.png" } }, result.document.members[2]] }, /Squad birds/);
  const leaky = refuse({ ...result.document, members: [result.document.members[0], { ...result.document.members[1], notes: "password: hunter2-very-secret" }, result.document.members[2]] }, /members\[1\]\.notes/);
  assert.equal(leaky.code, "template_secrets");
  assert.deepEqual(teamTemplateFindings({ members: [members[0], { ...members[1], notes: "api_key=abcd1234efgh5678" }] }).map((finding) => finding.path), ["members[1].notes"]);
  // Starter memory travels only where it was put.
  assert.equal(validateTeamTemplate(teamTemplateFromMembers({ name: "T", members: [{ ...members[0], notes: "Prefers short notes." }, members[1]] })).document.members[0].notes, "Prefers short notes.");

  const attribution = newAttributionId();
  assert.match(attribution, ATTRIBUTION_ID); assert.notEqual(attribution, newAttributionId());
  const hash = "c".repeat(64);
  const teamLink = buildDeepLink({ id: "abcdefgh1234", version: 2, sha256: hash, attribution, listing: "team" });
  assert.equal(teamLink, `squad://app/v1/team-template?id=abcdefgh1234&version=2&sha256=${hash}&attribution=${attribution}`);
  const parsed = parseDeepLink(teamLink);
  assert.deepEqual(parsed, { kind: "marketplace", listing: "team", id: "abcdefgh1234", version: 2, sha256: hash, attribution });
  assert.equal(appRouteForRequest(parsed), `${TEAM_APP_ROUTE_PREFIX}abcdefgh1234?version=2&sha256=${hash}&attribution=${attribution}`);
  assert.deepEqual(requestFromAppRoute("/marketplace/teams/abcdefgh1234", `?attribution=${attribution}`), { kind: "marketplace", listing: "team", id: "abcdefgh1234", attribution });
  assert.equal(parseDeepLink(`squad://app/v1/agent-template?id=abcdefgh1234&attribution=${attribution}`).attribution, attribution);
  for (const bad of ["squad://app/v1/team-template?id=abcdefgh1234&attribution=short", `squad://app/v1/team-template?id=abcdefgh1234&attribution=${attribution.toUpperCase()}`, "squad://app/v1/teams-template?id=abcdefgh1234", `squad://app/v1/team-template?id=abcdefgh1234&attribution=${attribution}&attribution=${attribution}`]) {
    assert.equal(parseDeepLink(bad), null, bad);
  }
  assert.equal(buildDeepLink({ id: "abcdefgh1234", attribution: "not-valid" }), "squad://app/v1/agent-template?id=abcdefgh1234", "a bad attribution is left out, never passed on");
  assert.deepEqual(parseMarketplaceLink("https://autohand.ai/squad/marketplace/teams/abcdefgh1234/"), { kind: "marketplace", listing: "team", id: "abcdefgh1234" });
}

console.log("check-marketplace: templates, team templates, listings, links, attribution and Grok pages OK");
