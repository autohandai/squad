import assert from 'node:assert/strict';
import { startBridge } from './lib/reliability-browser.mjs';

const bridge=await startBridge();
try {
  const created=await bridge.api('/api/channels','POST',{name:'workflow-recovery',members:['workflow-member']});
  assert.equal(created.success,true,JSON.stringify(created));
  const channelId=created.data.id;
  const workflow=await bridge.api(`/api/channels/${channelId}/workflows`,'POST',{name:'Explicit approval recovery',trigger:{type:'webhook'},steps:[{id:'inspect',memberId:'workflow-member',prompt:'Inspect {{message}}',approval:{by:'user'}}]});
  assert.equal(workflow.success,true,JSON.stringify(workflow));
  const fired=await bridge.api(`/api/webhooks/${workflow.data.trigger.token}`,'POST',{text:'RECOVERY_MARKER'});
  assert.equal(fired.status,202);assert.equal(fired.data.run.status,'waiting_approval');
  const runId=fired.data.run.id;
  await bridge.restart();
  const restored=await bridge.api(`/api/workflows/runs/${runId}`);
  assert.equal(restored.data.run.status,'waiting_approval');assert.equal(restored.data.run.trigger.payload.text,'RECOVERY_MARKER');
  assert.equal((await bridge.api('/api/workflows/pending')).data.dispatches.length,0,'Restart must not approve a saved gate.');
  const approved=await bridge.api(`/api/workflows/${runId}/approve`,'POST',{by:'user'});
  assert.equal(approved.success,true);assert.equal(approved.data.dispatch.runId,runId);
  await bridge.restart();
  const pending=(await bridge.api('/api/workflows/pending')).data.dispatches;
  assert.equal(pending.length,1);assert.equal(pending[0].runId,runId);assert.match(pending[0].prompt,/RECOVERY_MARKER/);
  assert.equal((await bridge.api(`/api/workflows/${runId}/approve`,'POST',{by:'user'})).status,409,'An approved gate cannot be approved again.');
  await bridge.api(`/api/workflows/${runId}/steps/inspect/started`,'POST',{messageId:'recorded-step'});
  const finished=await bridge.api(`/api/workflows/${runId}/steps/inspect/finished`,'POST',{status:'completed',preview:'ACTUAL_CONTROLLED_COMPLETION'});
  assert.equal(finished.data.run.status,'completed');
  await bridge.restart();
  assert.equal((await bridge.api(`/api/workflows/runs/${runId}`)).data.run.status,'completed');
  assert.equal((await bridge.api('/api/workflows/pending')).data.dispatches.length,0);
  console.log('Workflow recovery passed: real bridge/disk/restart retains webhook payload and approval gate, exposes one approved pending dispatch, rejects repeated approval, retains completion without replay. Step completion controlled; no provider or running-step crash-resume proof.');
} finally {await bridge.close();}
