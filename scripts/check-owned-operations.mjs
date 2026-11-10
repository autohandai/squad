import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createOperationJournal } from '../server/ownership/operation-journal.mjs';
import { ensureDataset, readDataset, stageDataset, publishDataset } from '../server/ownership/datasets.mjs';
import { ownerKey } from '../server/ownership/identity.mjs';

const serviceRoot=await mkdtemp(join(tmpdir(),'squad-owned-operations-'));
const issuer='https://identity.example.test', owner={kind:'team',issuer,id:'team-fixture'}, actor={issuer,id:'alice'};
try {
  const key=ownerKey(owner), original=await ensureDataset(serviceRoot,key);
  const sentinel=join(original.dataRoot,'preserved.json'); await writeFile(sentinel,'{"original":"unchanged"}\n');
  const journal=await createOperationJournal({serviceRoot,owner,actor});
  const intent={id:randomUUID(),kind:'restore',beforeDatasetId:original.datasetId,sourceId:randomUUID(),sourceDigest:'a'.repeat(64)};
  let row=await journal.create(intent);
  assert.deepEqual(await journal.create(intent),row,'repeating a request returns its original receipt');
  await assert.rejects(journal.create({...intent,sourceDigest:'b'.repeat(64)}),{code:'operation_changed'});
  await assert.rejects(journal.update(row.id,row.revision,{phase:'publishing'}),{code:'operation_changed'});
  row=await journal.update(row.id,row.revision,{phase:'draining'});
  const staged=await stageDataset(serviceRoot,key);
  row=await journal.update(row.id,row.revision,{phase:'staging',afterDatasetId:staged.datasetId});
  await assert.rejects(journal.update(row.id,row.revision,{phase:'publishing',afterDatasetId:randomUUID()}),{code:'operation_changed'});
  const staleRevision=row.revision;
  row=await journal.update(row.id,row.revision,{phase:'publishing'});
  await assert.rejects(journal.update(row.id,staleRevision,{phase:'failed'}),{code:'operation_changed'});
  await publishDataset(serviceRoot,key,staged,original.datasetId);
  // The pointer committed but its HTTP response/last journal update was lost.
  const restarted=await createOperationJournal({serviceRoot,owner,actor});
  const recovered=await restarted.reconcile();
  assert.equal(recovered.length,1);assert.equal(recovered[0].phase,'awaiting_restart');
  assert.equal((await readDataset(serviceRoot,key)).datasetId,staged.datasetId);
  assert.equal(await readFile(sentinel,'utf8'),'{"original":"unchanged"}\n');
  assert.equal((await restarted.reconcile())[0].revision,recovered[0].revision,'recovery does not repeatedly advance a committed operation');
  row=await restarted.update(row.id,recovered[0].revision,{phase:'complete'});
  assert.deepEqual(await restarted.reconcile(),[]);
  assert.deepEqual(await restarted.create(intent),row,'replaying the original request cannot publish it again');

  const unfinished={id:randomUUID(),kind:'reset',beforeDatasetId:staged.datasetId};
  const interrupted=await restarted.create(unfinished);
  await restarted.reconcile();
  assert.equal((await restarted.get(interrupted.id)).phase,'failed');
  assert.equal((await readDataset(serviceRoot,key)).datasetId,staged.datasetId,'interruption before publication preserves the selected data');
  const bob=await createOperationJournal({serviceRoot,owner,actor:{issuer,id:'bob'}});
  await assert.rejects(bob.get(row.id),{code:'operation_not_found'},'a different actor cannot adopt a previous window’s receipt');
  await assert.rejects(bob.create(intent),{code:'operation_changed'});
  const otherOwner={kind:'user',issuer,id:'bob'};
  await ensureDataset(serviceRoot,ownerKey(otherOwner));
  const other=await createOperationJournal({serviceRoot,owner:otherOwner,actor:{issuer,id:'bob'}});
  await assert.rejects(other.get(row.id),{code:'operation_not_found'});
  await assert.rejects(restarted.get('../outside'));
  console.log('Owned operation journal: idempotency, revision/phase fences, lost-publication response recovery, interrupted pre-publication preservation and actor/owner isolation passed. Restore execution is not covered by this metadata test.');
} finally {await rm(serviceRoot,{recursive:true,force:true});}
