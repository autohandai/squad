// Durable task intent and execution share the existing per-member queue.
// The task is saved first; the queue deduplicates by task id. A failed write
// leaves a visible blocked commitment, never a claim that work was sent.
import { createHash } from 'node:crypto';
import { taskInputFrom } from './store.mjs';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

export function createTaskAssignments({ work, queue, dispatcher, prepare, emit = () => {} }) {
  let writing = Promise.resolve();
  const serial = operation => {
    const pending = writing.catch(() => {}).then(operation);
    writing = pending;
    return pending;
  };
  const changed = memberId => emit('work.changed', { memberId });

  async function enqueue(task) {
    try {
      const launch = await prepare(task.memberId);
      const item = await queue.enqueue({ ...launch, workTaskId: task.id, _teamDepth: task.assignment?.depth || 1, teamMessage: { ancestorIds: task.assignment?.ancestorIds || [] }, text: [
        `Task from ${task.assignment?.fromName || 'the person'}: ${task.title}`,
        task.detail,
        `This is persisted task ${task.id}. Do the work and report its outcome. Do not send an acknowledgement back as a second task.`,
      ].filter(Boolean).join('\n\n') });
      task.assignment = { ...task.assignment, queueItemId: item.id, state: item.status };
      work.replaceTask(task);
      await work.save();
      changed(task.memberId);
      dispatcher.schedule();
      return { status: item.status, taskId: task.id, queueItemId: item.id, toId: task.memberId, message: `Queued ${task.title}.` };
    } catch (error) {
      const blocked = taskInputFrom({ status: 'blocked', outcome: `Not queued: ${error.message}` }, task, { by: 'bridge' });
      blocked.assignment = { ...task.assignment, state: 'failed' };
      work.replaceTask(blocked);
      await work.save();
      changed(task.memberId);
      throw error;
    }
  }

  return {
    assign: input => serial(async () => {
      await work.load();
      const { from, to, title, detail = '', requestId, depth = 1, ancestorIds = [] } = input;
      if (!from?.id || !to?.id || from.id === to.id) throw fail('Choose another saved member for this task.');
      if (!String(title || '').trim() || title.length > 160 || detail.length > 2000) throw fail('Give the task a title under 160 characters and detail under 2000.');
      const key = createHash('sha256').update(JSON.stringify([from.id, requestId])).digest('hex');
      const digest = createHash('sha256').update(JSON.stringify([to.id, title, detail])).digest('hex');
      const deleted = work.deletedTasks().find(task => task.requestKey === key);
      if (deleted) throw fail('The person deleted this task. This request cannot create it again.', 409);
      let task = work.tasks().find(task => task.assignment?.requestKey === key);
      if (task) {
        if (task.assignment.digest !== digest) throw fail('This request id was already used for different work.', 409);
        if (task.assignment.queueItemId) {
          const item = await queue.get(task.assignment.queueItemId);
          return { status: item.status, taskId: task.id, queueItemId: item.id, toId: task.memberId, duplicate: true };
        }
      } else {
        // Resolve and validate the saved target before recording a commitment.
        await prepare(to.id);
        task = taskInputFrom({ title, detail }, null, { memberId: to.id, source: 'handoff', by: 'member' });
        task.assignment = { fromId: from.id, fromName: from.name || from.id, requestKey: key, digest, queueItemId: '', state: 'pending', depth, ancestorIds };
        work.replaceTask(task);
        await work.save();
      }
      return enqueue(task);
    }),
    enqueue: id => serial(async () => {
      const task = work.task(id);
      if (!task) throw fail('Task not found.', 404);
      if (task.assignment?.queueItemId) throw fail('This task already has a queued or completed run.', 409);
      return enqueue(task);
    }),
    remove: id => serial(async () => {
      const task = work.task(id);
      if (!task) throw fail('Task not found.', 404);
      // Cancel exactly this item before deleting the commitment. A completion
      // event waits for this same lock and cannot put the task back.
      if (task.assignment?.queueItemId) {
        try { await dispatcher.cancelItem(task.assignment.queueItemId, { pause: false }); }
        catch (error) { if (error.status !== 404) throw error; }
      }
      work.removeTask(id);
      await work.save();
      changed(task.memberId);
      return task;
    }),
    sync: id => serial(async () => {
      const item = await queue.get(id);
      if (!item.workTaskId) return;
      const task = work.task(item.workTaskId);
      if (!task || task.memberId !== item.memberId) return;
      const status = item.status === 'done' ? 'done' : item.status === 'running' ? 'doing' : ['failed', 'cancelled'].includes(item.status) ? 'blocked' : 'open';
      const next = taskInputFrom({ status, ...(item.status === 'done' ? { outcome: item.reply } : item.error ? { outcome: item.error } : {}) }, task, { by: 'bridge' });
      next.assignment = { ...task.assignment, queueItemId: id, state: item.status };
      work.replaceTask(next);
      await work.save();
      changed(task.memberId);
    }),
  };
}
