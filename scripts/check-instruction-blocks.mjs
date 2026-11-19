#!/usr/bin/env node
// Member instructions longer than a member holds are split, not refused
// (ADR-0257). The 18 Nov failure: the Chief of Staff's `squad_create_member`
// for "Thiago" sent ~3,400 characters of instructions; the tool schema refused
// it twice ("longer than 1200 characters") and the run failed.
import assert from 'node:assert/strict';
import { INSTRUCTIONS_LIMIT, MEMORY_LIMIT, fitInstructions, isContinuation, memoriesWith, replaceContinuations } from '../server/control-plane/instruction-blocks.mjs';
import { MANAGEMENT_TOOLS, createManagementTools } from '../server/control-plane/management.mjs';
import { validateProfileAction } from '../src/lib/member-shaping.js';

const paragraph = n => `Paragraph ${n}. You build stronger relationships with existing Autohand Code users: find engaged customers, reach out personally, collect product feedback and write it down plainly. Never invent a quote or a customer.`;
const brief = Array.from({ length: 16 }, (_, i) => paragraph(i + 1)).join('\n\n');
assert.ok(brief.length > 3000, `the fixture brief is long (${brief.length})`);

// Short instructions are untouched.
assert.deepEqual(fitInstructions('Be brief.'), { instructions: 'Be brief.', blocks: [], split: null });
const exact = 'x'.repeat(INSTRUCTIONS_LIMIT);
assert.equal(fitInstructions(exact).split, null);

// Long ones: instructions fit, cut at a paragraph; nothing is lost or reordered.
const fit = fitInstructions(brief);
assert.ok(fit.instructions.length <= INSTRUCTIONS_LIMIT);
assert.ok(fit.instructions.endsWith('customer.'), 'cut at a paragraph or sentence, not mid-word');
assert.ok(fit.blocks.every(block => block.length <= MEMORY_LIMIT && isContinuation(block)), 'every block fits a memory and is labelled');
assert.match(fit.blocks[0], /\(1\/\d+\): /);
const rebuilt = [fit.instructions, ...fit.blocks.map(block => block.replace(/^[^:]+\): /, ''))].join(' ').replace(/\s+/g, ' ');
assert.equal(rebuilt, brief.replace(/\s+/g, ' '), 'the text survives, in order');
assert.match(fit.split.note, /Tell the person/);
// The kept part passes Squad's own profile validator (the route's check).
assert.equal(validateProfileAction({ op: 'set', name: 'Thiago', role: 'Customer Advocacy Agent', instructions: fit.instructions }).patch.instructions.length, fit.instructions.length);
// A single unbroken run still splits (hard cut).
assert.ok(fitInstructions('y'.repeat(3000)).blocks.every(block => block.length <= MEMORY_LIMIT));
// Deterministic, so a create retried with the same request_id matches.
assert.deepEqual(fitInstructions(brief), fit);

// Memory budget.
assert.throws(() => memoriesWith(fit.blocks, Array(100).fill('m')), /holds 100/);
assert.deepEqual(replaceContinuations([{ text: 'keep me' }, { text: fit.blocks[0] }], ['new block']), ['new block', 'keep me'], 'an update replaces only earlier continuation blocks');

// The tool accepts the long brief and describes the limits.
const create = MANAGEMENT_TOOLS.find(tool => tool.name === 'create_member');
assert.ok(create.inputSchema.properties.instructions.maxLength >= brief.length, 'the schema no longer refuses a long brief');
assert.match(create.description, /instructions 1200 \(longer instructions are split/);
assert.match(create.inputSchema.properties.instructions.description, /Put the essentials first/);

// create_member / update_member_profile through the tool layer.
let posted, patched;
const profiles = { m1: { id: 'm1', revision: 'r1', memories: [{ text: 'likes tea' }, { text: 'Operating instructions, continued (1/1): old' }] } };
const bridge = {
  post: async (path, body) => { posted = body; return { id: 'm-new', created: true }; },
  get: async path => profiles[path.split('/').pop()],
  patch: async (path, body) => { patched = body; return { id: 'm1', revision: 'r2' }; },
};
const tools = createManagementTools(bridge, { list_members: async () => ({ members: [] }) });
const created = await tools.create_member({ request_id: 'thiago-1', name: 'Thiago', role: 'Customer Advocacy Agent', instructions: brief, memories: ['Prefers email'] });
assert.equal(posted.instructions, fit.instructions);
assert.deepEqual(posted.memories, [...fit.blocks, 'Prefers email']);
assert.equal(created.instructionsSplit.memoryBlocks, fit.blocks.length);
const updated = await tools.update_member_profile({ member_id: 'm1', instructions: brief });
assert.deepEqual(patched.memories, [...fit.blocks, 'likes tea'], 'old continuation replaced, other memories kept');
assert.equal(patched.expectedRevision, 'r1');
assert.ok(updated.instructionsSplit);
await tools.update_member_profile({ member_id: 'm1', instructions: 'Short now.' });
assert.deepEqual(patched.memories, ['likes tea'], 'shortening the instructions removes the old continuation blocks');
await tools.update_member_profile({ member_id: 'm1', role: 'Advocate' });
assert.equal(patched.memories, undefined, 'a change without instructions leaves memories alone');

console.log(`check-instruction-blocks: ok (a ${brief.length}-character brief becomes ${fit.instructions.length} characters of instructions and ${fit.blocks.length} labelled memories, in order; updates replace only earlier blocks)`);
