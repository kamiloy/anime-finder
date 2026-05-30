import { handleFeed } from '../../_shared.js';
export async function onRequest(context) { return handleFeed(context.request, context.env); }
