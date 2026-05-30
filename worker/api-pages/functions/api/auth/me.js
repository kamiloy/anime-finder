import { requireAuth, jsonRes, corsRes } from '../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return corsRes();

  const user = await requireAuth(request, env);
  if (!user) return jsonRes({ ok: false, error: '请先登录' }, 401);

  return jsonRes({ ok: true, user });
}
