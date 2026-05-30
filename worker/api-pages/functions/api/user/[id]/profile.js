import { handleUserProfile } from '../../../_shared.js';
export async function onRequest(context) { return handleUserProfile(context.request, context.env); }
