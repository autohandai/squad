import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export function hasFileInspection(trace,file) {
  return (trace?.toolCalls || []).some(call =>
    call.name === 'read_file' ? String(call.args?.path || call.args?.file || '').split('/').at(-1) === file :
    ['run_command','shell'].includes(call.name) && /(^|[;|&\n])\s*(?:\S*\/)?(?:cat|sed|head|tail|rg|grep)\s+/.test(String(call.args?.command || '')) && String(call.args?.command || '').includes(file));
}

/** Validate retained real receipts and execute the actual generated tests. No model responses are invented. */
export async function verifyLiveCollaborationArtifact(artifact) {
  assert.equal(artifact.source,'real bridge/browser/provider; prepared role roster, no response fixtures');
  const {snapshot,workspace}=artifact;
  assert.ok(workspace.startsWith(join(process.cwd(),'.codex-artifacts','reliability','live-collaboration-project-')),'Verify only the owned live-test project.');
  assert.equal(snapshot.tasks.length,1);const task=snapshot.tasks[0];
  assert.equal(task.status,'completed');assert.equal(task.workspace,workspace);assert.equal(task.currentOwnerId,'asq_live_builder');
  assert.equal(task.handoffs.length,2);assert.ok(task.handoffs.every(handoff=>handoff.status==='completed'));
  assert.deepEqual(task.handoffs.map(handoff=>[handoff.fromAgentId,handoff.toAgentId]),[['asq_live_builder','asq_live_verifier'],['asq_live_verifier','asq_live_reviewer']]);
  assert.equal(task.handoffs[1].parentHandoffId,task.handoffs[0].id);
  const receipts=[];
  for(const agentId of ['asq_live_builder','asq_live_verifier','asq_live_reviewer']) {
    const turns=snapshot.turns.filter(turn=>turn.agentId===agentId && turn.result && !turn.error && !turn.result.error && !/uncached input-token throughput.*(reached|exhausted)/is.test(turn.result.reply || ''));
    assert.equal(turns.length,1,'Exactly one successful receipt required for '+agentId);
    assert.ok(turns[0].result.trace?.toolCalls?.length,'Actual tools required for '+agentId);
    receipts.push({agentId,requestId:turns[0].requestId,result:turns[0].result});
  }
  const qa=receipts[1].result,review=receipts[2].result;
  assert.ok(qa.trace.toolCalls.some(call=>['run_command','shell'].includes(call.name) && /node\s+--test/.test(call.args?.command || '')),'QA must execute the real tests.');
  for(const file of ['clamp.mjs','clamp.test.mjs']) assert.ok(hasFileInspection(review.trace,file),'Reviewer must inspect '+file+' through an actual file-read operation.');
  assert.match(review.reply,/REVIEW_VERDICT/);assert.match(review.reply,/SQUAD_COLLABORATION_983/);
  assert.ok(snapshot.messages.asq_live_builder.some(message=>message.body?.includes('REVIEW_VERDICT') && message.id?.endsWith('-result')),'Final review must return to the initiating conversation.');
  const testSource=await readFile(join(workspace,'clamp.test.mjs'),'utf8');assert.match(testSource,/node:test/);
  const verification=spawnSync(process.execPath,['--test','clamp.test.mjs'],{cwd:workspace,encoding:'utf8',timeout:30000});
  assert.equal(verification.status,0,verification.stdout+verification.stderr);
  const contract=spawnSync(process.execPath,['--input-type=module','-e',"import assert from 'node:assert/strict';import {clamp} from './clamp.mjs';assert.equal(clamp(-2,0,3),0);assert.equal(clamp(2,0,3),2);assert.equal(clamp(5,0,3),3);assert.throws(()=>clamp(1,3,0),RangeError);"],{cwd:workspace,encoding:'utf8',timeout:30000});
  assert.equal(contract.status,0,contract.stderr);
  return {status:'verified',scope:'real provider implementation, independent QA/test execution, independent review and final return on one completed task',taskId:task.id,workspace,receipts,testOutput:verification.stdout,contract:'below/within/above/invalid bounds passed',restart:artifact.reopenedAfterRestart===true?'verified by original probe':'not executed by this artifact validation; separate browser/recovery evidence applies'};
}
