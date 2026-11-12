import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { startSupervisedBridge } from "./lib/supervised-bridge.mjs";

const bridge = await startSupervisedBridge();
try {
  const original=await bridge.request('/api/health');
  const account=await readFile(bridge.config,'utf8');
  await writeFile(join(bridge.dataRoot,'reset-marker.txt'),'earlier owner dataset');
  await writeFile(join(bridge.workspaceRoot,'workspace-marker.txt'),'earlier managed work');
  assert.equal((await bridge.request('/api/system/reset','POST',{confirm:'RESET'})).status,410);
  for(let attempt=0;attempt<2;attempt++) {
    const before=(await bridge.request('/api/ownership/context')).data;
    const id=randomUUID(),input={id,kind:'reset',beforeDatasetId:before.datasetId,confirmation:'replace-current-squad'};
    const reset=await bridge.request('/api/ownership/operations','POST',input);
    assert.equal(reset.success,true,JSON.stringify(reset));
    assert.equal(reset.data.context.state,'awaiting_restart');
    assert.notEqual(reset.data.context.datasetId,before.datasetId);
    assert.equal((await bridge.request('/api/health')).pid,original.pid,'reset retains the supervised broker; a changed process is not completion proof');
    assert.equal(bridge.daemon.exitCode,null,'the real native supervisor stays alive');
    assert.equal((await bridge.request('/api/setup')).status,401,'completion cannot start private work');
    const replay=await bridge.request('/api/ownership/operations','POST',input);
    assert.equal(replay.data.operation.afterDatasetId,reset.data.context.datasetId,'lost-response retry never resets twice');
    const pending=(await bridge.request('/api/ownership/context')).data;
    const restart=await bridge.request(`/api/ownership/operations/${id}/restart`,'POST',{revision:pending.pendingOperation.revision});
    assert.equal(restart.success,true,JSON.stringify(restart));
    assert.equal((await bridge.request('/api/setup')).data.status,'new');
    assert.equal((await bridge.request('/api/ownership/context')).data.datasetId,pending.datasetId);
  }
  assert.equal(await readFile(join(bridge.dataRoot,'reset-marker.txt'),'utf8'),'earlier owner dataset');
  assert.equal(await readFile(join(bridge.workspaceRoot,'workspace-marker.txt'),'utf8'),'earlier managed work');
  assert.equal(await readFile(bridge.config,'utf8'),account);
  console.log('PASS real native supervisor: repeated owned reset keeps the broker, retains earlier data and sign-in, proves durable idempotent completion, and waits for explicit restart into each clean dataset. Isolated home; no provider calls.');
}finally{await bridge.close();}
