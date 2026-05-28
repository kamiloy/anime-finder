import { handleAnimeEpisodes } from '../../../_shared.js';
export async function onRequest(context) {
  return handleAnimeEpisodes(context.request, context.env);
}
