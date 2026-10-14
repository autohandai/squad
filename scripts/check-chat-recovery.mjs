import assert from "node:assert/strict";
import { recoverCompletedHandoffParents, recoverInterruptedChats, recoverInterruptedHandoffs, withoutThinkingPlaceholder } from "../src/lib/chat-recovery.js";
import { isNoTextReply, restoreRepliesFromRuns, withoutRecoveryNotices } from "../src/lib/chat-recovery.js";
const boot = "2026-10-01T04:00:00.000Z";
const task = { id: "task", title: "Verify changes", status: "in_progress" };
const old = { id: "old", role: "agent", body: "Work was in progress.", status: "loading", startedAt: "2026-10-01T03:00:00.000Z", progress: { items: [task] } };
const fresh = { ...old, id: "fresh", startedAt: "2026-10-01T04:01:00.000Z" };
const durable = { ...old, id: "durable", goalId: "persisted-goal" };
const unknown = { ...old, id: "unknown", startedAt: "" };
const completed = { ...old, id: "finished", status: "complete" };
const current = { one: [old, fresh, durable, unknown, completed], two: [fresh] };
const result = recoverInterruptedChats(current, boot);
assert.equal(result.one[0].status, "error");
assert.equal(result.one[0].interrupted, true);
assert.match(result.one[0].body, /No final update was received/);
assert.equal(result.one[0].progress.outcome, "interrupted");
assert.equal(result.one[0].progress.items[0].status, "in_progress");
assert.equal(result.one[0].completedAt, boot);
for (let i=1;i<current.one.length;i++) assert.equal(result.one[i], current.one[i]);
assert.equal(result.two, current.two);
assert.equal(old.status, "loading");
assert.equal(recoverInterruptedChats(result, boot), result);
assert.equal(recoverInterruptedChats(current, "unknown"), current);
assert.equal(recoverInterruptedChats({ one: [fresh] }, boot).one[0], fresh);
const thinking = { ...old, body: "Noah is thinking..." };
assert.doesNotMatch(recoverInterruptedChats({ one: [thinking] }, boot).one[0].body, /thinking/);
const previouslyRecovered = { ...old, status: "error", interrupted: true, body: "Noah is thinking... This request was interrupted when Squad restarted." };
const cleaned = recoverInterruptedChats({ one: [previouslyRecovered] }, boot);
assert.equal(cleaned.one[0].body, "This request was interrupted when Squad restarted.");
assert.equal(recoverInterruptedChats(cleaned, boot), cleaned);
assert.equal(withoutThinkingPlaceholder("The model is thinking... through the solution."), "The model is thinking... through the solution.");
console.log("Chat recovery passed: pre-restart ordinary requests interrupted honestly, live/goal/unknown/finished rows preserved, unfinished tasks not completed.");

const accepted={id:'review',status:'accepted',acceptedAt:'2026-10-01T03:00:00.000Z',fromAgentId:'qa',toAgentId:'reviewer',requiredContext:'RETAINED_EVIDENCE'};
const acceptedTask={id:'parent',status:'running',handoffs:[accepted],assignments:[{handoffId:'review',status:'running',requiredContext:'RETAINED_ASSIGNMENT'}],timeline:[{id:'original',content:'RETAINED_HISTORY'}]};
const currentTask={...acceptedTask,id:'current',handoffs:[{...accepted,acceptedAt:'2026-10-01T04:01:00.000Z'}]};
const pendingTask={...acceptedTask,id:'pending',handoffs:[{...accepted,status:'pending'}]};
const completeTask={...acceptedTask,id:'complete',status:'completed',handoffs:[{...accepted,status:'completed'}]};
const durableTask={...acceptedTask,id:'goal',goalId:'durable-goal'};
const before=[acceptedTask,currentTask,pendingTask,completeTask,durableTask];
const restored=recoverInterruptedHandoffs(before,boot);
assert.equal(restored[0].status,'blocked');assert.equal(restored[0].handoffs[0].status,'failed');assert.equal(restored[0].handoffs[0].interrupted,true);
assert.equal(restored[0].handoffs[0].requiredContext,'RETAINED_EVIDENCE');assert.match(restored[0].handoffs[0].failureReason,/Review saved evidence/);
assert.equal(restored[0].assignments[0].status,'failed');assert.equal(restored[0].assignments[0].requiredContext,'RETAINED_ASSIGNMENT');
assert.equal(restored[0].timeline[0],acceptedTask.timeline[0]);assert.equal(restored[0].timeline[1].type,'handoff.interrupted');
assert.equal(acceptedTask.status,'running');
for(let i=1;i<before.length;i++) assert.equal(restored[i],before[i]);
assert.equal(recoverInterruptedHandoffs(restored,boot),restored);assert.equal(recoverInterruptedHandoffs(before,'invalid'),before);
const malformed=[{...acceptedTask,handoffs:[{...accepted,acceptedAt:'invalid'}]}];
assert.equal(recoverInterruptedHandoffs(malformed,boot)[0].status,'blocked','Unknown accepted state cannot claim a confirmed active execution.');
console.log('Handoff recovery passed: old and unknown accepted work blocked, context/history retained, live/pending/finished/durable records preserved, no replay and idempotent recovery.');
const qa={id:'qa-checkpoint',status:'failed',waitingForChildren:true,ownCompletedAt:boot,ownReply:'QA_EXECUTION_RETAINED',fromAgentId:'builder',toAgentId:'qa'};
const review={id:'review-checkpoint',parentHandoffId:qa.id,status:'completed',result:'REVIEW_VERDICT_RETAINED',fromAgentId:'qa',toAgentId:'reviewer'};
const dependencyTask={id:'dependency-parent',status:'blocked',originAgentId:'builder',currentOwnerId:'reviewer',handoffs:[qa,review],assignments:[{handoffId:qa.id,status:'failed'}],timeline:[{id:'existing-history'}]};
const reconciled=recoverCompletedHandoffParents([dependencyTask],boot);
assert.equal(reconciled.tasks[0].status,'completed');assert.equal(reconciled.tasks[0].currentOwnerId,'builder');
assert.match(reconciled.returns[0].result,/QA_EXECUTION_RETAINED[\s\S]*REVIEW_VERDICT_RETAINED/);
assert.equal(reconciled.returns[0].fromAgentId,'builder');assert.equal(reconciled.tasks[0].assignments[0].status,'completed');
assert.equal(reconciled.tasks[0].timeline[0],dependencyTask.timeline[0]);assert.equal(dependencyTask.handoffs[0].status,'failed');
assert.equal(recoverCompletedHandoffParents(reconciled.tasks,boot).tasks,reconciled.tasks,'Recovered results must not be returned twice.');
for(const child of [{...review,status:'failed'},{...review,status:'accepted'},{...review,result:''}]){
 const unresolved=[{...dependencyTask,handoffs:[qa,child]}];assert.equal(recoverCompletedHandoffParents(unresolved,boot).tasks,unresolved);
}
const ownFailure=[{...dependencyTask,handoffs:[{...qa,ownCompletedAt:''},review]}];assert.equal(recoverCompletedHandoffParents(ownFailure,boot).tasks,ownFailure,'A failed execution cannot be reconstructed as success.');
const malformedHandoffs=[{...acceptedTask,handoffs:[{...accepted,id:undefined},null,{status:'pending'}],assignments:[{}]}];
const safe=recoverInterruptedHandoffs(malformedHandoffs,boot)[0];assert.equal(safe.handoffs[1],null);assert.equal(safe.handoffs[2].status,'pending');assert.equal(safe.assignments[0].status,undefined);
console.log('Checkpoint result recovery passed: saved successful parent output joins completed child receipts without re-execution; unresolved, empty, and own-failed results stay blocked.');

// A reply left "loading" by a reload is closed once the bridge says nothing is running (bug hunt #42).
{
  const { recoverOrphanedChats, ORPHANED_REPLY_NOTE } = await import('../src/lib/chat-recovery.js');
  const t0 = Date.parse('2026-10-14T00:00:00Z');
  const convo = { eva: [{ id: 'q', role: 'user', body: 'hi', startedAt: '2026-10-14T00:00:00Z' }, { id: 'a', role: 'agent', status: 'loading', body: 'Eva is thinking...', startedAt: '2026-10-14T00:00:00Z' }] };
  const idle = { eva: { state: 'idle', activeRuns: 0 } };
  const closed = recoverOrphanedChats(convo, { presence: idle, now: t0 + 60_000 });
  assert.equal(closed.eva[1].status, 'error'); assert.equal(closed.eva[1].interrupted, true);
  assert.equal(closed.eva[1].body, ORPHANED_REPLY_NOTE, 'the placeholder is replaced by the note');
  assert.equal(closed.eva[0], convo.eva[0], 'the question is untouched');
  assert.equal(recoverOrphanedChats(convo, { presence: { eva: { state: 'working', activeRuns: 1 } }, now: t0 + 60_000 }), convo, 'a working member keeps its reply');
  assert.equal(recoverOrphanedChats(convo, { presence: idle, streaming: new Set(['eva']), now: t0 + 60_000 }), convo, 'this page streaming it keeps it');
  assert.equal(recoverOrphanedChats(convo, { presence: idle, now: t0 + 5_000 }), convo, 'a reply just sent is given time to register');
  assert.equal(recoverOrphanedChats(convo, { presence: {}, now: t0 + 60_000 }), convo, 'unknown presence decides nothing');
  const goal = { eva: [{ ...convo.eva[1], goalId: 'g1' }] };
  assert.equal(recoverOrphanedChats(goal, { presence: idle, now: t0 + 60_000 }), goal, 'goals recover on their own');
  console.log('Orphaned reply recovery passed.');
}

{
  const body = "⚠ Session encountered an error: Rate limit exceeded. Please wait a moment and try again, or choose a different model.\n  Attempting recovery (1/5)...\nHey team 👋\nIris here.";
  assert.equal(withoutRecoveryNotices(body), "Hey team 👋\nIris here.", "the engine's retry chatter is not part of the reply");
  assert.equal(withoutRecoveryNotices("Attempting recovery is my plan"), "Attempting recovery is my plan", "ordinary prose is left alone");
  assert.ok(isNoTextReply("Autohand returned no chat text."));
  assert.ok(isNoTextReply("Noah returned no chat text"));
  assert.ok(!isNoTextReply("Noah returned no chat text. Then he said more."));
  console.log("recovery notices and empty replies checked");
}

{
  // Noah's 1:39 AM reply: closed as interrupted, but its run finished with an answer.
  const conversations = { noah: [
    { id: "u1", role: "user", body: "hey", startedAt: "2026-10-13T12:39:04.000Z" },
    { id: "a1", role: "agent", status: "error", interrupted: true, body: "This request was interrupted when Squad restarted. No final update was received. Retry to continue.", startedAt: "2026-10-13T12:39:04.300Z" },
    { id: "a2", role: "agent", status: "error", interrupted: true, body: "interrupted", startedAt: "2026-10-12T04:25:00.000Z" },
  ] };
  const runs = [
    { id: "r1", agentId: "noah", mode: "chat", status: "completed", startedAt: "2026-10-13T12:39:04.598Z", finishedAt: "2026-10-13T12:39:42.975Z", reply: "Hey Igor — Noah here." },
    { id: "r2", agentId: "noah", mode: "chat", status: "failed", startedAt: "2026-10-12T04:25:01.000Z", reply: "" },
    { id: "r3", agentId: "eva", mode: "chat", status: "completed", startedAt: "2026-10-12T04:25:02.000Z", reply: "not Noah's" },
  ];
  const next = restoreRepliesFromRuns(conversations, runs);
  assert.equal(next.noah[1].status, "complete");
  assert.equal(next.noah[1].body, "Hey Igor — Noah here.");
  assert.equal(next.noah[1].recoveredFromRun, "r1");
  assert.equal(next.noah[1].durationMs, 38377);
  assert.equal(next.noah[2].status, "error", "a failed run, or another member's run, restores nothing");
  assert.equal(restoreRepliesFromRuns(next, runs), next, "a restored reply is not restored twice");
  console.log("interrupted replies restored from finished runs");
}
