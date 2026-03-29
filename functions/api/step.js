// POST /api/step
// Executes a repo-backed build step against a SHEEPER staging branch.

import {
  checkAuth,
  jsonResponse,
  errorResponse,
  githubGetFile,
  githubGetFileSafe,
  githubGetTree,
  githubCommitFiles
} from './_shared.js';
import { runStepGeneration } from './_generation.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!(await checkAuth(request, env))) {
    return errorResponse('Unauthorized', 401);
  }

  try {
    const body = await request.json();
    const { owner, repo, branch, stepIndex, userGuidance, files: uploadedFiles } = body;

    if (!owner || !repo || !branch) {
      return errorResponse('owner, repo, and branch are required', 400);
    }

    const token = env.GITHUB_TOKEN;
    const [briefRaw, planRaw, logRaw, intakeRaw] = await Promise.all([
      githubGetFile(owner, repo, '_sheeper/brief.json', branch, token),
      githubGetFile(owner, repo, '_sheeper/plan.json', branch, token),
      githubGetFile(owner, repo, '_sheeper/log.json', branch, token),
      githubGetFileSafe(owner, repo, '_sheeper/intake.json', branch, token)
    ]);

    const brief = JSON.parse(briefRaw);
    const plan = JSON.parse(planRaw);
    const log = JSON.parse(logRaw);
    const intake = intakeRaw ? JSON.parse(intakeRaw) : null;

    const targetStep = stepIndex !== undefined ? stepIndex : log.currentStep;
    if (targetStep >= plan.steps.length) {
      return errorResponse('All steps are already completed', 400);
    }

    const currentStepDef = plan.steps[targetStep];
    const fileTree = await githubGetTree(owner, repo, branch, token);
    const siteFiles = fileTree.filter((file) => !file.startsWith('_sheeper/'));

    const existingContents = {};
    for (const filePath of siteFiles.filter((file) => /\.(html|css|js)$/i.test(file)).slice(0, 10)) {
      const content = await githubGetFileSafe(owner, repo, filePath, branch, token);
      if (content) {
        existingContents[filePath] = content;
      }
    }

    let templateContext = '';
    if (brief.templateRepo) {
      const [templateOwner, templateRepo] = brief.templateRepo.split('/');
      if (templateOwner && templateRepo) {
        for (const templateFile of ['README.md', 'decisions.md']) {
          const content = await githubGetFileSafe(templateOwner, templateRepo, templateFile, 'main', token);
          if (content) {
            templateContext += `--- Template: ${templateFile} ---\n${content}\n\n`;
          }
        }
      }
    }

    const completedSummary = (log.completedSteps || [])
      .map((entry) => `OK ${entry.name}: ${entry.summary} (files: ${(entry.files || []).join(', ')})`)
      .join('\n');

    const generation = await runStepGeneration(env, {
      brief,
      plan,
      currentStep: currentStepDef,
      stepIndex: targetStep,
      existingFiles: siteFiles,
      existingContents,
      completedSummary,
      templateContext,
      sourceMaterial: intake?.sourceMaterial,
      uploadedFiles,
      userGuidance
    });

    const commitFiles = generation.files.map((file) => ({
      path: file.path,
      content: file.content
    }));

    for (const asset of generation.uploadedAssets) {
      commitFiles.push({
        path: asset.path,
        content: asset.content,
        encoding: asset.encoding
      });
    }

    const updatedLog = {
      currentStep: targetStep + 1,
      completedSteps: [
        ...(log.completedSteps || []),
        {
          id: currentStepDef.id,
          name: currentStepDef.name,
          summary: generation.summary,
          files: generation.files.map((file) => file.path),
          provider: generation.provider,
          completedAt: new Date().toISOString()
        }
      ],
      totalFiles: Array.from(new Set([
        ...(log.totalFiles || []),
        ...generation.files.map((file) => file.path)
      ])),
      lastUpdated: new Date().toISOString()
    };

    commitFiles.push({
      path: '_sheeper/log.json',
      content: JSON.stringify(updatedLog, null, 2)
    });

    await githubCommitFiles(owner, repo, branch, commitFiles, `sheeper: ${currentStepDef.name}`, token);

    const cfBranch = branch.replace(/\//g, '-');
    const previewUrl = brief.domain
      ? `https://${cfBranch}.${brief.domain.replace('https://', '').replace('http://', '')}`
      : `https://${cfBranch}.${repo}.pages.dev`;

    return jsonResponse({
      step: currentStepDef,
      stepIndex: targetStep,
      summary: generation.summary,
      files: generation.files.map((file) => ({
        path: file.path,
        action: file.action || 'created'
      })),
      log: updatedLog,
      previewUrl,
      isLastStep: targetStep + 1 >= plan.steps.length,
      provider: generation.provider
    });
  } catch (err) {
    console.error('Step error:', err);
    return errorResponse(err.message || 'Failed to execute build step', 500);
  }
}
