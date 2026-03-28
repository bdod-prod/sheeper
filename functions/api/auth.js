// POST /api/auth — Validates the shared access token

import { jsonResponse, errorResponse } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const { token } = await request.json();

    if (!token || token !== env.SHEEPER_TOKEN) {
      return errorResponse('Invalid token', 401);
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    return errorResponse('Bad request', 400);
  }
}
