import {
  checkAuth,
  jsonResponse,
  errorResponse,
  githubCommitFiles,
  githubGet,
  githubPost
} from './_shared.js';
import {
  buildIntakeRecord,
  normalizeBrief
} from './_brief.js';
import {
  generatePlan,
  loadTemplateContext
} from './_plan.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!(await checkAuth(request, env))) {
    return errorResponse('Unauthorized', 401);
  }

  try {
    const body = await request.json();
    const { owner, repo } = body;

    if (!owner || !repo) {
      return errorResponse('owner and repo are required', 400);
    }

    const brief = normalizeBrief(body?.brief || {}, {
      advanced: body?.intake?.advanced || body?.brief,
      sourceMaterial: body?.intake?.sourceMaterial,
      summary: body?.intake?.summary || body?.brief?.summary || body?.brief?.purpose,
      assumptions: body?.intake?.assumptions || body?.brief?.assumptions,
      inputMode: body?.brief?.inputMode || body?.intake?.inputMode,
      fallbackName: repo
    });

    if (!brief.name) {
      return errorResponse('brief.name is required', 400);
    }

    const intakeRecord = buildIntakeRecord(body?.intake || {}, brief);
    const token = env.GITHUB_TOKEN;
    const branchName = `sheeper/build-${Date.now()}`;

    let mainSha;
    let mainBranch = 'main';
    try {
      const mainRef = await githubGet(`/repos/${owner}/${repo}/git/ref/heads/main`, token);
      mainSha = mainRef.object.sha;
    } catch {
      try {
        const masterRef = await githubGet(`/repos/${owner}/${repo}/git/ref/heads/master`, token);
        mainSha = masterRef.object.sha;
        mainBranch = 'master';
      } catch {
        return errorResponse(`Could not find main or master branch on ${owner}/${repo}`, 400);
      }
    }

    await githubPost(`/repos/${owner}/${repo}/git/refs`, {
      ref: `refs/heads/${branchName}`,
      sha: mainSha
    }, token);

    await githubCommitFiles(owner, repo, branchName, [
      {
        path: '_sheeper/brief.json',
        content: JSON.stringify(brief, null, 2)
      },
      {
        path: '_sheeper/intake.json',
        content: JSON.stringify(intakeRecord, null, 2)
      }
    ], 'sheeper: initialize project brief', token);
    const templateContext = await loadTemplateContext(brief, token);
    const { plan, provider } = await generatePlan(env, brief, templateContext);

    const log = {
      currentStep: 0,
      completedSteps: [],
      totalFiles: [],
      lastUpdated: new Date().toISOString()
    };

    await githubCommitFiles(owner, repo, branchName, [
      {
        path: '_sheeper/plan.json',
        content: JSON.stringify(plan, null, 2)
      },
      {
        path: '_sheeper/log.json',
        content: JSON.stringify(log, null, 2)
      }
    ], 'sheeper: generate build plan', token);

    return jsonResponse({
      branch: branchName,
      mainBranch,
      brief,
      intake: intakeRecord,
      plan,
      log,
      provider
    });

  } catch (err) {
    console.error('Init error:', err);
    return errorResponse(err.message || 'Failed to initialize project', 500);
  }
}
