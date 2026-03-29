import {
  allowSharedGitHubFallback,
  appendLogEvents,
  checkAuth,
  createLogEvent,
  emitRuntimeLog,
  errorResponse,
  githubCommitFiles,
  githubGet,
  githubPost,
  jsonResponse,
  requireBrowserSession
} from '../_shared.js';
import {
  createScopedGitHubTokenForRepo
} from '../_github_app.js';
import {
  getPreviewSession,
  loadSessionSnapshot,
  previewCookieHeader,
  updatePreviewSession
} from '../_preview.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  let session = null;
  let startedLog = null;

  if (!(await checkAuth(request, env))) {
    return errorResponse('Unauthorized', 401);
  }

  try {
    const body = await request.json();
    const { sessionId, repoId } = body;

    if (!sessionId || !repoId) {
      return errorResponse('sessionId and repoId are required', 400);
    }

    const browserSession = await requireBrowserSession(request, env);
    session = await getPreviewSession(env, request.url, sessionId);

    if (session.shipped?.branch) {
      return jsonResponse({
        shipped: session.shipped,
        branch: session.shipped.branch,
        mainBranch: session.shipped.mainBranch,
        owner: session.shipped.owner,
        repo: session.shipped.repo,
        message: 'This preview session has already been saved to GitHub.'
      }, 200, {
        'Set-Cookie': previewCookieHeader(request.url, session.sessionId, session.previewSecret)
      });
    }

    const snapshot = await loadSessionSnapshot(env, session);
    if (!snapshot.length) {
      return errorResponse('This preview has no generated files yet. Build at least one step before shipping to GitHub.', 400);
    }

    const gitHubContext = await resolveGitHubWriteContext(env, browserSession.id, repoId);
    const { repo, token, installationId, connectionId } = gitHubContext;
    const owner = repo.owner;
    const repoName = repo.repo;

    startedLog = appendLogEvents(session.log || {}, [
      createLogEvent('github.ship.started', `Saving preview to ${repo.fullName}.`, {
        data: {
          repoId: repo.id,
          repoFullName: repo.fullName,
          fileCount: snapshot.length
        }
      })
    ]);

    session = await updatePreviewSession(env, request.url, session.sessionId, {
      log: startedLog
    });

    const { mainBranch, mainSha } = await resolveDefaultBranchHead(owner, repoName, repo.defaultBranch, token);
    const branch = `sheeper/preview-${Date.now()}`;

    await githubPost(`/repos/${owner}/${repoName}/git/refs`, {
      ref: `refs/heads/${branch}`,
      sha: mainSha
    }, token);

    const commitFiles = snapshot.map((file) => ({
      path: file.path,
      content: file.content,
      encoding: file.binary ? 'base64' : 'utf-8'
    }));

    commitFiles.push(
      {
        path: '_sheeper/brief.json',
        content: JSON.stringify(session.brief, null, 2)
      },
      {
        path: '_sheeper/intake.json',
        content: JSON.stringify(session.intake, null, 2)
      },
      {
        path: '_sheeper/plan.json',
        content: JSON.stringify(session.plan, null, 2)
      },
      {
        path: '_sheeper/log.json',
        content: JSON.stringify(session.log, null, 2)
      }
    );

    await githubCommitFiles(owner, repoName, branch, commitFiles, 'sheeper: save preview session', token);

    const shipped = {
      connectionId,
      installationId: String(installationId),
      repoId: repo.id,
      repoFullName: repo.fullName,
      owner,
      repo: repoName,
      branch,
      mainBranch,
      shippedAt: new Date().toISOString()
    };

    const updatedLog = appendLogEvents(startedLog, [
      createLogEvent('github.ship.completed', `Preview saved to ${repo.fullName} on ${branch}.`, {
        data: {
          repoId: repo.id,
          repoFullName: repo.fullName,
          branch,
          mainBranch,
          fileCount: snapshot.length
        }
      })
    ]);

    const updatedSession = await updatePreviewSession(env, request.url, session.sessionId, {
      shipped,
      log: updatedLog
    });

    emitRuntimeLog('preview.ship.completed', {
      sessionId: updatedSession.sessionId,
      repoFullName: repo.fullName,
      branch,
      mainBranch,
      fileCount: snapshot.length
    });

    return jsonResponse({
      owner,
      repo: repoName,
      repoId: repo.id,
      repoFullName: repo.fullName,
      branch,
      mainBranch,
      shipped,
      log: updatedSession.log,
      message: `Saved preview to ${repo.fullName} on ${branch}. Review it, then approve or discard the branch.`
    }, 200, {
      'Set-Cookie': previewCookieHeader(request.url, updatedSession.sessionId, updatedSession.previewSecret)
    });
  } catch (err) {
    emitRuntimeLog('preview.ship.failed', {
      sessionId: session?.sessionId,
      error: err.message
    }, 'error');
    if (session?.sessionId) {
      try {
        const failedLog = appendLogEvents(startedLog || session.log || {}, [
          createLogEvent('github.ship.failed', 'Saving preview to GitHub failed.', {
            level: 'error',
            data: { error: err.message }
          })
        ]);
        await updatePreviewSession(env, request.url, session.sessionId, {
          log: failedLog
        });
      } catch (logErr) {
        console.warn('Ship failure logging failed:', logErr.message);
      }
    }
    console.error('Ship to GitHub error:', err);
    return errorResponse(err.message || 'Failed to save preview to GitHub', 500);
  }
}

async function resolveGitHubWriteContext(env, browserSessionId, repoId) {
  try {
    const scoped = await createScopedGitHubTokenForRepo(env, browserSessionId, repoId);
    return {
      connectionId: scoped.connection.id,
      installationId: scoped.installationId,
      token: scoped.token,
      repo: scoped.repo
    };
  } catch (error) {
    if (!allowSharedGitHubFallback(env) || !env.GITHUB_TOKEN) {
      throw error;
    }

    const repo = await githubGet(`/repositories/${repoId}`, env.GITHUB_TOKEN);
    return {
      connectionId: 'shared-github-token',
      installationId: 'shared-github-token',
      token: env.GITHUB_TOKEN,
      repo: {
        id: repo.id,
        fullName: repo.full_name,
        owner: repo.owner?.login,
        repo: repo.name,
        defaultBranch: repo.default_branch
      }
    };
  }
}

async function resolveDefaultBranchHead(owner, repo, defaultBranch, token) {
  if (!defaultBranch) {
    throw new Error(`GitHub did not return a default branch for ${owner}/${repo}.`);
  }

  const ref = await githubGet(`/repos/${owner}/${repo}/git/ref/heads/${defaultBranch}`, token);
  return {
    mainBranch: defaultBranch,
    mainSha: ref.object.sha
  };
}
