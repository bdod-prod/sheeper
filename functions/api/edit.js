// POST /api/edit
// Single-shot edit mode: make a change to an existing site
// Creates a staging branch, AI generates changes, commits them

import {
  checkAuth, jsonResponse, errorResponse, callAI, extractJson,
  githubGet, githubPost, githubGetFileSafe,
  githubGetTree, githubCommitFiles
} from './_shared.js';

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

    // Create staging branch
    const sourceRef = await githubGet(
      `/repos/${owner}/${repo}/git/ref/heads/${sourceBranch}`, token
    );

    const editBranch = `sheeper/edit-${Date.now()}`;
    await githubPost(`/repos/${owner}/${repo}/git/refs`, {
      ref: `refs/heads/${editBranch}`,
      sha: sourceRef.object.sha
    }, token);

    // Get file tree
    const fileTree = await githubGetTree(owner, repo, sourceBranch, token);
    const siteFiles = fileTree.filter(f => !f.startsWith('_sheeper/'));

    // Read context files
    const contextContents = {};
    for (const file of ['README.md', 'decisions.md']) {
      const content = await githubGetFileSafe(owner, repo, file, sourceBranch, token);
      if (content) contextContents[file] = content;
    }

    // AI Call 1: Determine which files to read
    const { text: planText } = await callAI(env, [{
      role: 'user',
      content: `You are an AI editor for the ${repo} website. Determine which files to read.

## Repository Files
${siteFiles.join('\n')}

## Context
${Object.entries(contextContents).map(([p, c]) => `--- ${p} ---\n${c}`).join('\n\n')}

## User Request
"${userRequest}"

Respond ONLY with JSON: { "files_to_read": ["path/file.html"], "reasoning": "why" }
Select MINIMUM files (1-5).`
    }], { maxTokens: 2000, task: 'edit_select' });

    let filesToRead = [];
    try { filesToRead = extractJson(planText).files_to_read || []; } catch {}

    // Read those files
    const existingContents = {};
    for (const fp of filesToRead.slice(0, 8)) {
      const c = await githubGetFileSafe(owner, repo, fp, sourceBranch, token);
      if (c) existingContents[fp] = c;
    }

    // Uploaded file descriptions
    const uploadedContent = (uploadedFiles || []).map(f => {
      if (f.type?.startsWith('image/')) return `[Uploaded image: ${f.name}]`;
      try { return `--- ${f.name} ---\n${atob(f.data)}`; }
      catch { return `[Binary: ${f.name}]`; }
    }).join('\n\n');

    // AI Call 2: Generate changes
    const { text: changeText, provider } = await callAI(env, [{
      role: 'user',
      content: `You are SHEEPER, an AI site editor. Make the requested changes precisely.

## Repository Files
${siteFiles.join('\n')}

## Existing Files
${Object.entries(existingContents).map(([p, c]) => `--- ${p} ---\n${c}`).join('\n\n')}

## User Request
"${userRequest}"

${uploadedContent ? `## Uploaded Content\n${uploadedContent}` : ''}

Rules: Return COMPLETE files (not diffs). Change ONLY what's requested. Maintain consistency.

Response (JSON only, no backticks):
{
  "summary": "What was changed",
  "files": [{ "path": "file.html", "action": "modified", "content": "full content" }]
}`
    }], { maxTokens: 16000, task: 'edit' });

    const changes = extractJson(changeText);
    if (!changes.files?.length) throw new Error('AI generated no changes. Be more specific.');

    // Commit
    const commitFiles = changes.files.map(f => ({ path: f.path, content: f.content }));

    if (uploadedFiles?.length) {
      for (const f of uploadedFiles) {
        if (f.type?.startsWith('image/')) {
          commitFiles.push({ path: `images/${f.name}`, content: f.data, encoding: 'base64' });
        }
      }
    }

    await githubCommitFiles(owner, repo, editBranch, commitFiles,
      `sheeper-edit: ${userRequest.substring(0, 72)}`, token);

    const cfBranch = editBranch.replace(/\//g, '-');

    return jsonResponse({
      summary: changes.summary || 'Changes applied.',
      branch: editBranch,
      sourceBranch,
      previewUrl: `https://${cfBranch}.${repo}.pages.dev`,
      files: changes.files.map(f => ({ path: f.path, action: f.action || 'modified' })),
      provider
    });

  } catch (err) {
    console.error('Edit error:', err);
    return errorResponse(err.message || 'Failed to apply edit', 500);
  }
}
