#!/usr/bin/env node
// Browser-side goal message reconciliation (src/lib/member-goals.js): durable
// goals rehydrated from the bridge must land in conversation order, not at the
// bottom, so the newest reply stays the newest and Needs-you previews it.
import assert from 'node:assert/strict';
import { reconcileGoalMessages } from '../src/lib/member-goals.js';

const members = [{ id: 'eva' }];
const goal = { id: 'goal-1', agentId: 'eva', status: 'paused', summary: 'Working through the fixture', startedAt: '2026-10-13T03:19:29.440Z', updatedAt: '2026-10-13T03:19:40.000Z' };

// A reply that arrived after the goal started is already in the conversation.
const newer = { id: 'reply-newer', role: 'agent', body: 'Newest reply', createdAt: '2026-10-13T03:19:51.266Z' };
const older = { id: 'reply-older', role: 'user', body: 'Earlier prompt', createdAt: '2026-10-13T03:10:00.000Z' };
const rehydrated = reconcileGoalMessages({ eva: [older, newer] }, [goal], members);
assert.deepEqual(rehydrated.eva.map((message) => message.id), ['reply-older', 'goal-goal-1-a', 'reply-newer'], 'rehydrated goal sits between the messages around its start time');
assert.equal(rehydrated.eva[1].createdAt, goal.startedAt, 'rehydrated goal carries its start time so previews can order it');

// Messages without timestamps never force an older goal above them.
const untimed = { id: 'untimed', role: 'agent', body: 'No timestamp' };
assert.deepEqual(reconcileGoalMessages({ eva: [untimed] }, [goal], members).eva.map((message) => message.id), ['untimed', 'goal-goal-1-a']);

// Already-present goal messages update in place and keep their position.
const live = { id: 'goal-goal-1-a', role: 'agent', goalId: 'goal-1', goalUpdatedAt: 'stale', body: 'Working towards the goal.', status: 'loading' };
const updated = reconcileGoalMessages({ eva: [older, live, newer] }, [goal], members);
assert.deepEqual(updated.eva.map((message) => message.id), ['reply-older', 'goal-goal-1-a', 'reply-newer']);
assert.equal(updated.eva[1].body, 'Working through the fixture');

// Nothing to do returns the same object.
const same = { eva: [older, { ...live, goalUpdatedAt: goal.updatedAt, goal }] };
assert.equal(reconcileGoalMessages(same, [goal], members), same);

console.log('Member goal reconciliation checks passed: chronological rehydration with start time, untimed neighbours untouched, in-place updates, no-op identity.');
