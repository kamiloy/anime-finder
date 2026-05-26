import { handleTags } from '../_shared.js';
export async function onRequest(context) {
  return handleTags(context.request, context.env);
}
