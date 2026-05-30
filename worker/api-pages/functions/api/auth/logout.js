import { extractToken, destroySession, jsonRes, corsRes } from '../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return corsRes();
  if (request.method !== 'POST') return jsonRes({ ok: false, error: 'POST only' }, 405);

  const token = extractToken(request);
  if (token) await destroySession(env, token);

  return jsonRes({ ok: true });
}
