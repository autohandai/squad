import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openSearchIndex, SEARCH_FILE } from '../server/search/index.mjs';

const directory = await mkdtemp(join(tmpdir(), 'squad-retired-canvases-'));
let index;
try {
  index = openSearchIndex(directory);
  const retired = { id: 'canvas:old-member', type: 'canvas', memberId: 'eva', title: 'Old personal canvas', body: 'retirementtoken', route: '/conversations/new?member=eva&canvas=old-member' };
  assert.equal(index.upsert(retired).indexed, 0, 'stale clients cannot re-index a removed member feature');
  index.upsert({ ...retired, id: 'canvas:shared', memberId: '', channelId: 'general', route: '/channels/general?canvas=shared' });
  index.close(); index = null;
  const oldDatabase = new DatabaseSync(join(directory, SEARCH_FILE));
  oldDatabase.prepare('INSERT INTO docs(id,type,title,body,member_id,route,at) VALUES(?,?,?,?,?,?,?)').run(retired.id, retired.type, retired.title, retired.body, retired.memberId, retired.route, new Date().toISOString());
  oldDatabase.close();
  index = openSearchIndex(directory);
  assert.deepEqual(index.query('retirementtoken').map(item => item.id), ['canvas:shared'], 'existing member-canvas search entries retire on startup, while channel canvases remain');
  console.log('PASS retired member canvas search: no stale re-indexing, existing cache removed, channel canvases retained.');
} finally { index?.close(); await rm(directory, { recursive: true, force: true }); }
