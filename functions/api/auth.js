import {
  authCookieHeader,
  checkAuth,
  clearAuthCookieHeader,
  errorResponse,
  jsonResponse,
  legacyAuthCookieHeader,
  requireBrowserSession
} from './_shared.js';
import {
  createBrowserSession,
  deleteBrowserSession
} from './_appdb.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const { token } = await request.json();

    if (!token || token !== env.SHEEPER_TOKEN) {
      return errorResponse('Invalid token', 401);
    }

    if (env.APP_DB && env.APP_SESSION_SECRET) {
      const session = await createBrowserSession(env);
      return jsonResponse({ ok: true }, 200, {
        'Set-Cookie': await authCookieHeader(request.url, session.id, env)
      });
    }

    return jsonResponse({ ok: true, fallback: true }, 200, {
      'Set-Cookie': legacyAuthCookieHeader(request.url, token)
    });
  } catch {
    return errorResponse('Bad request', 400);
  }
}

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!(await checkAuth(request, env))) {
    return errorResponse('Unauthorized', 401);
  }

  if (!env.APP_DB || !env.APP_SESSION_SECRET) {
    return jsonResponse({ ok: true, fallback: true });
  }

  const session = await requireBrowserSession(request, env);
  return jsonResponse({
    ok: true,
    session: {
      id: session.id,
      expiresAt: session.expiresAt
    }
  }, 200, {
    'Set-Cookie': await authCookieHeader(request.url, session.id, env)
  });
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  if (env.APP_DB && env.APP_SESSION_SECRET) {
    try {
      const session = await requireBrowserSession(request, env);
      await deleteBrowserSession(env, session.id);
    } catch {}
  }
  return jsonResponse({ ok: true }, 200, {
    'Set-Cookie': clearAuthCookieHeader(request.url)
  });
}
