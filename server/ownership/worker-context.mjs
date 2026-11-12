import { z } from 'zod';
import { isAbsolute, join, resolve } from 'node:path';
import { ownerSchema } from '@autohand/squad-portable';
import { ownerKey } from './identity.mjs';
import { datasetPaths } from './datasets.mjs';
import { createConnection } from 'node:net';

const contextSchema = z.object({
  version: z.literal(1), generation: z.string().uuid(), datasetId: z.uuid(),
  actor: z.object({ issuer: z.url(), id: z.string().min(1).max(256), email: z.email(), name: z.string() }).strict().nullable(),
  owner: ownerSchema.nullable(), label: z.string(), role: z.enum(['', 'owner', 'admin', 'editor']), canWrite: z.boolean(),
  credentialFingerprint: z.string().regex(/^(?:[a-f0-9]{64})?$/),
  serviceRoot: z.string(), dataRoot: z.string(), appRoot: z.string(), workspaceRoot: z.string(), publicUrl: z.url(),
}).strict();

export async function awaitWorkerStart(context) {
  const pipe = process.env.AUTOHAND_SQUAD_WIN_JOB_PIPE;
  delete process.env.AUTOHAND_SQUAD_WIN_JOB_PIPE;
  const binding = pipe ? new Promise((ready,reject) => {
    if (process.platform !== 'win32' || !/^\\\\\.\\pipe\\AutohandSquad-[a-f0-9]{64}$/.test(pipe)) {reject(Error('Invalid Windows work supervisor.'));return;}
    const socket=createConnection(pipe);let bytes=Buffer.alloc(0),proved=false;
    const timer=setTimeout(()=>socket.destroy(Error('Windows work binding timed out.')),30_000);
    socket.on('error',error=>{if(!proved)reject(error);});
    socket.on('data',chunk=>{bytes=Buffer.concat([bytes,chunk]);if(bytes.length>16){socket.destroy(Error('Invalid Windows work challenge.'));return;}if(bytes.length===16){proved=true;socket.write(bytes);}});
    socket.on('close',()=>{clearTimeout(timer);if(proved)ready();else reject(Error('Windows work binding closed.'));});
  }) : Promise.resolve();
  const started = new Promise((ready, reject) => {
    const disconnected = () => { reject(new Error('The ownership broker disconnected before startup.')); };
    const start = message => {
      if (message?.type !== 'ownership-start' || message.generation !== context.generation) return;
      process.removeListener('disconnect', disconnected); process.removeListener('message', start); ready();
    };
    process.once('disconnect', disconnected); process.on('message', start);
    process.send?.({ type: 'ownership-awaiting-start', generation: context.generation });
    if (!process.connected) disconnected();
  });
  await Promise.all([started,binding]);
}

// Consume before any engine can inherit the environment. Neither the parent
// capability nor its private port is an agent, browser or MCP credential.
export function consumeWorkerContext(env = process.env) {
  const raw = env.AUTOHAND_SQUAD_WORKER_CONTEXT, token = env.AUTOHAND_SQUAD_WORKER_TOKEN;
  delete env.AUTOHAND_SQUAD_WORKER_CONTEXT; delete env.AUTOHAND_SQUAD_WORKER_TOKEN;
  if (raw === undefined && token === undefined) return null;
  if (!raw || !/^[a-f0-9]{64}$/.test(token || '')) throw new Error('A private worker requires its broker capability.');
  const context = contextSchema.parse(JSON.parse(raw));
  if (!isAbsolute(context.serviceRoot)) throw new Error('The worker service root must be absolute.');
  const key = context.owner ? ownerKey(context.owner) : `locked-${context.generation}`;
  const base = datasetPaths(context.serviceRoot, key, context.datasetId).root;
  for (const [field, suffix] of [['dataRoot', 'state'], ['appRoot', 'app'], ['workspaceRoot', 'member-homes']]) {
    if (context[field] !== join(base, suffix)) throw new Error('A private worker cannot leave its owner namespace.');
  }
  if (Boolean(context.owner) !== Boolean(context.actor) || (!context.owner && context.canWrite)) throw new Error('A locked worker cannot access a signed-in owner.');
  if (context.actor && !context.credentialFingerprint) throw new Error('A signed-in worker must bind its identity credential.');
  if (context.owner && context.owner.issuer !== context.actor.issuer) throw new Error('The worker owner belongs to a different issuer.');
  if (context.owner?.kind === 'user' && context.owner.id !== context.actor.id) throw new Error('A personal worker belongs to its signed-in subject.');
  const url = new URL(context.publicUrl);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('A worker must use its local broker origin.');
  return { context: Object.freeze(context), token };
}
