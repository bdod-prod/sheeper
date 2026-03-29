// POST /api/edit
// Repo-backed single-shot edit mode: create a staging branch, generate changes, and return a preview URL.

import {
  checkAuth,
  jsonResponse,
  errorResponse,
  githubGet,
  githubPost,
  githubGetFileSafe,
  githubGetTree,
  githubCommitFiles
} from './_shared.js';
import { runEditGeneration } from './_generation.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!checkAuth(request, env)) {
    return errorResponse('Unauthorized', 401);
  }

  try {
    const body = await request.json();
    const { owner, repo, branch, userRequest, files: uploadedFiles } = body;

    if (!owner || !repo || !userRequest?.trim()) {
      return errorResponse('owner, repo, and userRequest are required', 400);
    }

    const token = env.GITHUB_TOKEN;
    const sourceBranch = branch || 'main';
    const sourceRef = await githubGet(`/repos/${owner}/${repo}/git/ref/heads/${sourceBranch}`, token);

    const editBranch = `sheeper/edit-${Date.now()}`;
    await githubPost(`/repos/${owner}/${repo}/git/refs`, {
      ref: `refs/heads/${editBranch}`,
      sha: sourceRef.object.sha
    }, token);

    const fileTree = await githubGetTree(owner, repo, sourceBranch, token);
    const siteFiles = fileTree.filter((file) => !file.startsWith('_sheeper/'));

    const contextContents = {};
    for (const file of ['README.md', 'decisions.md']) {
      const content = await githubGetFileSafe(owner, repo, file, sourceBranch, token);
      if (content) contextContents[file] = content;
    }

    const existingContents = {};
    for (const filePath of siteFiles.filter((file) => /\.(html|css|js|md|txt)$/i.test(file)).slice(0, 20)) {
      const content = await githubGetFileSafe(owner, repo, filePath, sourceBranch, token);
      if (content) {
        existingContents[filePath] = content;
      }
    }

    const generation = await runEditGeneration(env, {
      siteLabel: repo,
      siteFiles,
      existingContents,
      contextContents,
      userRequest,
      uploadedFiles,
      sourceMaterial: null
    });

    const commitFiles = generation.files.map((file) => ({ path: file.path, content: file.content }));
    for (const asset of generation.uploadedAssets) {
      commitFiles.push({
        path: asset.path,
        content: asset.content,
        encoding: asset.encoding
      });
    }

    await githubCommitFiles(owner, repo, editBranch, commitFiles, `sheeper-edit: ${userRequest.substring(0, 72)}`, token);

    return jsonResponse({
      summary: generation.summary,
      branch: editBranch,
      sourceBranch,
      previewUrl: `https://${editBranch.replace(/\//g, '-')}.${repo}.pages.dev`,
      files: generation.files.map((file) => ({ path: file.path, action: file.action || 'modified' })),
      provider: generation.provider
    });
  } catch (err) {
    console.error('Edit error:', err);
    return errorResponse(err.message || 'Failed to apply edit', 500);
  }
}
