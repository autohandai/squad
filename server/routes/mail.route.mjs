// /api/mail — members' email addresses (ADR-0262). Squad API decides who may
// hold one (autohand.ai accounts today); this route only relays and collects.
import { createAgentMail } from '../mail/service.mjs';
import { triggerEmailRoutine } from './routines.route.mjs';

export const name = 'mail';

let service = null;
// The Squad's current members, for automatic addresses.
async function squadMembers(ctx) {
  const state = await ctx.readChannelsState().catch(() => null);
  return Object.values(state?.agentChannelAccess || {}).filter(record => record?.agent && !record.removed && !record.agent.archived)
    .map(record => ({ id: record.agent.id, name: record.agent.name }));
}
const serviceFor = ctx => (service ||= ctx.agentMail || createAgentMail(ctx, { deliver: args => triggerEmailRoutine(ctx, args), members: () => squadMembers(ctx) }));

export async function init(ctx) {
  const mail = serviceFor(ctx);
  // Start collecting only for an account that holds an address; a later
  // registration starts it too. Never blocks boot.
  // Only an account allowed agent email (autohand.ai) starts the minute loop,
  // which also gives every member without an address one from its name.
  mail.status().then(current => { if (current.allowed) mail.schedule(); }).catch(() => {});
}

const MEMBER = /^\/api\/mail\/members\/([^/]+)$/;

export async function handle(req, res, url, ctx) {
  if (url.pathname !== '/api/mail' && !url.pathname.startsWith('/api/mail/')) return false;
  const mail = serviceFor(ctx);
  const send = (status, data) => { ctx.json(res, status, { success: true, data }); return true; };
  try {
    if (url.pathname === '/api/mail' && req.method === 'GET') return send(200, await mail.status());
    if (url.pathname === '/api/mail/assign' && req.method === 'POST') { const made = await mail.ensureAll(); mail.schedule(); return send(200, { made }); }
    if (url.pathname === '/api/mail/offer' && req.method === 'GET') {
      return send(200, { offer: await mail.offer(url.searchParams.get('memberId') || '', url.searchParams.get('name') || '') });
    }
    if (url.pathname === '/api/mail/poll' && req.method === 'POST') return send(200, { started: await mail.poll() });
    const match = url.pathname.match(MEMBER);
    if (match) {
      const memberId = decodeURIComponent(match[1]);
      if (req.method === 'GET') return send(200, await mail.forMember(memberId));
      if (req.method === 'POST') {
        const body = await ctx.readBody(req);
        return send(201, await mail.register({ memberId, memberName: String(body?.memberName || ''), localPart: String(body?.localPart || '') }));
      }
      if (req.method === 'PATCH') {
        const body = await ctx.readBody(req);
        return send(200, await mail.rename(memberId, String(body?.localPart || '')));
      }
      if (req.method === 'DELETE') return send(200, await mail.remove(memberId));
    }
    ctx.json(res, 405, { success: false, error: 'Unsupported mail request.' }); return true;
  } catch (error) {
    ctx.json(res, error.status || 502, { success: false, error: error.message, ...(error.code ? { code: error.code } : {}) }); return true;
  }
}
