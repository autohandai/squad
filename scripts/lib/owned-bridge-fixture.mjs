// Test-only identity endpoint and deliberate fixture seeding. Production never
// claims unowned folders this way; ownership/recovery checks test that boundary.
import { createServer } from 'node:http';
import { readdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureDataset } from '../../server/ownership/datasets.mjs';
import { ownerKey } from '../../server/ownership/identity.mjs';

export async function ownedFixtureHeaders(origin) {
  const context=(await(await fetch(origin+'/api/ownership/context')).json()).data;
  return {'content-type':'application/json',...(context?.generation?{'x-squad-context':context.generation}:{})};
}

export async function seedOwnedCanonicalFixture(origin,{agents=[],messages}={}) {
  const api=async(path,method='GET',body)=>{
    const response=await fetch(origin+path,{method,headers:await ownedFixtureHeaders(origin),...(body===undefined?{}:{body:JSON.stringify(body)})});
    const result=await response.json();
    if(!response.ok||!result.success)throw Error(`Canonical fixture ${path}: ${result.error||response.status}`);
    return result.data;
  };
  for(const agent of agents)await api(`/api/members/${encodeURIComponent(agent.id)}/channel-access`,'PUT',{agent,profile:'',profilePatch:{}});
  if(messages){const current=await api('/api/owned/browser-state');await api('/api/owned/browser-state','PUT',{baseRevision:current.revision||0,messagesByAgent:messages});}
  return api('/api/ownership/context');
}

// Seed canonical state through the same registry/CAS APIs as a client. Browser
// fixtures must not rely on unowned localStorage resurrecting private members.
export async function seedOwnedBrowserFixture(bridge,browser,{members=[],messages,storage={}}={}) {
  for(const member of members) {
    const response=await bridge.api(`/api/members/${encodeURIComponent(member.id)}/channel-access`,'PUT',{agent:member,profile:'',profilePatch:{}});
    if(!response.success)throw Error(`Fixture member registration failed: ${response.error}`);
  }
  if(messages) {
    const saved=await bridge.api('/api/owned/browser-state');
    const response=await bridge.api('/api/owned/browser-state','PUT',{baseRevision:saved.data.revision||0,messagesByAgent:messages});
    if(!response.success)throw Error(`Fixture conversation CAS failed: ${response.error}`);
  }
  const context=(await bridge.api('/api/ownership/context')).data;
  const records={'autohandSquad.v1.onboarding':JSON.stringify({version:1,status:'skipped'}),...storage};
  const prefix=`autohandSquad.owner.v1.${context.storageKey}.`;
  const source=Object.entries(records).map(([key,value])=>`localStorage.setItem(${JSON.stringify(prefix+encodeURIComponent(key))},${JSON.stringify(String(value))});`).join('\n');
  await browser.send('Page.addScriptToEvaluateOnNewDocument',{source:`if(location.origin===${JSON.stringify(bridge.origin)}){${source}}`});
  return context;
}

export async function createOwnedBridgeFixture({ serviceRoot, appRoot }) {
  const identity=createServer((request,response)=>{
    const token=String(request.headers.authorization||'');
    if(!/^Bearer fixture[-_a-z0-9]*$/i.test(token)){response.writeHead(401,{'content-type':'application/json'});response.end(JSON.stringify({success:false}));return;}
    const data=request.url==='/v1/profile'?{success:true,profile:{id:'fixture-owner',email:'reliability@example.test',name:'Reliability fixture'}}:request.url==='/v1/accounts'?{success:true,accounts:[]}:null;
    response.writeHead(data?200:404,{'content-type':'application/json'});response.end(JSON.stringify(data||{success:false}));
  });
  await new Promise((resolve,reject)=>{identity.once('error',reject);identity.listen(0,'127.0.0.1',resolve);});
  const issuer=`http://127.0.0.1:${identity.address().port}`,owner={kind:'user',issuer,id:'fixture-owner'};
  const names=async root=>readdir(root).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
  try {
    const stateNames=(await names(serviceRoot)).filter(name=>!name.startsWith('ownership-')&&name!=='owners');
    const appNames=await names(appRoot),paths=await ensureDataset(serviceRoot,ownerKey(owner));
    for(const name of stateNames)await rename(join(serviceRoot,name),join(paths.dataRoot,name));
    for(const name of appNames)await rename(join(appRoot,name),join(paths.appRoot,name));
    return {paths,owner,env:{AUTOHAND_SQUAD_IDENTITY_ORIGIN:issuer},close:()=>new Promise(resolve=>identity.close(resolve))};
  } catch(error){identity.close();throw error;}
}
