import { handleUserReviews } from '../../../_shared.js';
export async function onRequest(context) { return handleUserReviews(context.request, context.env); }
