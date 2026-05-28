import { handleShionChat } from '../../_shared.js';
export async function onRequest(context) {
  return handleShionChat(context.request, context.env);
}
