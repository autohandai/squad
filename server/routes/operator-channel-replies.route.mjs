import { redactSecrets } from '../control-plane/control-plane.mjs';

export const name = 'operator-channel-replies';

async function mirror(ctx, run) {
  const channel = run?.channel;
  if (!channel?.operatorReply || !channel.channelId || !channel.threadId || !['completed', 'failed', 'stopped', 'interrupted'].includes(run.status)) return;
  const body = redactSecrets(String(run.reply || (run.status === 'completed' ? '' : `The member ${run.status === 'failed' ? 'could not complete this reply' : 'was interrupted'}.`))).slice(0, 20000);
  if (!body) return;
  const id = `${run.id}-reply`;
  const current = await ctx.readChannelsState();
  if (current.messages.some(message => message.id === id)) return;
  await ctx.mutateChannelsState(state => {
    const owner = state.channels.find(item => item.id === channel.channelId);
    const thread = state.threads.find(item => item.id === channel.threadId && item.channelId === channel.channelId);
    if (!owner || !thread || state.messages.some(message => message.id === id)) return;
    const at = run.finishedAt || new Date().toISOString();
    const member = state.agentChannelAccess?.[run.agentId]?.agent;
    state.messages.push({ id, channelId: channel.channelId, threadId: channel.threadId, parentMessageId: channel.parentMessageId || '', role: 'agent', agentId: run.agentId, authorName: member?.name || run.agentId, body, status: run.status === 'completed' ? 'complete' : 'error', runId: run.id, workspace: run.workspace || '', createdAt: at, updatedAt: at });
    thread.replyCount = Number(thread.replyCount || 0) + 1;
    thread.updatedAt = at;
    owner.updatedAt = at;
  });
}

export async function init(ctx) {
  ctx.events.on('run.finished', ({ runId }) => {
    void mirror(ctx, ctx.runs.get(runId)).catch(error => ctx.logEvent(ctx.SEVERITY.WARN, `Channel reply could not be saved: ${error.message}`, { 'event.name': 'operator.channel_reply.failed' }));
  });
  for (const run of ctx.runs.values()) await mirror(ctx, run);
}

export async function handle() { return false; }
