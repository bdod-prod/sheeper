import {
  appendLogEvents,
  authCookieHeader,
  createLogEvent,
  emitRuntimeLog,
  errorResponse,
  redirectResponse,
  requireBrowserSession
} from '../../_shared.js';
import { storeGitHubOAuthState } from '../../_appdb.js';
import { githubConnectUrl, isGitHubAppConfigured } from '../../_github_app.js';
import { getPreviewSession, updatePreviewSession } from '../../_preview.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    if (!isGitHubAppConfigured(env)) {
      return errorResponse('GitHub App is not configured for this deployment yet.', 503);
    }

    const browserSession = await requireBrowserSession(request, env);
    const url = new URL(request.url);
    const returnToSessionId = url.searchParams.get('sessionId') || null;
    const state = crypto.randomUUID();

    await storeGitHubOAuthState(env, {
      state,
      browserSessionId: browserSession.id,
      kind: 'connect',
      returnToSessionId
    });

    if (returnToSessionId) {
      await appendPreviewLog(env, request.url, returnToSessionId, [
        createLogEvent('github.connect.started', 'Connecting GitHub for this preview session.', {
          data: { returnToSessionId }
        })
      ]);
    }

    emitRuntimeLog('github.connect.started', {
      browserSessionId: browserSession.id,
      returnToSessionId
    });

    return redirectResponse(githubConnectUrl(env, state), [
      await authCookieHeader(request.url, browserSession.id, env)
    ]);
  } catch (error) {
    return errorResponse(error.message || 'Failed to start GitHub connect flow', 500);
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
