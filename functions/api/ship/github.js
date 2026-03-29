import {
  checkAuth,
  jsonResponse,
  errorResponse,
  githubCommitFiles,
  githubGet,
  githubPost
} from '../_shared.js';
import {
  getPreviewSession,
  loadSessionSnapshot,
  previewCookieHeader,
  updatePreviewSession
} from '../_preview.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!checkAuth(request, env)) {
    return errorResponse('Unauthorized', 401);
  }

  try {
    const body = await request.json();
    const { sessionId, owner, repo } = body;

    if (!sessionId || !owner || !repo) {
      return errorResponse('sessionId, owner, and repo are required', 400);
    }

    const session = await getPreviewSession(env, request.url, sessionId);
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

    const token = env.GITHUB_TOKEN;
    const { mainBranch, mainSha } = await resolveMainBranch(owner, repo, token);
    const branch = `sheeper/preview-${Date.now()}`;

    await githubPost(`/repos/${owner}/${repo}/git/refs`, {
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

    await githubCommitFiles(owner, repo, branch, commitFiles, 'sheeper: save preview session', token);

    const shipped = {
      owner,
      repo,
      branch,
      mainBranch,
      shippedAt: new Date().toISOString()
    };

    const updatedSession = await updatePreviewSession(env, request.url, session.sessionId, {
      shipped
    });

    return jsonResponse({
      owner,
      repo,
      branch,
      mainBranch,
      shipped,
      message: `Saved preview to ${owner}/${repo} on ${branch}. Review it, then approve or discard the branch.`
    }, 200, {
      'Set-Cookie': previewCookieHeader(request.url, updatedSession.sessionId, updatedSession.previewSecret)
    });
  } catch (err) {
    console.error('Ship to GitHub error:', err);
    return errorResponse(err.message || 'Failed to save preview to GitHub', 500);
  }
}

async function resolveMainBranch(owner, repo, token) {
  try {
    const mainRef = await githubGet(`/repos/${owner}/${repo}/git/ref/heads/main`, token);
    return { mainBranch: 'main', mainSha: mainRef.object.sha };
  } catch {
    try {
      const masterRef = await githubGet(`/repos/${owner}/${repo}/git/ref/heads/master`, token);
      return { mainBranch: 'master', mainSha: masterRef.object.sha };
    } catch {
      throw new Error(`Could not find main or master branch on ${owner}/${repo}`);
    }
  }
}
