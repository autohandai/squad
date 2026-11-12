import { realpath } from 'node:fs/promises';
import { createManagementTools, MANAGED_MANAGEMENT_NAMES } from '../control-plane/management.mjs';
import { DEFAULT_BUILT_IN_TOOL_POLICIES } from '../../src/lib/permission-policy.js';

const refused = message => Object.assign(new Error(message), { status: 403 });

// Both MCP surfaces use the same operator routes. This adapter adds the
// executing member's current policy and bounded, operation-specific consent.
export function createSquadManagement({ actions, request, askPerson, timeoutMs = 24_000 }) {
  return async (toolName, input, session, assertCurrent) => {
    const signal = AbortSignal.timeout(timeoutMs);
    const name = toolName.replace(/^squad_/, '');
    if (!MANAGED_MANAGEMENT_NAMES.includes(name)) throw refused('Unsupported Squad-management tool.');
    const args = structuredClone(input);
    let approved = false;
    async function actor() {
      signal.throwIfAborted();
      assertCurrent();
      const saved = await actions().memberAccess(session.memberId);
      if (!saved?.agent || saved.removed) throw refused('The acting member is no longer available.');
      const permissions = saved.agent.permissions || {};
      const policy = permissions.workspaceOverrides?.[session.workspace]?.builtInPolicies?.[toolName]
        ?? permissions.builtInPolicies?.[toolName] ?? DEFAULT_BUILT_IN_TOOL_POLICIES[toolName] ?? 'ask';
      if (policy === 'block') throw refused('Member management is blocked by your saved tool permissions.');
      return { agent: saved.agent, policy };
    }
    const initial = await actor();
    if (initial.policy !== 'allow') {
      if (!askPerson) throw refused('This operation needs the person’s confirmation in Squad or an Allow tool setting.');
      const response = await askPerson({ runId: session.runId, memberId: session.memberId,
        question: `${initial.agent.name} requests ${toolName}:\n${JSON.stringify(args).slice(0, 1750)}`,
        options: ['Allow once', 'Deny'], waitMs: 15_000 });
      if (response?.status !== 'answered' || response.answer !== 'Allow once') throw refused('Not applied: the person did not approve this operation.');
      approved = true;
    }
    async function checked(path, method = 'GET', value) {
      if (path.startsWith('/api/group-chats')) {
        const scoped = new URL(path, 'http://localhost');
        scoped.searchParams.set('actor_id', session.memberId);
        path = scoped.pathname + scoped.search;
      }
      const current = await actor();
      if (current.policy !== 'allow' && !approved) throw refused('Permissions changed; ask the person before retrying.');
      if (method !== 'GET' && value?.workspace) {
        let target = current.agent;
        if (path === '/api/routines') target = (await actions().memberAccess(value.memberId))?.agent;
        if (path.startsWith('/api/routines/')) {
          const routine = await request(path, 'GET', undefined, { signal });
          target = (await actions().memberAccess(routine.memberId))?.agent;
        }
        const folders = [...(target?.projects || []).map(project => project.path), target?.workspace].filter(Boolean);
        const requestedFolders = path.endsWith('/workspace') && Array.isArray(value.directories)
          ? [value.workspace, ...value.directories] : [value.workspace];
        const permitted = await Promise.all(folders.map(folder => realpath(folder).catch(() => '')));
        const requested = await Promise.all(requestedFolders.map(folder => realpath(folder)));
        if (requested.some(folder => !permitted.includes(folder))) throw refused('Choose folders already assigned to the acting member; management does not grant a new folder.');
        if (path.endsWith('/workspace')) {
          const targetId = decodeURIComponent(path.split('/')[4]);
          const targetAccess = await actions().memberAccess(targetId);
          if (!targetAccess?.agent || targetAccess.removed) throw refused('The target member is no longer available.');
          const targetFolders = [...(targetAccess.agent.projects || []).map(project => project.path), targetAccess.agent.workspace].filter(Boolean);
          const granted = await Promise.all(targetFolders.map(folder => realpath(folder).catch(() => '')));
          if (requested.some(folder => !granted.includes(folder))) throw refused('Choose folders already assigned to the target member. Broader folder grants require the person’s operator connection or app.');
        }
      }
      const latest = await actor();
      if (latest.policy !== 'allow' && !approved) throw refused('Permissions changed; ask the person before retrying.');
      assertCurrent();
      const result = await request(path, method, value, { signal });
      signal.throwIfAborted();
      assertCurrent();
      return result;
    }
    if (name === 'create_member') {
      args.request_id = `${session.memberId}:${args.request_id}`;
      const folders = [initial.agent.workspace, ...(initial.agent.projects || []).map(project => project.path)].filter(Boolean);
      args.workspace ??= folders.includes(session.workspace) ? session.workspace : folders[0] || '';
    }
    if (name === 'create_group_chat' && args.request_id) args.request_id = `${session.memberId}:${args.request_id}`;
    const tools = createManagementTools({ get: path => checked(path), post: (path, value) => checked(path, 'POST', value), patch: (path, value) => checked(path, 'PATCH', value), delete: path => checked(path, 'DELETE') });
    return tools[name](args);
  };
}
