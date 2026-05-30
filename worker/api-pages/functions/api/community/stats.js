import { handleCommunityStats } from '../../_shared.js';
export async function onRequest(context) { return handleCommunityStats(context.request, context.env); }
