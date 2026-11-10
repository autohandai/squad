import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { readFile, readdir, mkdtemp, rm, access, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOwnedCloudClient } from "../../../server/ownership/cloud-backups.mjs";
import { createOwnedCloudBackups } from "../../../server/ownership/cloud-service.mjs";
import { createOwnedDataService } from "../../../server/ownership/data-service.mjs";
import { ensureDataset } from "../../../server/ownership/datasets.mjs";
import { ownerKey } from "../../../server/ownership/identity.mjs";
import { createOwnershipBroker } from "../../../server/ownership/broker.mjs";
import { createBridgeClient,createTools } from '../../../server/control-plane/runtime.mjs';
import { TOOLS } from '../../../server/control-plane/control-plane.mjs';
import { fileURLToPath } from 'node:url';
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { parseBackup, sha256, type Agent } from "@autohand/squad-portable";

let runtime: Miniflare, alice = "", bob = "";
const apiName = "squad-owned-api";
const personal = "/v1/users/me";
const team = "/v1/teams/team-shared";
const content = new TextEncoder().encode("Preserve exact memory.\n\0Binary: 世界");
const hash = await sha256(content);
const file = { id: "memory-file", path: "members/eva/MEMORY.md", kind: "memory" as const, sha256: hash, bytes: content.byteLength, mediaType: "application/octet-stream" };
const agent = (id: string): Agent => ({ id, profile: { name: "Eva", role: "QA", harness: { id: "claude" } }, memories: [{ id: "m1", text: "Keep account data separate." }], routines: [{ id: "r1", enabled: false }], conversations: [{ id: "c1", messages: [{ role: "user", body: "My private question" }] }], skills: [{ id: "qa", instructions: "Check the evidence." }], files: [file], extensions: { "example.org": { preserved: true } } });
async function call<T = Record<string, unknown>>(path: string, method = "GET", value?: unknown, session = alice, identity?: string, key?: string) {
  const response = await runtime.dispatchFetch(`https://owned.example.test${path}`, { method,
    headers: { ...(session ? { authorization: `Bearer ${session}` } : {}), ...(identity ? { "x-autohand-identity": identity } : {}), ...(value === undefined ? {} : { "content-type": "application/json" }), ...(key ? { "idempotency-key": key } : {}) },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
  return { status: response.status, headers: response.headers, json: await response.json<{ success: boolean; data: T; error?: { code: string } }>() };
}
async function fixture(state: Record<string, unknown>) {
  const worker = await runtime.getWorker("owned-identity");
  const response = await worker.fetch("https://api.autohand.ai/__fixture", { method: "POST", body: JSON.stringify(state) });
  assert.equal(response.status, 200);
}
async function upload(prefix = personal, session = alice, identity?: string) {
  const response = await runtime.dispatchFetch(`https://owned.example.test${prefix}/files/${hash}`, { method: "PUT", body: content,
    headers: { authorization: `Bearer ${session}`, ...(identity ? { "x-autohand-identity": identity } : {}) } });
  assert.equal(response.status, 201, await response.text());
}
const write = (prefix: string, id: string, revision: number, record: Agent | null, session = alice, identity?: string, key = crypto.randomUUID()) => call(`${prefix}/agents/${id}`, "PUT", { baseRevision: revision, content: record }, session, identity, key);

before(async () => {
  const bundle = await build({ entryPoints: ["src/index.ts"], bundle: true, write: false, format: "esm", platform: "browser", target: "es2024" });
  runtime = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: apiName, modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-10-27",
    d1Databases: ["DB"], r2Buckets: ["MEMORY", "RELEASES"],
    bindings: { IDENTITY_ORIGIN: "https://api.autohand.ai", WEB_ORIGIN: "https://owned.example.test", RELEASE_PUBLISHER_TOKEN: "not-used-for-agent-authority" },
    outboundService: "owned-identity",
  }, { name: "owned-identity", modules: true, compatibilityDate: "2026-10-27", script: `
    let state = { bobMember: true, readOnly: false, fail: false, writable: true };
    export default { async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === '/__fixture') { state = {...state, ...await request.json()}; return Response.json({ok:true}); }
      const who = request.headers.get('authorization')?.replace('Bearer identity-', '');
      if (!['alice','bob'].includes(who)) return Response.json({success:false}, {status:401});
      if (state.fail) return Response.json({success:false}, {status:503});
      if (url.pathname === '/v1/profile') return Response.json({success:true,profile:{id:'identity_'+who,email:who+'@example.test',name:who,status:'active'}});
      if (url.pathname === '/v1/accounts') return Response.json({success:true,accounts:[
        {account:{id:'personal-'+who,name:who,type:'personal',accessMode:'full',status:'active'},role:'owner',permissions:['resources:operate']},
        ...((who==='alice'||state.bobMember)?[{account:{id:'team-shared',name:'Existing Autohand Team',type:'team',accessMode:state.readOnly?'read_only':'full',status:state.readOnly?'suspended':'active'},role:who==='alice'?'owner':'contributor',permissions:state.writable?['resources:operate']:[]}]:[])
      ]});
      return Response.json({success:false},{status:404});
    }};` }] }));
  const db = await runtime.getD1Database("DB", apiName);
  for (const name of (await readdir("migrations")).filter(name => name.endsWith(".sql")).sort()) {
    const migration = await readFile(`migrations/${name}`, "utf8");
    await db.batch(migration.split(";").filter(sql => sql.trim()).map(sql => db.prepare(sql)));
  }
  alice = String((await call("/v1/auth/exchange", "POST", { identityToken: "identity-alice", deviceName: "Alice" }, "")).json.data.token);
  bob = String((await call("/v1/auth/exchange", "POST", { identityToken: "identity-bob", deviceName: "Bob" }, "")).json.data.token);
});
after(async () => { await runtime?.dispose(); });

test("personal ownership comes from the immutable identity, not email, paths or caller fields", async () => {
  assert.equal((await call(`${personal}/agents`, "GET", undefined, "")).status, 401);
  const own = await call<{ owners: { owner: { id: string; kind: string }; canWrite: boolean }[] }>("/v1/owners");
  assert.equal(own.json.data.owners[0].owner.id, "identity_alice");
  assert.equal(own.json.data.owners.length, 1);
  assert.equal((await write(personal, "eva", 0, agent("eva"))).json.error?.code, "files_missing");
  await upload(personal, bob);
  assert.equal((await write(personal, "eva", 0, agent("eva"))).json.error?.code, "files_missing", "another owner's identical blob is not a grant");
  await upload();
  const created = await write(personal, "eva", 0, agent("eva"), alice, undefined, "create-eva");
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.deepEqual(created.json.data.owner, { kind: "user", issuer: "https://api.autohand.ai", id: "identity_alice" });
  assert.equal((await call(`${personal}/agents/eva`, "GET", undefined, bob)).status, 404);
  assert.equal((await call(`${personal}/agents/eva/files/memory-file`, "GET", undefined, bob)).status, 404);
  assert.equal((await call(`${personal}/agents/eva/memories`, "GET", undefined, bob)).status, 404);
  const spoofed = agent("spoofed"); spoofed.profile.ownership = { kind: "user", id: "identity_bob" };
  assert.equal((await write(personal, "spoofed", 0, spoofed)).json.error?.code, "ownership_immutable");
  assert.equal((await write(personal, "different-id", 0, agent("eva"))).json.error?.code, "agent_id_mismatch");
});
test("a team operation requires a current matching Autohand identity and its real membership", async () => {
  assert.equal((await call(`${team}/agents`)).json.error?.code, "identity_required");
  assert.equal((await call(`${team}/agents`, "GET", undefined, bob, "identity-alice")).json.error?.code, "identity_mismatch");
  const owners = await call<{ owners: { owner: { kind: string; id: string }; canWrite: boolean }[] }>("/v1/owners", "GET", undefined, bob, "identity-bob");
  assert(owners.json.data.owners.some(item => item.owner.id === "team-shared" && item.canWrite));
  await upload(team, alice, "identity-alice");
  const created = await write(team, "team-eva", 0, agent("team-eva"), bob, "identity-bob");
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal((await call(`${team}/agents/team-eva/memories`, "GET", undefined, bob, "identity-bob")).status, 200);
  await fixture({ bobMember: false });
  for (const path of ["agents", "agents/team-eva", "agents/team-eva/memories", "agents/team-eva/files", "agents/team-eva/files/memory-file", "export"]) {
    const response = await runtime.dispatchFetch(`https://owned.example.test${team}/${path}`, { headers: { authorization: `Bearer ${bob}`, "x-autohand-identity": "identity-bob" } });
    assert.equal(response.status, 404, `membership revocation applies to ${path}`);
  }
  await fixture({ bobMember: true, readOnly: true });
  assert.equal((await call(`${team}/agents/team-eva`, "GET", undefined, bob, "identity-bob")).status, 200);
  assert.equal((await write(team, "team-eva", 1, agent("team-eva"), bob, "identity-bob")).status, 403);
  const backup = await runtime.dispatchFetch(`https://owned.example.test${team}/export?format=json`, { headers: { authorization: `Bearer ${bob}`, "x-autohand-identity": "identity-bob" } });
  assert.equal(backup.status, 200);
  assert.equal((await parseBackup(await backup.text(), "json")).agents.length, 1, "read-only members retain portability");
  await fixture({ readOnly: false, writable: false });
  assert.equal((await write(team, "team-eva", 1, agent("team-eva"), alice, "identity-alice")).status, 403, "owner role alone cannot override entitlements");
  await fixture({ writable: true, fail: true });
  assert.equal((await call(`${team}/agents/team-eva`, "GET", undefined, alice, "identity-alice")).status, 503, "upstream failure cannot retain an earlier grant");
  await fixture({ fail: false });
});
test("CAS and idempotency preserve one accepted revision without cross-agent replay", async () => {
  const replay = await write(personal, "eva", 0, agent("eva"), alice, undefined, "create-eva");
  assert.equal(replay.status, 200); assert.equal(replay.json.data.revision, 1);
  assert.equal((await write(personal, "other", 0, agent("other"), alice, undefined, "create-eva")).json.error?.code, "idempotency_conflict");
  const results = await Promise.all(Array.from({ length: 6 }, (_, index) => write(personal, "eva", 1, { ...agent("eva"), profile: { name: `Eva ${index}` } })));
  assert.equal(results.filter(result => result.status === 200).length, 1);
  assert(results.filter(result => result.status !== 200).every(result => result.status === 409));
  assert.equal((await call(`${personal}/agents/eva`)).json.data.revision, 2);
});
test("actual R2-backed JSON/YAML exports preserve metadata, arbitrary extensions and exact file bytes", async () => {
  assert.equal((await write(personal, "noah", 0, agent("noah"))).status, 201, "members can use the same logical memory filename and file ID");
  for (const format of ["json", "yaml"] as const) {
    const response = await runtime.dispatchFetch(`https://owned.example.test${personal}/export?format=${format}`, { headers: { authorization: `Bearer ${alice}` } });
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    const backup = await parseBackup(await response.text(), format);
    assert.equal(backup.owner.id, "identity_alice"); assert.equal(backup.agents.length, 2);
    assert.deepEqual(backup.agents[0].extensions, agent("eva").extensions);
    assert.equal(Buffer.from(backup.files[0].content, "base64").compare(Buffer.from(content)), 0);
  }
  const response = await runtime.dispatchFetch(`https://owned.example.test${personal}/agents/eva/files/memory-file`, { headers: { authorization: `Bearer ${alice}` } });
  assert.equal(response.status, 200); assert.equal(Buffer.from(await response.arrayBuffer()).compare(Buffer.from(content)), 0);
  const invalid = await runtime.dispatchFetch(`https://owned.example.test${personal}/files/${hash}`, { method: "PUT", body: "tampered", headers: { authorization: `Bearer ${alice}` } });
  assert.equal(invalid.status, 400);
  const entries = await call<{ agents: { id: string; name: string }[] }>(`${personal}/agents`);
  assert.equal(entries.json.data.agents.length, 2); assert.equal(entries.json.data.agents[0].id, "eva");
  const bucket = await runtime.getR2Bucket("MEMORY", apiName);
  assert((await bucket.list()).objects.every(object => object.key.startsWith("owners/")));
  assert.equal((await write(personal, "noah", 1, null)).status, 200);
});
test("explicit deletion keeps a revision tombstone and cannot be resurrected by a stale create", async () => {
  assert.equal((await write(personal, "eva", 2, null)).status, 200);
  assert.equal((await write(personal, "eva", 0, agent("eva"))).status, 409);
  const record = await call(`${personal}/agents/eva`);
  assert.equal(record.json.data.deleted, true); assert.equal(record.json.data.revision, 3);
  assert.equal((await call<{ agents: unknown[] }>(`${personal}/agents`)).json.data.agents.length, 0);
});
test("frozen plans survive live edits and deletion, stay owner-bound, and expire", async () => {
  assert.equal((await write(personal, "frozen", 0, agent("frozen"))).status, 201);
  const created = await call<{ id: string }>(`${personal}/exports`, "POST", { agentIds: ["frozen"] }, alice, undefined, "freeze-one");
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const path = `${personal}/exports/${created.json.data.id}`;
  assert.equal((await call(`${personal}/exports`, "POST", { agentIds: ["frozen"] }, alice, undefined, "freeze-one")).json.data.id, created.json.data.id);
  assert.equal((await call(`${personal}/exports`, "POST", {} , alice, undefined, "freeze-one")).status, 409);
  assert.equal((await call(`${personal}/exports`, "POST", { agentIds: ["missing"] }, alice, undefined, "missing-plan")).status, 404);
  assert.equal((await write(personal, "frozen", 1, null)).status, 200);
  assert.equal((await call(`${path}/agents/frozen`)).json.data.revision, 1);
  assert.equal((await call<{ agents: { id: string }[] }>(`${path}/agents?limit=1`)).json.data.agents[0].id, "frozen");
  const fileResponse = await runtime.dispatchFetch(`https://owned.example.test${path}/agents/frozen/files/memory-file`, { headers: { authorization: `Bearer ${alice}` } });
  assert.equal(fileResponse.status, 200); assert.equal(Buffer.compare(Buffer.from(await fileResponse.arrayBuffer()), Buffer.from(content)), 0);
  assert.equal((await call(path, "GET", undefined, bob)).status, 404);
  const db = await runtime.getD1Database("DB", apiName);
  await db.prepare("UPDATE owned_exports SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(created.json.data.id).run();
  assert.equal((await call(`${path}/agents/frozen`)).status, 410);
});
test("read-only team members can freeze exports and revoked memberships cannot reuse them", async () => {
  await fixture({ readOnly: true });
  const created = await call<{ id: string }>(`${team}/exports`, "POST", {}, bob, "identity-bob", "readonly-plan");
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const path = `${team}/exports/${created.json.data.id}`;
  await fixture({ bobMember: false });
  for (const suffix of ["", "/agents", "/agents/team-eva", "/agents/team-eva/files/memory-file", "/state"]) {
    assert.equal((await call(`${path}${suffix}`, "GET", undefined, bob, "identity-bob")).status, 404);
  }
  await fixture({ bobMember: true, readOnly: false });
});
test("the Node exporter uses frozen paginated records and publishes only verified JSON/YAML files", async () => {
  for (const id of ["export-a", "export-b"]) assert.equal((await write(personal, id, 0, agent(id))).status, 201);
  const dir = await mkdtemp(join(tmpdir(), "squad-owned-export-"));
  let allowed = true, pages = 0, corrupt = false;
  const client = createOwnedCloudClient({ owner: { kind: "user", issuer: "https://api.autohand.ai", id: "identity_alice" }, token: alice,
    baseUrl: "https://owned.example.test", fetchImpl: (input: string, init: RequestInit) => {
      const url = new URL(input);
      if (url.pathname.endsWith('/agents')) { url.searchParams.set('limit', '1'); pages++; }
      if (corrupt && url.pathname.includes('/files/')) return Promise.resolve(new Response('tampered bytes'));
      return runtime.dispatchFetch(url.href, init);
    },
    assertCurrent() { assert(allowed, "context changed"); } });
  try {
    for (const format of ["json", "yaml"]) {
      const outputPath = join(dir, `squad.${format}`);
      const receipt = await client.exportFile({ agentIds: ["export-a", "export-b"], format, outputPath });
      const text = await readFile(outputPath, "utf8"), restored = await parseBackup(text, format);
      assert.equal(receipt.bytes, Buffer.byteLength(text)); assert.equal(restored.agents.length, 2);
      assert.equal(Buffer.compare(Buffer.from(restored.files[0].content, "base64"), Buffer.from(content)), 0);
      await assert.rejects(client.exportFile({ agentIds: ["export-a"], format, outputPath }), { code: "EEXIST" });
      assert.equal(await readFile(outputPath, "utf8"), text, "existing backups are never overwritten");
    }
    assert(pages >= 4, 'the exporter must traverse all frozen pages');
    corrupt = true;
    await assert.rejects(client.exportFile({ format: 'json', outputPath: join(dir, 'corrupt.json') }), /changed|integrity/);
    await assert.rejects(access(join(dir, 'corrupt.json')), { code: 'ENOENT' });
    allowed = false;
    const outputPath = join(dir, "denied.json");
    await assert.rejects(client.exportFile({ format: "json", outputPath }), /context changed/);
    await assert.rejects(access(outputPath), { code: "ENOENT" });
    assert((await readdir(dir)).every(name => !name.endsWith(".partial")), "failed exports leave no partial file");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('explicit retained backups survive export expiry, stay immutable/owner-bound and require write authority to retain/remove',async()=>{
  assert.equal((await write(personal,'retained-eva',0,agent('retained-eva'))).status,201);
  const created=await call<{id:string}>(`${personal}/exports`,'POST',{agentIds:['retained-eva']},alice,undefined,'retained-plan');
  const path=`${personal}/exports/${created.json.data.id}`;
  assert.equal((await call(path+'/retain','POST',{label:'Personal recovery snapshot'},bob)).status,404);
  const retained=await call<{retainedAt:string;expiresAt:null;label:string}>(path+'/retain','POST',{label:'Personal recovery snapshot'});
  assert.equal(retained.status,200,JSON.stringify(retained.json));assert.equal(retained.json.data.expiresAt,null);assert.equal(retained.json.data.label,'Personal recovery snapshot');
  assert.deepEqual((await call(path+'/retain','POST',{label:'A retry cannot rename it'})).json.data,retained.json.data,'retention is idempotent and cannot silently mutate snapshot metadata');
  const db=await runtime.getD1Database('DB',apiName);
  const audit=await db.prepare("SELECT count(*) AS n FROM agent_audit WHERE target_id=? AND action='backup.retained'").bind(created.json.data.id).first<{n:number}>();assert.equal(audit?.n,1);
  await db.prepare("UPDATE owned_exports SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(created.json.data.id).run();
  // Execute the actual retention predicate used by scheduled cleanup, using
  // the real D1 store rather than an in-memory approximation.
  await db.prepare('DELETE FROM owned_exports WHERE expires_at<? AND retained_at IS NULL').bind(new Date().toISOString()).run();
  assert.equal((await call(path+'/agents/retained-eva')).status,200);
  assert.equal((await write(personal,'retained-eva',1,null)).status,200);
  assert.equal((await call(path+'/agents/retained-eva')).json.data.revision,1,'retention keeps frozen revisions after live deletion');
  const list=await call<{backups:{id:string}[];hasMore:boolean}>(`${personal}/exports?limit=1`);assert.equal(list.json.data.backups[0].id,created.json.data.id);
  assert.equal((await call(`${personal}/exports?cursor=bad`)).status,400);
  assert.equal((await call<{backups:unknown[]}>(`${personal}/exports`,'GET',undefined,bob)).json.data.backups.length,0);
  const dir=await mkdtemp(join(tmpdir(),'squad-retained-cloud-'));
  try {
    const client=createOwnedCloudClient({owner:{kind:'user',issuer:'https://api.autohand.ai',id:'identity_alice'},token:alice,baseUrl:'https://owned.example.test',fetchImpl:(url:string,init:RequestInit)=>runtime.dispatchFetch(url,init),assertCurrent(){}});
    await client.exportFile({planId:created.json.data.id,format:'yaml',outputPath:join(dir,'retained.yaml')});
    const document=await parseBackup(await readFile(join(dir,'retained.yaml'),'utf8'),'yaml');assert.equal(document.agents[0].id,'retained-eva');
  }finally{await rm(dir,{recursive:true,force:true});}
  await fixture({readOnly:true});
  const readOnly=await call<{id:string}>(`${team}/exports`,'POST',{},bob,'identity-bob','retained-readonly-plan');
  assert.equal((await call(`${team}/exports/${readOnly.json.data.id}/retain`,'POST',{label:'No authority'},bob,'identity-bob')).status,403);
  assert.equal((await call(`${team}/exports/${readOnly.json.data.id}`,'DELETE',{confirm:'remove-cloud-backup'},bob,'identity-bob')).status,403);
  await fixture({readOnly:false});
  assert.equal((await call(path,'DELETE',{confirm:'unreviewed'})).status,400);
  assert.equal((await call(path,'DELETE',{confirm:'remove-cloud-backup'})).status,200);
  assert.equal((await call(path)).status,404);
});
test('a writable uploaded snapshot state is immutable inside its plan without replacing live shared state',async()=>{
  const before=(await call(personal+'/state')).json.data;
  const state={shared:{data:{channels:[{id:'snapshot-channel',name:'Snapshot only'}]},files:[]},workspaces:[{id:'managed',label:'Work',pathHint:'/source/work'}],omissions:[],extensions:{'vendor.example':{exact:true}}};
  const created=await call<{id:string}>(personal+'/exports','POST',{agentIds:['export-a'],includeShared:true,state},alice,undefined,'custom-snapshot-state');
  assert.equal(created.status,201,JSON.stringify(created.json));const path=`${personal}/exports/${created.json.data.id}`;
  assert.deepEqual((await call(path+'/state')).json.data.content,state);
  assert.deepEqual((await call(personal+'/state')).json.data,before,'a backup must not overwrite the live shared head');
  const sharedOnly=await call<{id:string}>(personal+'/exports','POST',{agentIds:[],state},alice,undefined,'shared-only-snapshot');
  assert.equal(sharedOnly.status,201);assert.equal((await call<{agents:unknown[]}>(`${personal}/exports/${sharedOnly.json.data.id}/agents`)).json.data.agents.length,0,'an explicit empty selection does not capture unrelated existing cloud agents');
  assert.equal((await call(personal+'/exports','POST',{agentIds:['export-a'],includeShared:true,state:{...state,extensions:{}}},alice,undefined,'custom-snapshot-state')).status,409);
  await fixture({readOnly:true});
  assert.equal((await call(team+'/exports','POST',{state},bob,'identity-bob','readonly-custom-state')).status,403);
  await fixture({readOnly:false});
});
test('the local cloud service saves exact retained snapshots, previews restores, fences identity and resolves explicit CAS conflicts',async()=>{
  const serviceRoot=await mkdtemp(join(tmpdir(),'squad-owned-cloud-service-'));
  const owner={kind:'user',issuer:'https://api.autohand.ai',id:'identity_alice'},actor={issuer:owner.issuer,id:owner.id,email:'alice@example.test',name:'Alice'};
  let active=true,loseRetainResponse=false,calls=0,broker:ReturnType<typeof createOwnershipBroker>|undefined;
  const assertCurrent=()=>assert(active,'context changed');
  const fetchImpl=async(url:string,init:RequestInit)=>{calls++;const response=await runtime.dispatchFetch(url,init);if(loseRetainResponse&&new URL(url).pathname.endsWith('/retain')&&response.ok){loseRetainResponse=false;throw Error('Lost retain response');}return response;};
  try {
    const paths=await ensureDataset(serviceRoot,ownerKey(owner)),context={...paths,serviceRoot,owner,actor,generation:crypto.randomUUID(),canWrite:true};
    const profile={id:'cloud-desktop',name:'Local Eva',role:'QA',ownership:owner,memory:[{id:'preference',text:'Keep evidence.'}]};
    const channels=()=>({version:1,channels:[],threads:[],messages:[],agentChannelAccess:{'cloud-desktop':{agent:profile,removed:false}}});
    await writeFile(join(paths.dataRoot,'channels.json'),JSON.stringify(channels()));
    await mkdir(join(paths.appRoot,'agents','cloud-desktop','memory'),{recursive:true});
    await writeFile(join(paths.appRoot,'agents','cloud-desktop','memory','MEMORY.md'),'Exact local bytes: 世界\n\0');
    const data=createOwnedDataService({context,assertCurrent});
    const cloud=createOwnedCloudBackups({context,assertCurrent,identityToken:'identity-alice',baseUrl:'https://owned.example.test',fetchImpl});
    const local=await data.createBackup({format:'json'}),request={id:crypto.randomUUID(),backupId:local.id,label:'First personal backup'};
    const saved=await cloud.save(request);assert.equal(saved.phase,'complete');assert.ok(saved.planId);
    const list=await cloud.list();assert(list.backups.some((item:{id:string})=>item.id===saved.planId));
    const preview=await cloud.prepareImport({planId:saved.planId,format:'yaml'});assert.equal(preview.memberCount,1);assert.equal(preview.fileCount,1);
    let remote=(await call(`${personal}/agents/cloud-desktop`)).json.data as {revision:number;content:Agent};
    assert.equal(remote.content.profile.name,'Local Eva');
    const originalRevision=remote.revision;
    const edited=structuredClone(remote.content);edited.profile.name='Remote Eva';assert.equal((await write(personal,'cloud-desktop',remote.revision,edited)).status,200);
    profile.name='New local Eva';await writeFile(join(paths.dataRoot,'channels.json'),JSON.stringify(channels()));
    const second=await data.createBackup({format:'json'}),secondRequest={id:crypto.randomUUID(),backupId:second.id,label:'Resolved local backup'};
    const conflict=await cloud.save(secondRequest);assert.equal(conflict.phase,'conflicts');assert.equal(conflict.conflicts.length,1);assert.equal(conflict.uploadedFiles,0);
    remote=(await call(`${personal}/agents/cloud-desktop`)).json.data as typeof remote;assert.equal(remote.content.profile.name,'Remote Eva');
    const resolved=await cloud.save({...secondRequest,resolutions:conflict.conflicts.map((item:{key:string;remoteRevision:number;remoteHash:string})=>({key:item.key,remoteRevision:item.remoteRevision,remoteHash:item.remoteHash,choice:'local'}))});
    assert.equal(resolved.phase,'complete');remote=(await call(`${personal}/agents/cloud-desktop`)).json.data as typeof remote;assert.equal(remote.content.profile.name,'New local Eva');
    assert.equal((await cloud.save(request)).phase,'complete');assert.equal((await call(`${personal}/agents/cloud-desktop`)).json.data.revision,remote.revision,'retrying an old completed backup cannot overwrite newer data');
    assert(remote.revision>originalRevision);
    profile.name='Retained before lost response';await writeFile(join(paths.dataRoot,'channels.json'),JSON.stringify(channels()));
    const third=await data.createBackup({format:'json'}),thirdRequest={id:crypto.randomUUID(),backupId:third.id,label:'Lost-response snapshot'};
    loseRetainResponse=true;await assert.rejects(cloud.save(thirdRequest),/Lost retain response/);
    remote=(await call(`${personal}/agents/cloud-desktop`)).json.data as typeof remote;
    const later=structuredClone(remote.content);later.profile.name='External edit after retain';assert.equal((await write(personal,'cloud-desktop',remote.revision,later)).status,200);
    const recovered=await cloud.save(thirdRequest);assert.equal(recovered.phase,'complete');
    assert.equal((await call(`${personal}/agents/cloud-desktop`)).json.data.revision,remote.revision+1,'retained lost-response recovery does not replay a later current-head mutation');
    const readOnly=createOwnedCloudBackups({context:{...context,canWrite:false},assertCurrent,identityToken:'identity-alice',baseUrl:'https://owned.example.test',fetchImpl});
    await assert.rejects(readOnly.save({id:crypto.randomUUID(),backupId:local.id,label:'Denied'}),{code:'owner_read_only'});
    const wrong=createOwnedCloudBackups({context,assertCurrent,identityToken:'identity-bob',baseUrl:'https://owned.example.test',fetchImpl});
    await assert.rejects(wrong.list(),{code:'cloud_identity_mismatch'});
    active=false;const beforeCalls=calls;await assert.rejects(cloud.list(),/context changed/);await assert.rejects(cloud.status(request.id),/context changed/);assert.equal(calls,beforeCalls);
    active=true;
    let person:'alice'|'bob'='alice',stall=false,admitted:()=>void=()=>{};
    const tokens={alice:'identity-alice',bob:'identity-bob'},fingerprints={alice:await sha256(new TextEncoder().encode(tokens.alice)),bob:await sha256(new TextEncoder().encode(tokens.bob))};
    const identity={credential:()=>({token:tokens[person],fingerprint:fingerprints[person]}),verify:async(current:{fingerprint:string})=>({actor:{issuer:owner.issuer,id:`identity_${person}`,email:`${person}@example.test`,name:person},fingerprint:current.fingerprint,expiresAt:Date.now()+3600_000}),
      personal(value:{actor:{id:string}}){return {owner:{kind:'user',issuer:owner.issuer,id:value.actor.id},label:person,role:'owner',canWrite:true};},
      async authorize(value:{actor:{id:string}},selected:typeof owner){assert.equal(selected.id,value.actor.id);return {owner:selected,label:person,role:'owner',canWrite:true};}};
    const rootDir=fileURLToPath(new URL('../../../',import.meta.url));
    broker=createOwnershipBroker({rootDir,serviceRoot,configPath:join(serviceRoot,'fixture-only-config'),identity,port:0,workerEntry:join(rootDir,'scripts','fixtures','ownership-worker.mjs'),ownedCloudBaseUrl:'https://owned.example.test',ownedCloudFetch:(url:string,init:RequestInit)=>{
      if(stall&&new URL(url).pathname.endsWith('/exports'))return new Promise<Response>((_resolve,reject)=>{admitted();init.signal?.addEventListener('abort',()=>reject(init.signal?.reason||Error('cancelled')),{once:true});});
      return fetchImpl(url,init);
    }});
    const origin=await broker.listen();
    for(let i=0;i<200&&broker.context().state!=='ready';i++)await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(broker.context().state,'ready');const generation=broker.context().generation;
    const localCall=(path:string,method='GET',value?:unknown,gen=broker!.context().generation)=>fetch(origin+path,{method,headers:{'x-squad-context':gen,'content-type':'application/json'},...(value===undefined?{}:{body:JSON.stringify(value)})});
    let response=await localCall('/api/ownership/cloud/backups');assert.equal(response.status,200,await response.clone().text());assert((await response.json()).data.backups.some((item:{id:string})=>item.id===saved.planId));
    response=await localCall('/api/ownership/cloud/imports','POST',{id:crypto.randomUUID(),planId:saved.planId,format:'json'});assert.equal(response.status,201,await response.clone().text());assert.equal((await response.json()).data.memberCount,1);
    const mcp=createTools(createBridgeClient(origin));
    for(const name of ['list_cloud_backups','save_cloud_backup','get_cloud_backup_operation','download_cloud_backup','prepare_cloud_restore','remove_cloud_backup','reconnect_cloud_backups'])assert(TOOLS.some(tool=>tool.name===name)&&typeof mcp[name]==='function');
    assert((await mcp.list_cloud_backups()).backups.some((item:{id:string})=>item.id===saved.planId));
    const downloaded=await mcp.download_cloud_backup({backup_id:saved.planId,format:'yaml'}),downloadedDocument=await parseBackup(await(await fetch(downloaded.download_url)).text(),'yaml');
    assert.equal(downloadedDocument.agents[0].profile.name,'Local Eva');assert.equal(Buffer.from(downloadedDocument.files[0].content,'base64').toString(),'Exact local bytes: 世界\n\0');
    assert.equal((await mcp.prepare_cloud_restore({backup_id:saved.planId,format:'json'})).members,1);
    assert.equal((await mcp.get_cloud_backup_operation({operation_id:request.id})).phase,'complete');
    const mcpInput={request_id:crypto.randomUUID(),backup_id:second.id,label:'MCP exact snapshot',destination_owner:owner,confirm_upload:true};
    const mcpConflicts=await mcp.save_cloud_backup(mcpInput);assert.equal(mcpConflicts.phase,'conflicts');
    const mcpSaved=await mcp.save_cloud_backup({...mcpInput,confirm_replace_cloud:true,resolutions:mcpConflicts.conflicts.map((item:{key:string;remoteRevision:number})=>({key:item.key,remote_revision:item.remoteRevision}))});assert.equal(mcpSaved.phase,'complete');
    assert.equal((await mcp.remove_cloud_backup({backup_id:mcpSaved.planId,destination_owner:owner,confirm_remove:true})).removed,true);
    assert.equal((await mcp.reconnect_cloud_backups()).connected,true);
    const admittedPromise=new Promise<void>(resolve=>{admitted=resolve;});stall=true;
    const oldRequest=localCall('/api/ownership/cloud/backups');await admittedPromise;person='bob';
    response=await oldRequest;assert.equal(response.status,409);assert.equal((await response.text()).includes('First personal backup'),false,'a cancelled A cloud request cannot return its private result after switching');
    for(let i=0;i<200&&(broker.context().actor?.id!=='identity_bob'||broker.context().state!=='ready');i++)await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(broker.context().actor?.id,'identity_bob');
    assert.equal((await localCall('/api/ownership/cloud/backups','GET',undefined,generation)).status,409);
    await assert.rejects(mcp.list_cloud_backups(),/context|account|changed/i,'old MCP cloud clients never retarget to a new actor');
    stall=false;response=await localCall('/api/ownership/cloud/backups');assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).data.backups.length,0,'B cannot list A retained cloud snapshots');
    assert.equal((await localCall(`/api/ownership/cloud/operations/${request.id}`)).status,404,'B cannot adopt A local cloud receipt');
  }finally{await broker?.close();await rm(serviceRoot,{recursive:true,force:true});}
});
