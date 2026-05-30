import { handleFollowers } from '../../../_shared.js';
export async function onRequest(context) { return handleFollowers(context.request, context.env); }
