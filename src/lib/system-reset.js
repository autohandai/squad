import { ownedLocalStorage, currentOwnership } from './owned-storage.js';
import { ownershipFetch } from './ownership-client.js';
const PENDING_KEY = 'autohandSquad.v1.systemReset';
let resetPending = false;
export function pendingSystemReset() {
  try { return JSON.parse(ownedLocalStorage.getItem(PENDING_KEY) || 'null'); } catch { return null; }
}
export function isSystemResetPending() { return resetPending || Boolean(pendingSystemReset()); }
export function allowsPendingResetRequest(path,init={}) {
  if(!isSystemResetPending()||['GET','HEAD'].includes((init.method||'GET').toUpperCase()))return true;
  if((init.method||'GET').toUpperCase()!=='POST'||String(path).split('?')[0]!=='/api/ownership/operations')return false;
  try {
    const body=JSON.parse(init.body),pending=pendingSystemReset();
    return Boolean(pending&&body.kind==='reset'&&body.id===pending.requestId&&body.beforeDatasetId===pending.beforeDatasetId&&body.confirmation==='replace-current-squad');
  }catch{return false;}
}
export function clearPendingSystemReset() {resetPending=false;ownedLocalStorage.removeItem(PENDING_KEY);}
export function clearSquadBrowserState(storage = ownedLocalStorage) {
  for (const key of Object.keys(storage)) if (key.startsWith('autohandSquad.')) storage.removeItem(key);
}
export function getSystemResetClient({ userAgent = globalThis.navigator?.userAgent || '', invoke = globalThis.window?.__TAURI_INTERNALS__?.invoke } = {}) {
  if (!userAgent.startsWith('AutohandSquadDesktop/') || typeof invoke !== 'function') return null;
  const generation = currentOwnership()?.generation;
  return { stage: stage => invoke('squad_set_system_reset_stage', { stage, contextGeneration:generation }) };
}
async function requestJson(path, init={}) {
  const response = await fetch(path, {...init,cache:'no-store'}),envelope=await response.json();
  if(!response.ok||!envelope.success)throw Object.assign(Error(typeof envelope.error==='string'?envelope.error:'Squad could not complete this operation.'),{status:response.status,code:envelope.code});
  return envelope.data;
}
function sameOwner(context,pending) {
  return context.actor?.id===pending.actorId&&context.actor?.issuer===pending.issuer&&context.scopeKey===pending.ownerKey;
}
export async function recoverSystemReset(pending,{request=requestJson,native}={}) {
  const context=await request('/api/ownership/context');
  if(!sameOwner(context,pending))throw Error('Select the account and Squad that started this reset.');
  let receipt;
  try{receipt=await request(`/api/ownership/operations/${encodeURIComponent(pending.requestId)}`,{headers:{'x-squad-context':context.generation}});}
  catch(error){if(error.status!==404||context.state!=='ready')throw error;receipt={id:pending.requestId,beforeDatasetId:pending.beforeDatasetId,phase:'not-started'};}
  if(receipt.beforeDatasetId!==pending.beforeDatasetId||!['awaiting_restart','complete','failed','not-started'].includes(receipt.phase))throw Error('Squad is still checking reset progress.');
  if(['failed','not-started'].includes(receipt.phase)){clearPendingSystemReset();try{await native?.stage('idle');}catch{/* A changed generation has already released the old guard. */}}
  return {...receipt,phase:receipt.phase==='awaiting_restart'?'complete':receipt.phase,pending};
}
export async function performSystemReset({api,native,onRecovery=()=>{}}) {
  const context=currentOwnership();
  if(!context?.canWrite)throw Error('Select a writable personal or team Squad before resetting.');
  const pending={requestId:crypto.randomUUID(),beforeDatasetId:context.datasetId,ownerKey:context.scopeKey,actorId:context.actor.id,issuer:context.actor.issuer};
  await native?.stage('working');
  ownedLocalStorage.setItem(PENDING_KEY,JSON.stringify(pending));resetPending=true;
  try {
    const result=await api('/api/ownership/operations',{method:'POST',body:JSON.stringify({id:pending.requestId,kind:'reset',beforeDatasetId:pending.beforeDatasetId,confirmation:'replace-current-squad'})});
    return {...result.operation,phase:result.operation.phase==='awaiting_restart'?'complete':result.operation.phase,pending};
  } catch(error) {
    try{await native?.stage('idle');}catch{/* The broker may already have fenced this generation. */}
    onRecovery(pending);
    try{return await recoverSystemReset(pending,{native});}catch{throw error;}
  }
}
export async function restartAfterSystemReset(receipt,_native,{request=requestJson,navigate=()=>window.location.replace('/squad')}={}) {
  const context=await request('/api/ownership/context');
  if(!sameOwner(context,receipt.pending))throw Error('Select the account and Squad that started this reset.');
  if(context.pendingOperation?.id!==receipt.id)throw Error('This completion screen changed. Reopen Squad.');
  await request(`/api/ownership/operations/${encodeURIComponent(receipt.id)}/restart`,{method:'POST',headers:{'x-squad-context':context.generation,'content-type':'application/json'},body:JSON.stringify({revision:context.pendingOperation.revision})});
  navigate();
}
