import { handleAnimeList } from '../_shared.js';
export async function onRequest(context) {
  return handleAnimeList(context.request, context.env);
}
