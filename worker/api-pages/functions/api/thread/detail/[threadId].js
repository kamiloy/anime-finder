import { handleThreadDetail, handlePostCreate } from '../../../_shared.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'GET') return handleThreadDetail(request, env);
  if (request.method === 'POST') return handlePostCreate(request, env);
  if (request.method === 'OPTIONS') return handleThreadDetail(request, env);
  return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), { status: 405, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
}
