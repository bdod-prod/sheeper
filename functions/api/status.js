import {
  checkAuth,
  jsonResponse,
  errorResponse,
  githubGetFileSafe,
  githubGetTree
} from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!checkAuth(request, env)) {
    return errorResponse('Unauthorized', 401);
  }

  try {
    const { owner, repo, branch } = await request.json();

    if (!owner || !repo || !branch) {
      return errorResponse('owner, repo, and branch are required', 400);
    }

    const token = env.GITHUB_TOKEN;
    const [briefRaw, planRaw, logRaw, intakeRaw] = await Promise.all([
      githubGetFileSafe(owner, repo, '_sheeper/brief.json', branch, token),
      githubGetFileSafe(owner, repo, '_sheeper/plan.json', branch, token),
      githubGetFileSafe(owner, repo, '_sheeper/log.json', branch, token),
      githubGetFileSafe(owner, repo, '_sheeper/intake.json', branch, token)
    ]);

    if (!briefRaw) {
      return errorResponse('No SHEEPER project found on this branch', 404);
    }

    const brief = JSON.parse(briefRaw);
    const plan = planRaw ? JSON.parse(planRaw) : null;
    const log = logRaw
      ? JSON.parse(logRaw)
      : { currentStep: 0, completedSteps: [], totalFiles: [] };
    const intake = intakeRaw ? JSON.parse(intakeRaw) : null;

    let fileTree = [];
    try {
      fileTree = await githubGetTree(owner, repo, branch, token);
    } catch {
      fileTree = [];
    }

    const siteFiles = fileTree.filter((file) => !file.startsWith('_sheeper/'));

    return jsonResponse({
      brief,
      intake,
      plan,
      log,
      siteFiles,
      branch
    });

  } catch (err) {
    console.error('Status error:', err);
    return errorResponse(err.message || 'Failed to read project status', 500);
  }
}
