import { handleAnimeDetail } from '../../_shared.js';
export async function onRequest(context) {
  return handleAnimeDetail(context.request, context.env);
}
