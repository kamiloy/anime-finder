import { handleFollowing } from '../../../_shared.js';
export async function onRequest(context) { return handleFollowing(context.request, context.env); }
