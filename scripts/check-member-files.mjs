// A member's Files (ADR-0287): what each turn made in the member's folders is
// recorded (git and plain folders), listed newest first as created or edited,
// and only files the member created can be moved to the Trash; published
// artifacts can be deleted, keeping bytes another record still uses.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemberFiles, fileKind } from '../server/member-files.mjs';
import { createArtifactService } from '../server/artifacts/service.mjs';

const root = await realpath(await mkdtemp(join(tmpdir(), 'squad-member-files-')));
const home = join(root, 'home'), state = join(root, 'state');
const repo = join(home, 'Projects', 'site'), plain = join(home, 'Projects', 'notes');
await mkdir(repo, { recursive: true }); await mkdir(plain, { recursive: true }); await mkdir(state);
execFileSync('git', ['init', '-q'], { cwd: repo });
await writeFile(join(repo, 'README.md'), 'old\n'); await writeFile(join(repo, '.gitignore'), 'node_modules\n');
execFileSync('git', ['-c', 'user.email=f@x', '-c', 'user.name=f', 'add', '.'], { cwd: repo });
execFileSync('git', ['-c', 'user.email=f@x', '-c', 'user.name=f', 'commit', '-qm', 'init'], { cwd: repo });
await writeFile(join(plain, 'old-note.txt'), 'before the turn');
const old = new Date(Date.now() - 3600_000); await utimes(join(plain, 'old-note.txt'), old, old);
await new Promise(done => setTimeout(done, 1100));

const trashed = [];
const files = createMemberFiles({ stateDir: state, home, trashImpl: async path => { trashed.push(path); await rm(path); } });
// A turn: creates an image and a doc, edits README, writes into node_modules (ignored).
const since = Date.now();
await new Promise(done => setTimeout(done, 20));
await mkdir(join(repo, 'assets'), { recursive: true }); await mkdir(join(repo, 'node_modules', 'x'), { recursive: true });
await writeFile(join(repo, 'assets', 'hero.png'), 'png'); await writeFile(join(repo, 'README.md'), 'new\n');
await writeFile(join(repo, 'node_modules', 'x', 'index.js'), 'ignored'); await writeFile(join(plain, 'plan.md'), '# plan');
await mkdir(join(plain, 'node_modules')); await writeFile(join(plain, 'node_modules', 'skip.js'), 'skip');
const count = await files.recordTurn({ memberId: 'asq_eva', roots: [repo, plain, home, '/', 'relative/path'], since });
assert.equal(count, 3, `three changed files recorded, got ${count}`);
const listed = await files.list('asq_eva');
const names = listed.map(row => row.name).sort();
assert.deepEqual(names, ['README.md', 'hero.png', 'plan.md'], `changed files only, ignored and dependency folders skipped, the home folder never scanned: ${names}`);
const byName = Object.fromEntries(listed.map(row => [row.name, row]));
assert.equal(byName['hero.png'].kind, 'image'); assert.equal(byName['plan.md'].kind, 'document');
assert.equal(byName['README.md'].created, false, 'an edited file is marked edited');
if (process.platform === 'darwin') assert.equal(byName['hero.png'].created, true, 'a new file is marked created (birth time)');
assert.ok(byName['hero.png'].displayPath.startsWith('~/Projects/site/'), 'paths are shown from home');
assert.equal((await stat(join(state, 'member-files', 'asq_eva.json'))).mode & 0o777, 0o600);
assert.deepEqual(await files.list('asq_noah'), [], 'files are per member');

// Trash: only created files in the record, never an edited one or an unknown path.
await assert.rejects(files.trash('asq_eva', byName['README.md'].path), /edited this file/);
await assert.rejects(files.trash('asq_eva', join(repo, '.gitignore')), /isn’t one this member made/);
await assert.rejects(files.trash('asq_noah', byName['plan.md'].path), /isn’t one this member made/, 'another member cannot trash it');
await assert.rejects(files.trash('../x', byName['plan.md'].path), /Choose a member/);
if (process.platform === 'darwin') {
  assert.deepEqual(await files.trash('asq_eva', byName['hero.png'].path), { trashed: true });
  assert.deepEqual(trashed, [byName['hero.png'].path]);
  assert.ok(!(await files.list('asq_eva')).some(row => row.name === 'hero.png'), 'a trashed file leaves the list');
}
// A file deleted outside Squad simply drops out.
await rm(byName['plan.md'].path);
assert.ok(!(await files.list('asq_eva')).some(row => row.name === 'plan.md'));
assert.equal(fileKind('x.tsx'), 'code'); assert.equal(fileKind('x.bin'), 'file');

// Published artifacts: delete keeps bytes another record shares.
const library = createArtifactService({ stateDir: state, members: async () => [{ id: 'asq_eva', name: 'Eva', workspace: repo }, { id: 'asq_noah', name: 'Noah', workspace: plain }] });
await writeFile(join(repo, 'report.md'), '# same bytes'); await writeFile(join(plain, 'copy.md'), '# same bytes');
const a = await library.publish({ path: 'report.md', title: 'Report' }, { memberId: 'asq_eva', workspace: repo });
const b = await library.publish({ path: 'copy.md', title: 'Copy' }, { memberId: 'asq_noah', workspace: plain });
const blob = join(state, 'artifacts', 'files', JSON.parse(await readFile(join(state, 'artifacts', 'library.json'), 'utf8')).records[0].contentHash);
assert.deepEqual(await library.remove(a.id), { removed: true, id: a.id });
await stat(blob); // still used by Noah's record
assert.equal((await library.list({ owner: 'asq_eva' })).length, 0);
await library.remove(b.id);
await assert.rejects(stat(blob), /ENOENT/, 'the last record takes its bytes with it');
await assert.rejects(library.remove(a.id), /not found/);
assert.equal(await readFile(join(repo, 'report.md'), 'utf8'), '# same bytes', 'the member’s original file is untouched');
await rm(root, { recursive: true, force: true });
console.log('Member files checks passed: a turn’s new and edited files are recorded per member from git and plain folders (dependency folders and the home folder skipped), listed with kind and created/edited, only created files can be moved to the Trash, deleted files drop out, and a published artifact can be deleted keeping shared bytes.');
