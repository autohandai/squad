// This trusted process anchors one Unix process group. Work starts only after
// the broker has persisted that group. Only the live anchor signals its group,
// so a recycled numeric PGID is never used to kill an unrelated process.
import { spawn } from 'node:child_process';

let started=false,stopping=false,child;
const clean=()=>{process.kill(-process.pid,'SIGKILL');};
const deadline=setTimeout(clean,30_000);
function stop(){
  if(stopping)return;stopping=true;
  process.kill(-process.pid,'SIGTERM');
  setTimeout(clean,2000);
}
process.on('SIGTERM',stop);
process.on('SIGINT',stop);
process.once('disconnect',clean);
process.on('message',message=>{
  if(message?.type==='stop'){stop();return;}
  if(message?.type==='cleanup'){clean();return;}
  if(message?.type!=='start'||started)return;
  started=true;clearTimeout(deadline);
  try {
    child=spawn(message.executable,message.args,{cwd:message.cwd,env:message.env,stdio:['inherit','inherit','inherit'],detached:false,windowsHide:true});
    child.once('error',error=>{process.send?.({type:'engine-error',message:error.message},clean);});
    child.once('exit',(code,signal)=>{process.send?.({type:'engine-outcome',code,signal},clean);});
  }catch(error){process.send?.({type:'engine-error',message:error.message},clean);}
});
process.send?.({type:'engine-ready',pid:process.pid});
