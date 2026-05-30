import { handleFollow } from '../../_shared.js';
export async function onRequest(context) { return handleFollow(context.request, context.env); }
