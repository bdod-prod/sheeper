import {
  checkAuth,
  jsonResponse,
  errorResponse
} from '../_shared.js';
import {
  createSnapshotFromFiles,
  getPreviewSession,
  loadSessionSnapshot,
  previewCookieHeader,
  updatePreviewSession,
  writeSessionSnapshot
} from '../_preview.js';
import { runStepGeneration } from '../_generation.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!checkAuth(request, env)) {
    return errorResponse('Unauthorized', 401);
  }

  try {
    const body = await request.json();
    const { sessionId, stepIndex, userGuidance, files: uploadedFiles } = body;

    if (!sessionId) {
      return errorResponse('sessionId is required', 400);
    }

    const session = await getPreviewSession(env, request.url, sessionId);
    if (session.shipped?.branch) {
      return errorResponse('This preview has already been saved to GitHub. For alpha, continue from the shipped branch instead of editing the preview further.', 409);
    }

    const plan = session.plan;
    const log = session.log || { currentStep: 0, completedSteps: [], totalFiles: [] };
    const targetStep = stepIndex !== undefined ? stepIndex : log.currentStep;

    if (!plan?.steps?.length) {
      return errorResponse('This preview session has no build plan', 400);
    }
    if (targetStep >= plan.steps.length) {
      return errorResponse('All steps are already completed', 400);
    }

    const currentStep = plan.steps[targetStep];
    const existingSnapshot = await loadSessionSnapshot(env, session);
    const existingFiles = existingSnapshot.map((file) => file.path);
    const existingContents = Object.fromEntries(
      existingSnapshot
        .filter((file) => !file.binary && /\.(html|css|js)$/i.test(file.path))
        .slice(0, 10)
        .map((file) => [file.path, file.content])
    );
    const completedSummary = (log.completedSteps || [])
      .map((entry) => `OK ${entry.name}: ${entry.summary} (files: ${(entry.files || []).join(', ')})`)
      .join('\n');

    const generation = await runStepGeneration(env, {
      brief: session.brief,
      plan,
      currentStep,
      stepIndex: targetStep,
      existingFiles,
      existingContents,
      completedSummary,
      templateContext: '',
      sourceMaterial: session.intake?.sourceMaterial,
      uploadedFiles,
      userGuidance
    });

    const nextVersion = Number(session.currentVersion || 0) + 1;
    const nextSnapshot = createSnapshotFromFiles(existingSnapshot, generation.files, generation.uploadedAssets);
    const manifestFiles = await writeSessionSnapshot(env, session.sessionId, nextVersion, nextSnapshot);

    const updatedLog = {
      ...log,
      currentStep: targetStep + 1,
      completedSteps: [
        ...(log.completedSteps || []),
        {
          id: currentStep.id,
          name: currentStep.name,
          summary: generation.summary,
          files: generation.files.map((file) => file.path),
          provider: generation.provider,
          completedAt: new Date().toISOString()
        }
      ],
      totalFiles: Array.from(new Set([
        ...(log.totalFiles || []),
        ...nextSnapshot.map((file) => file.path)
      ])),
      lastUpdated: new Date().toISOString()
    };

    const updatedSession = await updatePreviewSession(env, request.url, session.sessionId, {
      log: updatedLog,
      currentVersion: nextVersion,
      files: manifestFiles
    });

    return jsonResponse({
      sessionId: updatedSession.sessionId,
      step: currentStep,
      stepIndex: targetStep,
      summary: generation.summary,
      files: generation.files.map((file) => ({
        path: file.path,
        action: file.action || 'created'
      })),
      log: updatedLog,
      siteFiles: updatedSession.files,
      previewUrl: updatedSession.previewUrl,
      expiresAt: updatedSession.expiresAt,
      isLastStep: targetStep + 1 >= plan.steps.length,
      provider: generation.provider
    }, 200, {
      'Set-Cookie': previewCookieHeader(request.url, updatedSession.sessionId, updatedSession.previewSecret)
    });
  } catch (err) {
    console.error('Preview step error:', err);
    return errorResponse(err.message || 'Failed to execute preview build step', 500);
  }
}
