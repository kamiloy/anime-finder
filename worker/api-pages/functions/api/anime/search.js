import { handleAnimeSearch } from '../../_shared.js';
export async function onRequest(context) {
  return handleAnimeSearch(context.request, context.env);
}
