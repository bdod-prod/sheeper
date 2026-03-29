import {
  appendLogEvents,
  authCookieHeader,
  createLogEvent,
  emitRuntimeLog,
  errorResponse,
  jsonResponse,
  requireBrowserSession
} from '../../_shared.js';
import { createRepoForAuthenticatedUser } from '../../_github_app.js';
import { getPreviewSession, updatePreviewSession } from '../../_preview.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const browserSession = await requireBrowserSession(request, env);
    const body = await request.json();
    const name = String(body.name || '').trim();
    const isPrivate = body.private !== false;
    const sessionId = body.sessionId || null;

    if (!name) {
      return errorResponse('Repository name is required', 400);
    }

    await appendPreviewLog(env, request.url, sessionId, [
      createLogEvent('github.repo.create.started', `Creating GitHub repo ${name}.`, {
        data: { name, private: isPrivate }
      })
    ]);

    const repo = await createRepoForAuthenticatedUser(env, browserSession.id, {
      name,
      private: isPrivate
    });

    await appendPreviewLog(env, request.url, sessionId, [
      createLogEvent('github.repo.create.completed', `Created GitHub repo ${repo.fullName}.`, {
        data: {
          repoId: repo.id,
          fullName: repo.fullName,
          private: repo.private
        }
      })
    ]);

    emitRuntimeLog('github.repo.create.completed', {
      browserSessionId: browserSession.id,
      repoId: repo.id,
      fullName: repo.fullName
    });

    return jsonResponse(repo, 200, {
      'Set-Cookie': await authCookieHeader(request.url, browserSession.id, env)
    });
  } catch (error) {
    emitRuntimeLog('github.repo.create.failed', { error: error.message }, 'error');
    return errorResponse(error.message || 'Failed to create GitHub repository', 500);
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
