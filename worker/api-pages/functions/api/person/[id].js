import { handlePersonDetail } from '../../_shared.js';
export async function onRequest(context) {
  return handlePersonDetail(context.request, context.env);
}
