import { handleAnimeRelated } from '../../../_shared.js';
export async function onRequest(context) {
  return handleAnimeRelated(context.request, context.env);
}
