// Fixture-only preload: writable UI checks must never launch a provider or
// contact a non-loopback service, even if a background probe is introduced.
import childProcess from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
const denied=()=>{throw Error('Fixture execution is disabled.');};
for(const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])childProcess[key]=denied;
// spawnSync reports an unavailable executable as a result, rather than
// throwing. Match that contract so normal runtime availability can render.
childProcess.spawnSync=()=>({status:null,signal:null,stdout:Buffer.alloc(0),stderr:Buffer.alloc(0),error:Object.assign(Error('Fixture execution is disabled.'),{code:'ENOENT'})});
const local=host=>['localhost','127.0.0.1','::1','[::1]'].includes(String(host||'localhost'))||['localhost','127.0.0.1','[::1]'].includes(String(host).replace(/:\d+$/,''));
const hostOf=(input,options)=>input instanceof URL?input.hostname:typeof input==='string'?new URL(input,'http://localhost').hostname:input?.hostname||input?.host||options?.hostname||options?.host;
for(const module of [http,https])for(const key of ['request','get']) {
  const original=module[key];module[key]=function(input,...rest){if(!local(hostOf(input,rest[0])))throw Error('Fixture external network is disabled.');return original.call(this,input,...rest);};
}
const originalFetch=globalThis.fetch;
globalThis.fetch=(input,...rest)=>{
  const url=new URL(input instanceof Request?input.url:input);
  if(!local(url.hostname))return Promise.reject(Error('Fixture external network is disabled.'));
  return originalFetch(input,...rest);
};
syncBuiltinESMExports();
