import {
  createLogEvent,
  emitRuntimeLog,
  errorResponse,
  jsonResponse,
  requireBrowserSession
} from '../../_shared.js';
import { clearGitHubConnectionForBrowserSession } from '../../_github_app.js';
import { appendLogEvents } from '../../_shared.js';
import { getPreviewSession, updatePreviewSession } from '../../_preview.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const browserSession = await requireBrowserSession(request, env);
    const body = await request.json().catch(() => ({}));
    const sessionId = body.sessionId || null;

    await clearGitHubConnectionForBrowserSession(env, browserSession.id);
    if (sessionId) {
      await appendPreviewLog(env, request.url, sessionId, [
        createLogEvent('github.connect.disconnected', 'Disconnected GitHub for this browser session.')
      ]);
    }

    emitRuntimeLog('github.connect.disconnected', {
      browserSessionId: browserSession.id,
      sessionId
    });

    return jsonResponse({ ok: true, connected: false });
  } catch (error) {
    if (/Unauthorized/i.test(error.message)) {
      return errorResponse('Unauthorized', 401);
    }
    return errorResponse(error.message || 'Failed to disconnect GitHub', 500);
  }
}

async function appendPreviewLog(env, requestUrl, sessionId, events) {
  try {
    const session = await getPreviewSession(env, requestUrl, sessionId);
    await updatePreviewSession(env, requestUrl, sessionId, {
      log: appendLogEvents(session.log || {}, events)
    });
  } catch {}
}
