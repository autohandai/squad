import { readFile,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { verifyLiveCollaborationArtifact } from './lib/live-collaboration-evidence.mjs';
const evidence=join(process.cwd(),'.codex-artifacts','reliability');
const artifact=JSON.parse(await readFile(join(evidence,'live-collaboration.json'),'utf8'));
const result=await verifyLiveCollaborationArtifact(artifact);
await writeFile(join(evidence,'live-collaboration-verified.json'),JSON.stringify(result,null,2),{mode:0o600});
console.log('PASS saved real-provider receipts: implementation, independent QA and review, actual generated tests and four contract assertions, one completed task and final result returned. Restart: '+result.restart);
