import assert from 'node:assert/strict';
import { createSquadManagement } from '../server/team/member-management.mjs';
import { PersonQuestions } from '../server/questions.mjs';
import { patchedProfileText } from '../server/routes/member-shaping.route.mjs';

const profileText = 'Name: Eva\nResponsibilities: Old remit\nOperating instructions: Old instruction\nBrain card fields for this run:\n';
const corrected = patchedProfileText(profileText, { description: 'New remit', instructions: '' });
assert(corrected.includes('Responsibilities: New remit'));
assert(!corrected.includes('Old instruction'));

const policy = 'squad_update_member_profile';
let permissions = { [policy]: 'block' }, active = true, approved = false, afterRead;
const mutations = [];
const agent = { id: 'manager', name: 'Manager', permissions: { builtInPolicies: permissions } };
const actions = { memberAccess: async () => ({ agent }) };
const manage = createSquadManagement({ actions: () => actions,
  askPerson: async () => { if (afterRead) afterRead(); return { status: 'answered', answer: approved ? 'Allow once' : 'Deny' }; },
  request: async (path, method, value) => {
    if (method === 'GET') { if (afterRead) afterRead(); return { id: 'child', revision: 1 }; }
    mutations.push({ path, value }); return { id: 'child', revision: 2 };
  } });
const session = { memberId: 'manager', runId: 'run-1', workspace: process.cwd() };
const assertCurrent = () => { if (!active) throw Error('The turn ended.'); };
const update = () => manage(policy, { member_id: 'child', name: 'Tatiana' }, session, assertCurrent);
await assert.rejects(update, /blocked/);
permissions[policy] = 'ask';
await assert.rejects(update, /did not approve/);
approved = true;
await update();assert.equal(mutations.length, 1);
afterRead = () => { active = false; };
await assert.rejects(update, /turn ended/);assert.equal(mutations.length, 1);
active = true;afterRead = () => { permissions[policy] = 'block'; };
await assert.rejects(update, /blocked/);assert.equal(mutations.length, 1);
permissions[policy] = 'allow';
// A change after profile retrieval must still fence the later PATCH.
await assert.rejects(update, /blocked/);assert.equal(mutations.length, 1);
permissions[policy] = 'allow';afterRead = null;
agent.permissions.workspaceOverrides = { [session.workspace]: { builtInPolicies: { [policy]: 'block' } } };
await assert.rejects(update, /blocked/);assert.equal(mutations.length, 1);
delete agent.permissions.workspaceOverrides;
await update();assert.equal(mutations.length, 2);

const timed = createSquadManagement({ actions: () => actions, timeoutMs: 5,
  request: async (_path, _method, _value, { signal }) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve({ id: 'child', revision: 1 }), 100);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  }) });
await assert.rejects(() => timed(policy, { member_id: 'child', name: 'Late' }, session, assertCurrent), /timeout/i);
assert.equal(mutations.length, 2, 'a timed-out read cannot reach a later write');

const questions = new PersonQuestions({ waitMs: 1000 });
let requestId;
const detach = questions.attach('bounded', event => { if (event.type === 'question_request') requestId = event.requestId; });
const answer = await questions.ask({ runId: 'bounded', agentId: 'manager', question: 'Allow this saved change?', options: ['Allow once', 'Deny'], waitMs: 5 });
assert.equal(answer.status, 'unanswered');
assert.throws(() => questions.answer(requestId, 'Allow once'), /no longer|not found|closed/i);
detach();
permissions.squad_create_member = 'allow';
await manage('squad_create_member', { request_id: 'no-folder', name: 'Eva', role: 'QA' }, session, assertCurrent);
assert.equal(mutations.at(-1).value.workspace, '', 'a conversation-only actor creates no implicit folder grant');
const beforeEscape = mutations.length;
await assert.rejects(() => manage('squad_create_member', { request_id: 'escape', name: 'Eva', role: 'QA', workspace: process.cwd() }, session, assertCurrent), /already assigned/);
assert.equal(mutations.length, beforeEscape);
console.log('PASS: block/ask/allow, workspace overrides, stopped turns, permission revocation, before-write fencing and bounded consent.');
