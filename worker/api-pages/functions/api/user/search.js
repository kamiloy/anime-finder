import { handleUserSearch } from '../../_shared.js';
export async function onRequest(context) { return handleUserSearch(context.request, context.env); }
