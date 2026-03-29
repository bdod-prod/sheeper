import {
  authCookieHeader,
  createLogEvent,
  emitRuntimeLog,
  errorResponse,
  installStateCookieHeader,
  redirectResponse,
  requireBrowserSession
} from '../../_shared.js';
import { storeGitHubOAuthState } from '../../_appdb.js';
import { githubInstallUrl, isGitHubAppConfigured } from '../../_github_app.js';

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
      kind: 'install',
      returnToSessionId
    });

    emitRuntimeLog('github.install.started', {
      browserSessionId: browserSession.id,
      returnToSessionId
    });

    return redirectResponse(githubInstallUrl(env), [
      await authCookieHeader(request.url, browserSession.id, env),
      await installStateCookieHeader(request.url, state, env)
    ]);
  } catch (error) {
    return errorResponse(error.message || 'Failed to start GitHub installation flow', 500);
  }
}
