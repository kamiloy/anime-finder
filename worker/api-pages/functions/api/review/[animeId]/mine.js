import { handleReviewMine } from '../../../_shared.js';
export async function onRequest(context) { return handleReviewMine(context.request, context.env); }
