import { handleAnimeCharacters } from '../../../_shared.js';
export async function onRequest(context) {
  return handleAnimeCharacters(context.request, context.env);
}
