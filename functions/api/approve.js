// POST /api/approve
// Merges a sheeper branch into the target branch (main/master)
// Then deletes the sheeper branch

import {
  checkAuth, jsonResponse, errorResponse,
  githubPost, githubDelete, githubGet
} from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!checkAuth(request, env)) {
    return errorResponse('Unauthorized', 401);
  }

  try {
    const { owner, repo, branch, targetBranch } = await request.json();

    if (!owner || !repo || !branch) {
      return errorResponse('owner, repo, and branch are required', 400);
    }

    const token = env.GITHUB_TOKEN;
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

    return jsonResponse({
      merged: true,
      sha: merge.sha,
      message: `Deployed to ${target}. Site will update in ~60 seconds.`
    });

  } catch (err) {
    console.error('Approve error:', err);

    // Handle merge conflicts
    if (err.message?.includes('409') || err.message?.includes('Merge conflict')) {
      return errorResponse('Merge conflict. The target branch has diverged. Try rebasing or creating a new build.', 409);
    }

    return errorResponse(err.message || 'Failed to approve', 500);
  }
}
