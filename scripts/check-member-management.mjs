import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSquadManagement } from '../server/team/member-management.mjs';
import { PersonQuestions } from '../server/questions.mjs';
import { patchedProfileText } from '../server/routes/member-shaping.route.mjs';
import { memberWithWorkspaces } from '../server/member-workspaces.mjs';

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

const workspaceRoot = await mkdtemp(join(tmpdir(), 'squad-managed-workspaces-'));
try {
  const first = join(workspaceRoot, 'first'), second = join(workspaceRoot, 'second'), outside = join(workspaceRoot, 'unassigned');
  for (const path of [first, second, outside]) await mkdir(path);
  agent.workspace = first; agent.projects = [{ path: first }, { path: second }];
  const target = { id: 'child', workspace: first, projects: [{ path: first }, { path: second }] };
  actions.memberAccess = async id => ({ agent: id === session.memberId ? agent : target });
  permissions.squad_set_member_workspace = 'ask'; approved = false;
  const before = mutations.length;
  const changeFolders = directories => manage('squad_set_member_workspace', { member_id: 'child', workspace: first, directories }, session, assertCurrent);
  await assert.rejects(() => changeFolders([second]), /did not approve/);
  approved = true;
  await changeFolders([second]);
  assert.equal(mutations.length, before + 1);
  assert.deepEqual(mutations.at(-1).value.directories, [second]);
  assert.equal(mutations.at(-1).value.workspace, first);
  permissions.squad_set_member_workspace = 'allow';
  await assert.rejects(() => changeFolders([outside]), /already assigned/);
  assert.equal(mutations.length, before + 1, 'an additional folder cannot escape the acting member grant even in allow mode');
  target.projects = [{ path: first }];
  await assert.rejects(() => changeFolders([second]), /already assigned to the target/);
  assert.equal(mutations.length, before + 1, 'a read-only actor cannot grant a new folder to a more powerful recipient');
  const alias = join(workspaceRoot, 'first-alias'); await symlink(first, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const primaryOnly = { workspace: first, projects: [], permissions: { workspaceOverrides: { [first]: { permissionMode: 'restricted' } } } };
  const equivalent = await memberWithWorkspaces({ homeDir: workspaceRoot, getRuntime: () => ({}), cleanWorkspace: async path => path }, primaryOnly, { workspace: alias, directories: [] });
  assert.equal(equivalent.workspace, first, 'a primary-only assignment preserves its restrictive permission locator');
  assert.deepEqual(equivalent.permissions, primaryOnly.permissions);
  console.log('PASS: workspace replacement needs saved consent and checks every additional folder against both member scopes.');
} finally { await rm(workspaceRoot, { recursive: true, force: true }); }
