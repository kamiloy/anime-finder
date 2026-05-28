import { handleDiscover } from '../_shared.js';
export async function onRequest(context) {
  return handleDiscover(context.request, context.env);
}
