export const name='project-observer';

export async function handle(req,res,url,ctx){
  if(!url.pathname.startsWith('/api/project-observer'))return false;
  if(!ctx.projectObserver){ctx.json(res,503,{success:false,error:'Project observation is unavailable on this bridge.'});return true;}
  try{
    if(url.pathname==='/api/project-observer'&&req.method==='GET'){
      ctx.json(res,200,{success:true,data:await ctx.projectObserver.snapshot()});return true;
    }
    if(url.pathname==='/api/project-observer'&&['PUT','POST'].includes(req.method)){
      const body=await ctx.readBody(req);
      ctx.json(res,200,{success:true,data:await ctx.projectObserver.update(body)});return true;
    }
    if(url.pathname==='/api/project-observer/notices'&&req.method==='GET'){
      const snapshot=await ctx.projectObserver.snapshot();const after=Date.parse(url.searchParams.get('after')||'');
      ctx.json(res,200,{success:true,data:Number.isFinite(after)?snapshot.notices.filter(item=>Date.parse(item.createdAt)>after):snapshot.notices});return true;
    }
    if(url.pathname==='/api/project-observer/scan'&&req.method==='POST'){
      // This requests a scheduler cycle; it never overrides eligibility,
      // cooldown, deduplication or the persisted provider budget.
      void ctx.projectObserver.tick().catch(error=>ctx.emit?.('project.observer.error',{error:error.message}));
      ctx.json(res,202,{success:true,data:await ctx.projectObserver.snapshot()});return true;
    }
  }catch(error){ctx.json(res,error.status||400,{success:false,error:error.message});return true;}
  return false;
}
