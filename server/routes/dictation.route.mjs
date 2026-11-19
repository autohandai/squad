// /api/dictation/* — on-device dictation (ADR-0260). Text-to-speech stays in voice.route.mjs (ADR-0101).
import { createVoiceService } from '../voice/dictation.mjs';

export const name = 'dictation';
let service = null;

export async function handle(req, res, url, ctx) {
  if (!url.pathname.startsWith('/api/dictation/')) return false;
  service ||= createVoiceService({ rootDir: ctx.rootDir || process.cwd() });
  const action = url.pathname.slice('/api/dictation/'.length);
  try {
    let data;
    if (action === 'status' && req.method === 'GET') data = await service.status();
    else if (action === 'prepare' && req.method === 'POST') data = await service.prepare();
    else if (action === 'start' && req.method === 'POST') data = await service.start();
    else if (action === 'stop' && req.method === 'POST') data = await service.stop();
    else if (action === 'cancel' && req.method === 'POST') data = await service.cancel();
    else return false;
    ctx.json(res, 200, { success: true, data });
  } catch (error) {
    ctx.json(res, error.status || 500, { success: false, error: error.message, code: error.code || 'voice_failed' });
  }
  return true;
}
