import {
  authCookieHeader,
  checkAuth,
  errorResponse,
  jsonResponse
} from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const { token } = await request.json();

    if (!token || token !== env.SHEEPER_TOKEN) {
      return errorResponse('Invalid token', 401);
    }

    return jsonResponse({ ok: true }, 200, {
      'Set-Cookie': authCookieHeader(request.url, token)
    });
  } catch {
    return errorResponse('Bad request', 400);
  }
}

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!checkAuth(request, env)) {
    return errorResponse('Unauthorized', 401);
  }

  return jsonResponse({ ok: true });
}
