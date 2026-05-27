import { handleImageProxy } from '../_shared.js';
export async function onRequest(context) {
  return handleImageProxy(context);
}
