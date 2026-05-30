import { handleProfileUpdate } from '../../../_shared.js';
export async function onRequest(context) { return handleProfileUpdate(context.request, context.env); }
