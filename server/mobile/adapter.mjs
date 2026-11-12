import { hostname } from 'node:os';
import { z } from 'zod';
import { createBridgeClient, createTools } from '../control-plane/runtime.mjs';

const memberID = z.object({ memberID: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/) });
/** The phone uses the same roster, transcripts and durable queue as MCP/CLI. */
export function createMobileAdapter({ origin, computerID, version, computerName = hostname(), assignTask, announcements }) {
  const bridge = createBridgeClient(origin), tools = createTools(bridge);
  async function member(id) {
    const { members } = await tools.list_members(), found = members.find(row => row.id === id);
    if (!found) throw Error('This member is no longer in this Squad.');
    return found;
  }
  async function requireLocalExecution(id) {
    const remotes = await bridge.get('/api/remote/members');
    if ((Array.isArray(remotes) ? remotes : remotes?.members || []).some(row => row.memberId === id)) {
      throw Error('This member runs on another computer. Pair that computer to send work there from your phone.');
    }
  }
  return {
    assertCurrent: () => bridge.get('/api/ownership/context'),
    execute: async (command, parameters, { deviceID, requestID }) => {
      if (command === 'snapshot') {
        z.object({}).strict().parse(parameters);
        const [{ members }, remotes, context] = await Promise.all([tools.list_members(), bridge.get('/api/remote/members'), bridge.get('/api/ownership/context')]);
        return { computer: { id: computerID, name: computerName, version, connectedAt: new Date().toISOString() },
          capabilities: [...(assignTask ? ['tasks', ...(context.canWrite ? ['delegate'] : [])] : []), ...(announcements ? ['announcements'] : [])],
          ...(context.actor ? { account: { id: context.actor.id, name: context.actor.name || '', email: context.actor.email || '' } } : {}),
          members: members.map(row => {
            const remote = (Array.isArray(remotes) ? remotes : remotes?.members || []).find(remote => remote.memberId === row.id);
            return { id: row.id, name: row.name || row.id, role: row.role || '', presence: row.presence || 'unknown',
              harness: typeof row.harness === 'string' ? row.harness : row.harness?.id || '',
              executionMode: remote ? 'remoteComputer' : 'workspace', computerName: remote?.label || computerName,
              workspace: remote?.workspace || row.lastWorkspace || '' };
          }) };
      }
      if (command === 'conversation') {
        const { memberID: id } = memberID.strict().parse(parameters); await member(id);
        const transcript = await tools.get_conversation({ member_id: id, limit: 30 });
        const turns = [];
        for (const message of transcript.messages || []) {
          if (message.role !== 'user') continue;
          const reply = transcript.messages.find(row => row.requestId === message.requestId && row.role === 'agent');
          turns.push({ id: message.requestId, prompt: message.body || '', reply: reply?.body || '', status: reply?.status || 'queued', error: '' });
        }
        return { turns };
      }
      if (command === 'message') {
        const { memberID: id, text } = memberID.extend({ text: z.string().trim().min(1).max(20000) }).strict().parse(parameters);
        const recipient = await member(id);
        await requireLocalExecution(id);
        if (!recipient.lastWorkspace) throw Error('Choose this member’s workspace in Squad on your computer first.');
        const item = await bridge.post(`/api/queues/${encodeURIComponent(id)}/items`, { text, workspace: recipient.lastWorkspace, clientRequestId: `mobile_${deviceID}_${requestID}` });
        return { messageID: item.id, status: item.status };
      }
      if (command === 'delegate' && assignTask) {
        const input = memberID.extend({ title: z.string().trim().min(1).max(160), detail: z.string().max(2000).default('') }).strict().parse(parameters);
        const recipient = await member(input.memberID);
        await requireLocalExecution(recipient.id);
        const context = await bridge.get('/api/ownership/context');
        if (!context.canWrite || context.state !== 'ready') throw Error('This Squad is read-only. Choose an authorized Squad on your computer before assigning work.');
        const receipt = await assignTask({ from: { id: `person:${context.actor.id}`, name: context.actor.name || 'the person' }, to: recipient,
          title: input.title, detail: input.detail, requestId: `mobile_${deviceID}_${requestID}` });
        return { taskID: receipt.taskId, status: receipt.status === 'done' ? 'completed' : receipt.status, assignee: recipient.id };
      }
      if (command === 'tasks' && assignTask) {
        z.object({}).strict().parse(parameters);
        const { tasks } = await bridge.get('/api/work');
        return { tasks: [...tasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 50).map(task => ({
          id: task.id, title: task.title, detail: task.detail, assignee: task.memberId, updatedAt: task.updatedAt,
          status: task.status === 'done' ? 'completed' : task.status === 'blocked' ? 'failed' : task.status === 'doing' ? 'running' : 'queued',
        })) };
      }
      if (command === 'announcements' && announcements) {
        const { appVersion } = z.object({ appVersion: z.string().regex(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/).max(60).default('0.1.0') }).strict().parse(parameters);
        return announcements.list({ platform: 'ios', version: appVersion });
      }
      if (command === 'announcement.act' && announcements) {
        const { id, action, step } = z.object({ id: z.string().regex(/^[\w-]{1,100}$/), action: z.enum(['seen', 'dismiss']), step: z.number().int().min(0).max(49).default(0) }).strict().parse(parameters);
        return announcements.act(id, action, step);
      }
      throw Error('This action is unavailable from a phone.');
    },
  };
}
