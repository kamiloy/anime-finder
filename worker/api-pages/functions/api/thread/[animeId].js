import { handleThreadList, handleThreadCreate } from '../../_shared.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'GET') return handleThreadList(request, env);
  if (request.method === 'POST') return handleThreadCreate(request, env);
  if (request.method === 'OPTIONS') return handleThreadList(request, env);
  return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), { status: 405, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
}
