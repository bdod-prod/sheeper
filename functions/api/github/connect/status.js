import {
  authCookieHeader,
  checkAuth,
  errorResponse,
  jsonResponse,
  requireBrowserSession
} from '../../_shared.js';
import { buildGitHubStatus } from '../../_github_app.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    if (!(await checkAuth(request, env))) {
      return errorResponse('Unauthorized', 401);
    }
    if (!env.APP_DB || !env.APP_SESSION_SECRET) {
      return jsonResponse({
        configured: false,
        connected: false,
        needsInstallation: false,
        personalInstallationId: null,
        login: null,
        avatarUrl: null
      });
    }

    const browserSession = await requireBrowserSession(request, env);
    const status = await buildGitHubStatus(env, browserSession.id);
    return jsonResponse(status, 200, {
      'Set-Cookie': await authCookieHeader(request.url, browserSession.id, env)
    });
  } catch (error) {
    if (/Unauthorized/i.test(error.message)) {
      return errorResponse('Unauthorized', 401);
    }
    return errorResponse(error.message || 'Failed to load GitHub connection status', 500);
  }
}
