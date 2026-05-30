import { handleReviewList, handleReviewCreate, handleReviewDelete } from '../../_shared.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'GET') return handleReviewList(request, env);
  if (request.method === 'POST') return handleReviewCreate(request, env);
  if (request.method === 'DELETE') return handleReviewDelete(request, env);
  if (request.method === 'OPTIONS') return handleReviewList(request, env);
  return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), { status: 405, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
}
