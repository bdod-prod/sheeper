import {
  appendLogEvents,
  authCookieHeader,
  createLogEvent,
  emitRuntimeLog,
  redirectResponse
} from '../../_shared.js';
import { consumeGitHubOAuthState } from '../../_appdb.js';
import { getPreviewSession, updatePreviewSession } from '../../_preview.js';
import {
  exchangeGitHubUserCode,
  isGitHubAppConfigured,
  persistGitHubConnection
} from '../../_github_app.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!isGitHubAppConfigured(env)) {
    return redirectWithState(env, request.url, null, null, 'github_not_configured', 'GitHub App is not configured for this deployment.');
  }

  const oauthState = await consumeGitHubOAuthState(env, state, 'connect');
  if (!oauthState) {
    return redirectWithState(env, request.url, null, null, 'github_connect_failed', 'GitHub connection state expired. Try again.');
  }

  if (error) {
    await appendPreviewLog(env, request.url, oauthState.returnToSessionId, [
      createLogEvent('github.connect.failed', `GitHub connect failed: ${error}.`, {
        level: 'error',
        data: { error, errorDescription }
      })
    ]);
    emitRuntimeLog('github.connect.failed', {
      browserSessionId: oauthState.browserSessionId,
      error,
      errorDescription
    }, 'error');
    return redirectWithState(env, request.url, oauthState.browserSessionId, oauthState.returnToSessionId, 'github_connect_failed', errorDescription || error);
  }

  try {
    const exchange = await exchangeGitHubUserCode(env, code);
    const connection = await persistGitHubConnection(env, oauthState.browserSessionId, exchange);

    await appendPreviewLog(env, request.url, oauthState.returnToSessionId, [
      createLogEvent('github.connect.completed', `Connected GitHub as ${connection.githubLogin}.`, {
        data: { githubLogin: connection.githubLogin }
      })
    ]);

    emitRuntimeLog('github.connect.completed', {
      browserSessionId: oauthState.browserSessionId,
      githubLogin: connection.githubLogin,
      returnToSessionId: oauthState.returnToSessionId
    });

    return redirectWithState(
      env,
      request.url,
      oauthState.browserSessionId,
      oauthState.returnToSessionId,
      'github_connected',
      `Connected GitHub as ${connection.githubLogin}.`
    );
  } catch (connectError) {
    await appendPreviewLog(env, request.url, oauthState.returnToSessionId, [
      createLogEvent('github.connect.failed', 'GitHub callback failed.', {
        level: 'error',
        data: { error: connectError.message }
      })
    ]);
    emitRuntimeLog('github.connect.callback_failed', {
      browserSessionId: oauthState.browserSessionId,
      error: connectError.message
    }, 'error');
    return redirectWithState(env, request.url, oauthState.browserSessionId, oauthState.returnToSessionId, 'github_connect_failed', connectError.message);
  }
}

async function appendPreviewLog(env, requestUrl, sessionId, events) {
  if (!sessionId) return;
  try {
    const session = await getPreviewSession(env, requestUrl, sessionId);
    await updatePreviewSession(env, requestUrl, sessionId, {
      log: appendLogEvents(session.log || {}, events)
    });
  } catch {}
}

async function redirectWithState(env, requestUrl, browserSessionId, sessionId, state, message) {
  const appBase = String(env.APP_BASE_URL || new URL(requestUrl).origin).replace(/\/+$/, '');
  const target = new URL(`${appBase}/`);
  if (sessionId) target.searchParams.set('resumeSession', sessionId);
  if (state) target.searchParams.set('github', state);
  if (message) target.searchParams.set('message', message);

  const cookies = [];
  if (browserSessionId) {
    cookies.push(await authCookieHeader(requestUrl, browserSessionId, env));
  }

  return redirectResponse(target.toString(), cookies);
}
