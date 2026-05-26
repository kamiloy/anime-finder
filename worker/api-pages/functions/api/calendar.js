import { handleCalendar } from '../_shared.js';
export async function onRequest(context) {
  return handleCalendar(context.request, context.env);
}
