export const name='model-routing';
export async function handle(req,res,url,ctx){
  const match=/^\/api\/members\/([^/]+)\/model-routing(?:\/(reset))?$/.exec(url.pathname);
  if(!match)return false;
  if((match[2]&&req.method!=='POST')||(!match[2]&&req.method!=='GET'))return false;
  try{
    const memberId=decodeURIComponent(match[1]);
    if(match[2])await ctx.fallbackRouter.reset(memberId);
    ctx.json(res,200,{success:true,data:{configuration:await ctx.memberModelRouting(memberId),health:await ctx.fallbackRouter.health(memberId)}});
  }catch(error){ctx.json(res,error.status||400,{success:false,error:error.message});}
  return true;
}
