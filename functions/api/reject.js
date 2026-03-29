// POST /api/reject
// Deletes a sheeper branch, discarding all changes

import {
  checkAuth, jsonResponse, errorResponse, githubDelete
} from './_shared.js';
import {
  updatePreviewSession
} from './_preview.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!checkAuth(request, env)) {
    return errorResponse('Unauthorized', 401);
  }

  try {
    const { owner, repo, branch, sessionId } = await request.json();

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
        await updatePreviewSession(env, request.url, sessionId, {
          shipped: null,
          deployed: false
        });
      } catch (previewErr) {
        console.warn('Preview session reject sync failed:', previewErr.message);
      }
    }

    return jsonResponse({
      deleted: true,
      branch,
      message: 'Branch deleted. Changes discarded.'
    });

  } catch (err) {
    console.error('Reject error:', err);
    return errorResponse(err.message || 'Failed to reject', 500);
  }
}
