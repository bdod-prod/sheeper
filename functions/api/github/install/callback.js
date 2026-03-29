import {
  appendLogEvents,
  authCookieHeader,
  clearInstallStateCookieHeader,
  createLogEvent,
  emitRuntimeLog,
  readInstallStateCookie,
  redirectResponse
} from '../../_shared.js';
import { consumeGitHubOAuthState } from '../../_appdb.js';
import { buildGitHubStatus, ensureFreshGitHubConnection, isGitHubAppConfigured } from '../../_github_app.js';
import { getPreviewSession, updatePreviewSession } from '../../_preview.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!isGitHubAppConfigured(env)) {
    return redirectWithState(env, request.url, null, null, 'github_not_configured', 'GitHub App is not configured for this deployment.', true);
  }

  const installState = await readInstallStateCookie(request, env);
  const oauthState = await consumeGitHubOAuthState(env, installState, 'install');
  if (!oauthState) {
    return redirectWithState(env, request.url, null, null, 'github_install_failed', 'GitHub install state expired. Start install again.', true);
  }

  try {
    const connection = await ensureFreshGitHubConnection(env, oauthState.browserSessionId);
    const status = await buildGitHubStatus(env, oauthState.browserSessionId);
    if (!connection || !status.personalInstallationId) {
      await appendPreviewLog(env, request.url, oauthState.returnToSessionId, [
        createLogEvent('github.install.required', 'GitHub install did not yet grant personal-account access.', {
          level: 'warn'
        })
      ]);
      return redirectWithState(env, request.url, oauthState.browserSessionId, oauthState.returnToSessionId, 'github_install_failed', 'GitHub was connected, but SHEEPER is not installed on your personal account yet.', true);
    }

    await appendPreviewLog(env, request.url, oauthState.returnToSessionId, [
      createLogEvent('github.install.completed', 'GitHub personal-account installation is ready.', {
        data: { installationId: status.personalInstallationId }
      })
    ]);

    emitRuntimeLog('github.install.completed', {
      browserSessionId: oauthState.browserSessionId,
      installationId: status.personalInstallationId,
      returnToSessionId: oauthState.returnToSessionId
    });

    return redirectWithState(env, request.url, oauthState.browserSessionId, oauthState.returnToSessionId, 'github_installed', 'GitHub personal-account installation is ready.', true);
  } catch (error) {
    emitRuntimeLog('github.install.callback_failed', {
      browserSessionId: oauthState.browserSessionId,
      error: error.message
    }, 'error');
    await appendPreviewLog(env, request.url, oauthState.returnToSessionId, [
      createLogEvent('github.install.failed', 'GitHub installation callback failed.', {
        level: 'error',
        data: { error: error.message }
      })
    ]);
    return redirectWithState(env, request.url, oauthState.browserSessionId, oauthState.returnToSessionId, 'github_install_failed', error.message, true);
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

async function redirectWithState(env, requestUrl, browserSessionId, sessionId, state, message, clearInstallCookie) {
  const appBase = String(env.APP_BASE_URL || new URL(requestUrl).origin).replace(/\/+$/, '');
  const target = new URL(`${appBase}/`);
  if (sessionId) target.searchParams.set('resumeSession', sessionId);
  if (state) target.searchParams.set('github', state);
  if (message) target.searchParams.set('message', message);

  const cookies = [];
  if (browserSessionId) {
    cookies.push(await authCookieHeader(requestUrl, browserSessionId, env));
  }
  if (clearInstallCookie) {
    cookies.push(clearInstallStateCookieHeader(requestUrl));
  }

  return redirectResponse(target.toString(), cookies);
}
