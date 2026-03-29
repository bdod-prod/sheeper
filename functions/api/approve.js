// POST /api/approve
// Merges a sheeper branch into the target branch (main/master)
// Then deletes the sheeper branch

import {
  allowSharedGitHubFallback,
  appendLogEvents,
  checkAuth, jsonResponse, errorResponse,
  createLogEvent, emitRuntimeLog,
  githubPost, githubDelete, githubGet,
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
    const { owner, repo, branch, targetBranch, sessionId } = await request.json();

    if (!owner || !repo || !branch) {
      return errorResponse('owner, repo, and branch are required', 400);
    }

    const token = await resolveGitHubTokenForApproval(env, request, {
      sessionId,
      owner,
      repo,
      branch
    });
    const target = targetBranch || 'main';

    // Merge the branch
    const merge = await githubPost(`/repos/${owner}/${repo}/merges`, {
      base: target,
      head: branch,
      commit_message: `sheeper: deploy ${branch}`
    }, token);

    // Delete the branch after merge
    try {
      await githubDelete(
        `/repos/${owner}/${repo}/git/refs/heads/${branch}`,
        token
      );
    } catch {
      // Branch deletion is best-effort
    }

    if (sessionId) {
      try {
        const currentSession = await getPreviewSession(env, request.url, sessionId);
        const updatedSession = await updatePreviewSession(env, request.url, sessionId, {
          deployed: true,
          shipped: {
            ...(currentSession.shipped || {}),
            owner,
            repo,
            branch,
            mainBranch: target,
            approvedAt: new Date().toISOString()
          },
          log: appendLogEvents(currentSession.log || {}, [
            createLogEvent('ship.approved', `Merged ${branch} into ${target}.`, {
              data: {
                owner,
                repo,
                branch,
                targetBranch: target,
                sha: merge.sha
              }
            })
          ])
        });
        emitRuntimeLog('preview.ship.approved', {
          sessionId,
          owner,
          repo,
          branch,
          targetBranch: target,
          sha: merge.sha
        });
        return jsonResponse({
          merged: true,
          sha: merge.sha,
          log: updatedSession.log,
          shipped: updatedSession.shipped,
          message: `Deployed to ${target}. Site will update in ~60 seconds.`
        });
      } catch (previewErr) {
        console.warn('Preview session approve sync failed:', previewErr.message);
      }
    }

    return jsonResponse({
      merged: true,
      sha: merge.sha,
      message: `Deployed to ${target}. Site will update in ~60 seconds.`
    });

  } catch (err) {
    emitRuntimeLog('preview.ship.approve_failed', { error: err.message }, 'error');
    console.error('Approve error:', err);

    // Handle merge conflicts
    if (err.message?.includes('409') || err.message?.includes('Merge conflict')) {
      return errorResponse('Merge conflict. The target branch has diverged. Try rebasing or creating a new build.', 409);
    }

    return errorResponse(err.message || 'Failed to approve', 500);
  }
}

async function resolveGitHubTokenForApproval(env, request, {
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
      throw new Error('Reconnect GitHub before approving this branch.');
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

  throw new Error('Approving a non-preview branch requires GitHub App support or the shared-token fallback.');
}
