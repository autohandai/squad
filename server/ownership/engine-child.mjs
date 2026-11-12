import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

let scope,closing=false;
const active=new Set(),pending=new Map();
const gate=fileURLToPath(new URL('./engine-gate.mjs',import.meta.url));
export function configureOwnedEngines(value){
  if(scope)throw Error('Engine supervision cannot change ownership.');
  scope=value;
  process.on('message',message=>{
    if(message?.type!=='ownership-engine-reply')return;
    const request=pending.get(message.requestId);if(!request)return;
    pending.delete(message.requestId);clearTimeout(request.timer);
    if(message.success)request.resolve();else request.reject(Error(message.error||'Engine supervision was refused.'));
  });
  process.once('disconnect',()=>{
    for(const request of pending.values()){clearTimeout(request.timer);request.reject(Error('The ownership broker disconnected.'));}pending.clear();
  });
}
function request(phase,id,pid){
  return new Promise((resolve,reject)=>{
    const requestId=randomUUID();
    const timer=setTimeout(()=>{pending.delete(requestId);reject(Error('Engine supervision timed out.'));},30_000);
    pending.set(requestId,{resolve,reject,timer});
    try{process.send({type:'ownership-engine',phase,id,pid,generation:scope.generation,requestId},error=>{if(error){pending.delete(requestId);clearTimeout(timer);reject(error);}});}
    catch(error){pending.delete(requestId);clearTimeout(timer);reject(error);}
  });
}
function absent(pid){try{process.kill(-pid,0);return false;}catch(error){if(error.code==='ESRCH')return true;throw error;}}
async function waitAbsent(pid){
  const deadline=Date.now()+5000;
  while(!absent(pid)){if(Date.now()>=deadline)throw Error('The owned engine group did not finish draining.');await new Promise(resolve=>setTimeout(resolve,20));}
}

export async function spawnOwnedEngine(executable,args,options){
  // Windows descendants already inherit the private worker's kill-on-close
  // Job Object. Unconfigured callers are standalone adapter unit fixtures.
  if(!scope||process.platform==='win32')return new Promise((resolve,reject)=>{
    const child=spawn(executable,args,options);
    child.once('error',reject);child.once('spawn',()=>resolve(child));
  });
  scope.assertCurrent();if(closing)throw Error('The owned engine service is closing.');
  const id=randomUUID();
  const raw=spawn(process.execPath,[gate],{...options,detached:true,shell:false,stdio:[...options.stdio,'ipc']});
  let outcome,failure,registered=false,returned=false,readyResolve,readyReject;
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  const child=new EventEmitter();
  Object.assign(child,{ownedEngine:true,pid:raw.pid,stdin:raw.stdin,stdout:raw.stdout,stderr:raw.stderr,exitCode:null,signalCode:null,killed:false});
  const send=type=>{if(raw.connected)raw.send({type},()=>{});};
  child.kill=signal=>{child.killed=true;send(signal==='SIGKILL'?'cleanup':'stop');return true;};
  raw.on('message',message=>{
    if(message?.type==='engine-ready'&&message.pid===raw.pid)readyResolve();
    if(message?.type==='engine-outcome')outcome={code:message.code,signal:message.signal};
    if(message?.type==='engine-error')failure=Error(message.message||'The engine could not start.');
  });
  raw.once('error',error=>{failure=error;readyReject(error);});
  let finishResolve,finishReject;
  const done=new Promise((resolve,reject)=>{finishResolve=resolve;finishReject=reject;});done.catch(()=>{});
  const entry={child,done};active.add(entry);
  raw.once('close',async(code,signal)=>{
    readyReject(failure||Error('The engine gate closed before startup.'));
    try {
      await waitAbsent(raw.pid);
      if(registered&&process.connected)await request('finished',id,raw.pid);
      if(!outcome&&!failure)failure=Error('The engine gate closed without a completion receipt.');
      child.exitCode=outcome?outcome.code:code;child.signalCode=outcome?outcome.signal:signal;
      if(failure&&returned)child.emit('error',failure);
      child.emit('exit',child.exitCode,child.signalCode);child.emit('close',child.exitCode,child.signalCode);
      finishResolve();
    }catch(error){finishReject(error);if(returned)child.emit('error',error);}
    finally{active.delete(entry);}
  });
  try {
    await ready;
    await request('start',id,raw.pid);registered=true;
    scope.assertCurrent();if(closing)throw Error('The owned engine service closed during startup.');
    raw.send({type:'start',executable,args,cwd:options.cwd,env:options.env||process.env});
    returned=true;return child;
  }catch(error){send('cleanup');await done.catch(()=>{});throw error;}
}

export async function drainOwnedEngines(){
  closing=true;
  const entries=[...active];for(const entry of entries)entry.child.kill('SIGTERM');
  await Promise.all(entries.map(entry=>entry.done));
}
