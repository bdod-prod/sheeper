import {
  checkAuth,
  jsonResponse,
  errorResponse
} from '../_shared.js';
import {
  getPreviewSession,
  previewCookieHeader
} from '../_preview.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!(await checkAuth(request, env))) {
    return errorResponse('Unauthorized', 401);
  }

  try {
    const { sessionId } = await request.json();
    if (!sessionId) {
      return errorResponse('sessionId is required', 400);
    }

    const session = await getPreviewSession(env, request.url, sessionId);

    return jsonResponse({
      sessionId: session.sessionId,
      previewUrl: session.previewUrl,
      expiresAt: session.expiresAt,
      brief: session.brief,
      intake: session.intake,
      plan: session.plan,
      log: session.log,
      siteFiles: session.files || [],
      shipped: session.shipped || null,
      deployed: Boolean(session.deployed)
    }, 200, {
      'Set-Cookie': previewCookieHeader(request.url, session.sessionId, session.previewSecret)
    });
  } catch (err) {
    const message = err.message || 'Failed to load preview session';
    console.error('Preview status error:', err);
    if (/not found|expired/i.test(message)) {
      return errorResponse(message, 410);
    }
    return errorResponse(message, 500);
  }
}
