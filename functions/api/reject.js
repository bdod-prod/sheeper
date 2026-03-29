// POST /api/reject
// Deletes a sheeper branch, discarding all changes

import {
  appendLogEvents,
  checkAuth, jsonResponse, errorResponse, githubDelete,
  createLogEvent, emitRuntimeLog
} from './_shared.js';
import {
  getPreviewSession,
  updatePreviewSession
} from './_preview.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!checkAuth(request, env)) {
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

    const token = env.GITHUB_TOKEN;

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
