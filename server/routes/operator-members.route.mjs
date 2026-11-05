import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
import { MEMBER_PROFILE_FIELDS, memberProfileRevision, validateProfileAction } from '../../src/lib/member-shaping.js';
import { BUILT_IN_TOOL_POLICY_GROUPS } from '../../src/lib/permission-policy.js';
import { projectsWithFolder } from '../../src/lib/folder-access.js';
import { patchedMemberCopy, patchedProfileText } from './member-shaping.route.mjs';

export const name = 'operator-members';
const MEMBER = /^\/api\/control-plane\/members\/([a-z0-9][a-z0-9_-]{0,79})(?:\/(directories))?$/;
const CAPABILITIES = ['shell.read', 'shell.dev', 'shell.package', 'shell.git_write', 'shell.destructive', 'file.read', 'search.text', 'patch.apply', 'workspace.outside', 'browser.local', 'web.fetch', 'github.remote', 'mcp.connectors'];
const TOOLS = [...new Set(BUILT_IN_TOOL_POLICY_GROUPS.flatMap(group => group.tools.map(([id]) => id)))];
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

function keys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('Expected an object.');
  const extra = Object.keys(value).filter(key => !allowed.includes(key));
  if (extra.length) throw fail(`Unsupported fields: ${extra.join(', ')}.`);
}

async function accessFor(ctx, memberId) {
  const access = await ctx.agentChannelActions.memberAccess(memberId);
  if (!access?.agent || access.removed) throw fail('Member not found.', 404);
  return access;
}

function workspaceFor(ctx, memberId, agent) {
  const latest = [...ctx.runs.values()].filter(run => run.agentId === memberId && run.workspace).sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')))[0];
  return latest?.workspace || agent.workspace || agent.projects?.[0]?.path || '';
}

function publicProfile(ctx, memberId, agent) {
  return {
    id: memberId, revision: memberProfileRevision(agent), name: agent.name || memberId,
    role: agent.role || '', description: agent.description || '', instructions: agent.instructions || '',
    personality: agent.profileFiles?.find(file => file.section === 'persona')?.content || '',
    skills: agent.skills || [], projects: agent.projects || [], workspace: workspaceFor(ctx, memberId, agent),
    permissions: agent.permissions || {}, availableAbilities: { capabilities: CAPABILITIES, tools: TOOLS },
    takesEffect: 'next_turn',
  };
}

function abilityPatch(agent, input) {
  keys(input, ['capabilities', 'tool_policies', 'workspace']);
  const permissions = structuredClone(agent.permissions || {});
  let target = permissions;
  if (input.workspace) {
    const workspace = resolve(input.workspace);
    permissions.workspaceOverrides ||= {};
    target = { ...permissions, ...(permissions.workspaceOverrides[workspace] || {}) };
    delete target.workspaceOverrides;
    permissions.workspaceOverrides[workspace] = target;
  }
  let count = 0;
  for (const [field, known, destination] of [['capabilities', CAPABILITIES, 'modes'], ['tool_policies', TOOLS, 'builtInPolicies']]) {
    if (input[field] === undefined) continue;
    if (!Array.isArray(input[field]) || input[field].length > 200) throw fail(`${field} must be a bounded list.`);
    target[destination] = { ...(target[destination] || {}) };
    for (const policy of input[field]) {
      keys(policy, ['id', 'mode']);
      if (!known.includes(policy.id) || !['allow', 'ask', 'block'].includes(policy.mode)) throw fail(`Unknown ability or mode: ${policy.id}. Use get_member_profile for supported IDs.`);
      target[destination][policy.id] = policy.mode;
      count++;
    }
  }
  if (!count) throw fail('Choose at least one ability to change.');
  return permissions;
}

async function save(ctx, memberId, access, next, profile, expectedRevision) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw fail('expectedRevision is required. Read the profile before editing.');
  const profilePatch = Object.fromEntries(MEMBER_PROFILE_FIELDS.filter(field => JSON.stringify(next[field]) !== JSON.stringify(access.agent[field])).map(field => [field, next[field]]));
  await ctx.agentChannelActions.setAccess(memberId, { agent: next, profile, profilePatch, expectedProfileRevision: expectedRevision });
  const saved = await accessFor(ctx, memberId);
  return publicProfile(ctx, memberId, saved.agent);
}

export async function handle(req, res, url, ctx) {
  if (!url.pathname.startsWith('/api/control-plane/members/')) return false;
  try {
    const match = url.pathname.match(MEMBER);
    if (!match) throw fail('Invalid member route.');
    const [, memberId, action] = match;
    const access = await accessFor(ctx, memberId);
    if (!action && req.method === 'GET') { ctx.json(res, 200, { success: true, data: publicProfile(ctx, memberId, access.agent) }); return true; }
    const body = await ctx.readBody(req);
    let next;
    let profile = access.profile;
    if (action === 'directories' && req.method === 'POST') {
      keys(body, ['operation', 'path', 'expectedRevision']);
      if (!['add', 'remove'].includes(body.operation) || typeof body.path !== 'string' || !body.path.trim()) throw fail('Choose add/remove and an existing folder path.');
      const expanded = body.path.startsWith('~/') ? resolve(ctx.homeDir, body.path.slice(2)) : body.path;
      if (!isAbsolute(expanded)) throw fail('Provide an absolute folder path.');
      const displayPath = resolve(expanded);
      const path = await realpath(displayPath).catch(error => { if (body.operation === 'remove' && error.code === 'ENOENT') return displayPath; throw error; });
      const projects = access.agent.projects || [];
      const roots = await Promise.all(projects.map(item => realpath(item.path).catch(() => resolve(item.path))));
      if (body.operation === 'add') {
        const home = await realpath(ctx.homeDir);
        if (path === home || !path.startsWith(home + sep)) throw fail('Folder must resolve inside the user directory.');
        if (!(await stat(path)).isDirectory()) throw fail('Choose a directory.');
        await ctx.cleanWorkspace(displayPath);
        if (!roots.includes(path) && projects.length >= (ctx.maxProjectsPerMember || 32)) throw fail('The member folder limit has been reached.');
        next = { ...access.agent, projects: roots.includes(path) ? projects : projectsWithFolder(access.agent, displayPath) };
      } else {
        const primary = workspaceFor(ctx, memberId, access.agent);
        if (primary && path === await realpath(primary).catch(() => resolve(primary))) throw fail('Change the primary workspace before removing that folder.');
        if (!roots.includes(path) && !projects.some(item => resolve(item.path) === displayPath)) throw fail('That folder is not granted to this member.');
        next = { ...access.agent, projects: projects.filter((item, index) => roots[index] !== path && resolve(item.path) !== displayPath) };
      }
    } else if (!action && req.method === 'PATCH') {
      keys(body, ['expectedRevision', 'name', 'role', 'description', 'instructions', 'personality', 'skills', 'abilities']);
      const { expectedRevision: _revision, abilities, skills, ...fields } = body;
      if (!Object.keys(fields).length && abilities === undefined && skills === undefined) throw fail('Choose a profile field to change.');
      const patch = Object.keys(fields).length ? validateProfileAction({ op: 'set', ...fields }).patch : {};
      next = patchedMemberCopy(access.agent, patch);
      profile = patchedProfileText(access.profile, patch);
      if (abilities !== undefined) {
        if (abilities.workspace) abilities.workspace = await ctx.cleanWorkspace(abilities.workspace);
        next.permissions = abilityPatch(access.agent, abilities);
      }
      if (skills !== undefined) {
        if (!Array.isArray(skills) || skills.length > 32 || skills.some(id => typeof id !== 'string' || !id.trim() || id.length > 500)) throw fail('Choose at most 32 skill package IDs.');
        const selected = [...new Set(skills)];
        await ctx.validateSkillSelections({ ...access.agent, workspace: workspaceFor(ctx, memberId, access.agent) }, selected);
        next.skills = selected;
      }
    } else throw fail('Method not allowed.', 405);
    const data = await save(ctx, memberId, access, next, profile, body.expectedRevision);
    ctx.json(res, 200, { success: true, data });
  } catch (error) { ctx.json(res, error.status || 400, { success: false, error: error.message }); }
  return true;
}
