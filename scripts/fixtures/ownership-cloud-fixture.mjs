import { createHash,randomUUID } from 'node:crypto';

// In-process cloud transport for rendered UI checks. Real D1/R2, CAS,
// membership and lost-response behavior are tested separately by squad-api.
export function createCloudFixture({owner,actor,identityToken}) {
  const agents=new Map(),files=new Map(),plans=new Map();let calls=0;
  const token=`ss_${'f'.repeat(64)}`,ok=(data,status=200)=>Response.json({success:true,data},{status});
  const fail=(message,status=404,code='not_found')=>Response.json({success:false,error:{message,code}},{status});
  return {
    get calls(){return calls;},get retainedCount(){return [...plans.values()].filter(plan=>plan.retainedAt).length;},
    agent:id=>structuredClone(agents.get(id)),
    edit(id,update){const record=structuredClone(agents.get(id));update(record.content);record.revision++;agents.set(id,record);},
    async fetch(input,init={}) {
      calls++;const url=new URL(input),path=url.pathname,headers=new Headers(init.headers);
      const value=()=>JSON.parse(String(init.body||'{}'));
      if(path==='/v1/auth/exchange')return value().identityToken===identityToken?ok({token,expiresAt:'2099-01-01T00:00:00.000Z',user:{id:'fixture-user'}}):fail('Wrong fixture identity',401);
      if(headers.get('authorization')!==`Bearer ${token}`)return fail('Wrong fixture session',401);
      if(path==='/v1/me')return ok({issuer:actor.issuer,subject:actor.id,id:'fixture-user'});
      if(path==='/v1/auth/session'&&init.method==='DELETE')return ok({signedOut:true});
      const file=path.match(/^\/v1\/users\/me\/files\/([a-f0-9]{64})$/);
      if(file&&init.method==='PUT') {const bytes=Buffer.from(init.body);if(createHash('sha256').update(bytes).digest('hex')!==file[1])return fail('Checksum mismatch',400);files.set(file[1],bytes);return ok({sha256:file[1],bytes:bytes.length},201);}
      const agent=path.match(/^\/v1\/users\/me\/agents\/([^/]+)$/);
      if(agent) {
        const id=decodeURIComponent(agent[1]),before=agents.get(id);
        if(init.method==='PUT') {const body=value();if((before?.revision||0)!==body.baseRevision)return fail('Fixture revision changed',409,'revision_conflict');const record={kind:'agent',id,revision:body.baseRevision+1,deleted:false,owner,content:body.content};agents.set(id,structuredClone(record));return ok(record,201);}
        return before?ok(before):fail('Agent not found',404,'agent_not_found');
      }
      if(path==='/v1/users/me/exports') {
        if(init.method==='POST') {
          const body=value(),id=randomUUID(),now=new Date().toISOString();
          const chosen=(body.agentIds||[...agents.keys()]).map(id=>structuredClone(agents.get(id))).sort((a,b)=>a.id.localeCompare(b.id));
          if(chosen.some(record=>!record))return fail('Missing fixture agent');
          const plan={id,owner,createdAt:now,expiresAt:'2099-01-01T00:00:00.000Z',includeShared:true,retainedAt:null,label:'',agents:chosen,state:structuredClone(body.state||{shared:{data:{},files:[]},workspaces:[],omissions:[],extensions:{}})};plans.set(id,plan);return ok(plan,201);
        }
        return ok({backups:[...plans.values()].filter(plan=>plan.retainedAt).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(({agents,state,...plan})=>({...plan,memberCount:agents.length})),hasMore:false,cursor:''});
      }
      const exported=path.match(/^\/v1\/users\/me\/exports\/([a-f0-9-]{36})(?:\/(.*))?$/),plan=exported&&plans.get(exported[1]);
      if(!plan)return fail('Unexpected fixture cloud path');
      const suffix=exported[2]||'';
      if(suffix==='retain'&&init.method==='POST'){plan.retainedAt ||=new Date().toISOString();plan.label ||=value().label;plan.expiresAt=null;return ok(plan);}
      if(!suffix&&init.method==='DELETE'){if(value().confirm!=='remove-cloud-backup')return fail('Confirmation missing',400);plans.delete(plan.id);return ok({id:plan.id,removed:true});}
      if(!suffix)return ok(plan);
      if(suffix==='agents')return ok({...plan,agents:plan.agents.map(record=>({id:record.id,revision:record.revision,name:record.content.profile.name})),hasMore:false,cursor:plan.agents.at(-1)?.id||''});
      if(suffix==='state')return ok({kind:'squad',id:'state',revision:1,deleted:false,owner,content:plan.state});
      const item=suffix.match(/^agents\/([^/]+)(?:\/files\/([^/]+))?$/);
      const record=item&&plan.agents.find(record=>record.id===decodeURIComponent(item[1]));
      if(!record)return fail('Missing fixture export record');
      if(item[2]) {const ref=record.content.files.find(file=>file.id===decodeURIComponent(item[2])),bytes=ref&&files.get(ref.sha256);return bytes?new Response(bytes,{headers:{'content-type':ref.mediaType}}):fail('Missing fixture payload');}
      return ok(record);
    },
  };
}
