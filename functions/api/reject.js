// POST /api/reject
// Deletes a sheeper branch, discarding all changes

import {
  allowSharedGitHubFallback,
  appendLogEvents,
  checkAuth, jsonResponse, errorResponse, githubDelete,
  createLogEvent, emitRuntimeLog,
  requireBrowserSession
} from './_shared.js';
import {
  getPreviewSession,
  updatePreviewSession
} from './_preview.js';
import {
  createInstallationAccessToken,
  ensureFreshGitHubConnection
} from './_github_app.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!(await checkAuth(request, env))) {
    return errorResponse('Unauthorized', 401);
  }

  try {
    const { owner, repo, branch, sessionId } = await request.json();
    let updatedSession = null;

    if (!owner || !repo || !branch) {
      return errorResponse('owner, repo, and branch are required', 400);
    }

    // Safety: only delete sheeper/ branches
    if (!branch.startsWith('sheeper/')) {
      return errorResponse('Can only delete sheeper/* branches', 400);
    }

    const token = await resolveGitHubTokenForReject(env, request, {
      sessionId,
      owner,
      repo,
      branch
    });

    await githubDelete(
      `/repos/${owner}/${repo}/git/refs/heads/${branch}`,
      token
    );

    if (sessionId) {
      try {
        const currentSession = await getPreviewSession(env, request.url, sessionId);
        updatedSession = await updatePreviewSession(env, request.url, sessionId, {
          shipped: null,
          deployed: false,
          log: appendLogEvents(currentSession.log || {}, [
            createLogEvent('ship.discarded', `Discarded staging branch ${branch}.`, {
              data: {
                owner,
                repo,
                branch
              }
            })
          ])
        });
        emitRuntimeLog('preview.ship.discarded', {
          sessionId,
          owner,
          repo,
          branch
        });
      } catch (previewErr) {
        console.warn('Preview session reject sync failed:', previewErr.message);
      }
    }

    return jsonResponse({
      deleted: true,
      branch,
      log: updatedSession?.log || null,
      message: 'Branch deleted. Changes discarded.'
    });

  } catch (err) {
    emitRuntimeLog('preview.ship.reject_failed', { error: err.message }, 'error');
    console.error('Reject error:', err);
    return errorResponse(err.message || 'Failed to reject', 500);
  }
}

async function resolveGitHubTokenForReject(env, request, {
  sessionId,
  owner,
  repo,
  branch
}) {
  if (sessionId) {
    const browserSession = await requireBrowserSession(request, env);
    const session = await getPreviewSession(env, request.url, sessionId);
    const shipped = session.shipped || null;
    if (!shipped?.installationId || !shipped?.connectionId) {
      throw new Error('This preview does not have GitHub shipping metadata yet.');
    }

    const connection = await ensureFreshGitHubConnection(env, browserSession.id);
    if (!connection) {
      throw new Error('Reconnect GitHub before discarding this branch.');
    }
    if (connection.id !== shipped.connectionId) {
      throw new Error('This preview was saved with a different GitHub connection. Reconnect the original account or ship again.');
    }
    if (shipped.repoFullName && `${owner}/${repo}` !== shipped.repoFullName) {
      throw new Error('The requested repository does not match the shipped preview metadata.');
    }
    if (shipped.branch && branch !== shipped.branch) {
      throw new Error('The requested branch does not match the shipped preview metadata.');
    }

    return createInstallationAccessToken(env, shipped.installationId);
  }

  if (allowSharedGitHubFallback(env) && env.GITHUB_TOKEN) {
    return env.GITHUB_TOKEN;
  }

  throw new Error('Rejecting a non-preview branch requires GitHub App support or the shared-token fallback.');
}
