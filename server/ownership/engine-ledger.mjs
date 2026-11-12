// The broker persists each gated engine group independently of its worker.
// It never signals a numeric engine PGID: the trusted live anchor self-cleans
// on completion, stop or worker disconnect. Ambiguous survivors block recovery.
import { z } from 'zod';

const input=z.object({type:z.literal('ownership-engine'),phase:z.enum(['start','finished']),id:z.uuid(),pid:z.number().int().min(2),generation:z.uuid(),requestId:z.uuid()}).strict();
async function absent(group){
  const deadline=Date.now()+5000;
  while(true){
    try{process.kill(-group,0);}catch(error){if(error.code==='ESRCH')return;throw error;}
    if(Date.now()>=deadline)throw Error('An owned engine group has not finished. Existing data was preserved.');
    await new Promise(resolve=>setTimeout(resolve,20));
  }
}
export function createEngineLedger(getLedger){
  const entries=new Map();
  function release(entry){
    if(!entry.releasing)entry.releasing=(async()=>{
      await entry.prepared.catch(()=>{});
      await absent(entry.group);
      if(entry.intent)await entry.intent.clear();
      entries.delete(entry.id);
    })();
    return entry.releasing;
  }
  async function handle(child,message,expected,canStart){
    const parsed=input.safeParse(message);
    if(!parsed.success||message.generation!==expected||process.platform==='win32')throw Error('Invalid owned engine supervision request.');
    if(message.phase==='start'){
      if(!canStart()||entries.has(message.id))throw Error('The ownership context no longer admits an engine.');
      const entry={id:message.id,child,group:message.pid,intent:null};entries.set(entry.id,entry);
      entry.prepared=(async()=>{
        entry.intent=await getLedger().pending();
        await entry.intent.launched(entry.group);
        if(!canStart())throw Error('The ownership context changed before engine admission.');
      })();
      await entry.prepared;
    }else{
      const entry=entries.get(message.id);
      if(entry){if(entry.child!==child||entry.group!==message.pid)throw Error('The engine belongs to another worker.');await release(entry);}
    }
  }
  return {
    async message(child,message,expected,canStart){
      try{await handle(child,message,expected,canStart);if(child.connected)child.send({type:'ownership-engine-reply',requestId:message.requestId,success:true},()=>{});}
      catch(error){if(child.connected)child.send({type:'ownership-engine-reply',requestId:message.requestId,success:false,error:error.message},()=>{});}
    },
    releaseAll:()=>Promise.all([...entries.values()].map(release)),
  };
}
