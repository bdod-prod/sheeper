import {
  authCookieHeader,
  errorResponse,
  jsonResponse,
  requireBrowserSession
} from '../_shared.js';
import { listAccessibleRepos } from '../_github_app.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    const browserSession = await requireBrowserSession(request, env);
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') || '1');
    const result = await listAccessibleRepos(env, browserSession.id, page, 50);
    return jsonResponse({
      page: result.page,
      repos: result.repos,
      hasMore: result.hasMore
    }, 200, {
      'Set-Cookie': await authCookieHeader(request.url, browserSession.id, env)
    });
  } catch (error) {
    if (/Unauthorized/i.test(error.message)) {
      return errorResponse('Unauthorized', 401);
    }
    return errorResponse(error.message || 'Failed to list GitHub repositories', 500);
  }
}
