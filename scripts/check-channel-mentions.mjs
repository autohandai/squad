#!/usr/bin/env node
// Channel @mentions (bug hunt 2026-10, channels): who a channel message or a
// member's reply reaches, in the browser resolver and the bridge one.
import assert from "node:assert/strict";
import { mentionTokens, resolveMentions, resolveResponderRecipients } from "../src/lib/channel-responders.js";
import { mentionedSquadMembers, mentionsPerson, resolveChannelMentionTargets, targetChipMemberIds, unreachedMentionNote, withoutHereMentions } from "../src/lib/channel-mentions.js";

const agents = [
  { id: "noah", name: "Noah" },
  { id: "iris", name: "Iris" },
  { id: "eva", name: "Eva" },
  { id: "james", name: "James Hill" },
  { id: "kai", name: "Kai" },
];
const channel = { id: "c1", name: "general", memberIds: ["noah", "iris", "eva", "james"], projects: [{ name: "autohandSWE", path: "/work/autohandSWE" }, "/work/leads"], responder: { mode: "everyone" } };
const resolve = (text, options) => resolveChannelMentionTargets(text, channel, agents, options);
const everyone = channel.memberIds;

// An address, a canvas, a file or a project is not a recipient. Each of these
// used to make the message "mentioned" with nobody to send it to, and
// sendChannelPrompt returned without posting it.
for (const text of ["send the report to igor@gmail.com", "update @canvas:test-plan please", "look at @src/App.jsx", "work in @autohandSWE today", "check @leads.", "ping me at a.b+c@example.co.nz"]) {
  const result = resolve(text);
  assert.equal(result.hasMentions, false, text);
  assert.deepEqual(result.targetMemberIds, everyone, text);
  assert.deepEqual(resolveResponderRecipients({ mentions: result, channel }).memberIds, everyone, text);
  assert.equal(resolveMentions(text, agents.filter((agent) => everyone.includes(agent.id)), { projects: channel.projects }).hasMentions, false, `bridge: ${text}`);
}
assert.deepEqual(mentionTokens("igor@gmail.com and @Noah, then @canvas:plan"), ["Noah"]);

// Real mentions still work, with punctuation and first names.
assert.deepEqual(resolve("@Noah. can you look").targetMemberIds, ["noah"]);
assert.deepEqual(resolve("@james and @Iris, mail igor@gmail.com").targetMemberIds, ["james", "iris"]);
assert.deepEqual(resolve("@here standup").targetMemberIds, everyone);
assert.deepEqual(resolve("@autohandSWE @Eva fix it").targetMemberIds, ["eva"]);

// A mention that reaches nobody is said, not swallowed.
const outside = resolve("@Kai can you deploy");
assert.equal(outside.hasMentions, true);
assert.deepEqual(outside.targetMemberIds, []);
assert.equal(unreachedMentionNote(outside, channel, agents), "Kai is not in #general. Add them to the channel to ask them here. Nobody was asked.");
assert.equal(unreachedMentionNote(resolve("@Noha check"), channel, agents), "Nobody in #general is called @Noha. Nobody was asked.");
assert.equal(unreachedMentionNote(resolve("@Noah and @Bob"), channel, agents), "Nobody in #general is called @Bob.");
assert.equal(unreachedMentionNote(resolve("@Noah"), channel, agents), "");

// A member's "@here" does not wake the whole channel through a relay.
assert.equal(withoutHereMentions("@here I finished, @Iris please review"), "here I finished, @Iris please review");
assert.deepEqual(resolve(withoutHereMentions("@here thoughts?")).hasMentions, false);
assert.deepEqual(resolve(withoutHereMentions("@here @Iris please review")).targetMemberIds, ["iris"]);
assert.equal(withoutHereMentions("mail ops@here.com"), "mail ops@here.com");

// "X mentioned you" is for the person, not for every teammate mention.
const person = { name: "igorcosta", email: "igorcosta@gmail.com" };
assert.equal(mentionsPerson("@Eva can you check the build", person), false);
assert.equal(mentionsPerson("Saved to @autohandSWE", person), false);
assert.equal(mentionsPerson("@igorcosta this needs your call", person), true);
assert.equal(mentionsPerson("@here the deploy is out", person), true);
assert.equal(mentionsPerson("mail igorcosta@gmail.com", person), false);

// A target already on screen gets no second chip: the inline @Iris of a root
// message, or the member's own name on its reply.
assert.deepEqual(targetChipMemberIds({ role: "user", body: "@iris can you check the build", targetMemberIds: ["iris"] }, agents), []);
assert.deepEqual(targetChipMemberIds({ role: "user", body: "@James, @Noah. review", targetMemberIds: ["james", "noah"] }, agents), []);
assert.deepEqual(targetChipMemberIds({ role: "agent", agentId: "iris", body: "Done.", targetMemberIds: ["iris"] }, agents), []);
assert.deepEqual(targetChipMemberIds({ role: "user", body: "can you check", targetMemberIds: ["iris"] }, agents), ["iris"]);
assert.deepEqual(targetChipMemberIds({ role: "user", body: "@Iris and the rest", targetMemberIds: ["iris", "eva"] }, agents), ["eva"]);

// A renamed member still answers to the name it went by, in the browser and
// on the bridge, unless someone has that name now.
const renamedAgents = [...agents.filter((agent) => agent.id !== "noah"), { id: "noah", name: "Robert", formerNames: ["Noah", "Max Power"] }];
const renamedResolve = (text) => resolveChannelMentionTargets(text, channel, renamedAgents);
assert.deepEqual(renamedResolve("@Noah can you check").targetMemberIds, ["noah"]);
assert.deepEqual(renamedResolve("@Max can you check").targetMemberIds, ["noah"]);
assert.deepEqual(renamedResolve("@Robert can you check").targetMemberIds, ["noah"]);
assert.deepEqual(resolveMentions("@Noah, please review", renamedAgents.filter((agent) => everyone.includes(agent.id))).targetMemberIds, ["noah"]);
const dm = (text, list = renamedAgents) => mentionedSquadMembers(text, list, "eva").map((agent) => agent.id);
assert.deepEqual(dm("ask @Noah about it"), ["noah"], "a DM @mention of a former name reaches the member");
assert.deepEqual(dm("ask @MaxPower and @max"), ["noah"]);
assert.deepEqual(dm("ask @Iris"), ["iris"]);
assert.deepEqual(dm("ask @Eva", [...renamedAgents, { id: "zed", name: "Zed", formerNames: ["Iris"] }].filter((agent) => agent.id !== "kai")).length, 0, "the active member is not a target");
assert.deepEqual(dm("ask @Iris", [...renamedAgents, { id: "zed", name: "Zed", formerNames: ["Iris"] }]), ["iris"], "whoever has the name now wins in a DM too");
const taken = [...renamedAgents.filter((agent) => agent.id !== "iris"), { id: "iris", name: "Iris", formerNames: ["Eva"] }];
assert.deepEqual(resolveChannelMentionTargets("@Eva look", channel, taken).targetMemberIds, ["eva"], "whoever has the name now wins");
assert.deepEqual(resolveMentions("@Eva look", taken.filter((agent) => everyone.includes(agent.id))).targetMemberIds, ["eva"]);

console.log("Channel mentions passed: addresses, canvases, files and projects are not recipients; unreached mentions are said; members cannot @here; mention alerts are for the person; a target already on screen gets no second chip; former names still reach a renamed member.");
