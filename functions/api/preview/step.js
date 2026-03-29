import {
  appendLogEvents,
  checkAuth,
  createLogEvent,
  emitRuntimeLog,
  errorResponse,
  jsonResponse
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
  let session = null;
  let currentStep = null;
  let targetStep = 0;
  let startedLog = null;

  if (!checkAuth(request, env)) {
    return errorResponse('Unauthorized', 401);
  }

  try {
    const body = await request.json();
    const { sessionId, stepIndex, userGuidance, files: uploadedFiles } = body;

    if (!sessionId) {
      return errorResponse('sessionId is required', 400);
    }

    session = await getPreviewSession(env, request.url, sessionId);
    if (session.shipped?.branch) {
      return errorResponse('This preview has already been saved to GitHub. For alpha, continue from the shipped branch instead of editing the preview further.', 409);
    }

    const plan = session.plan;
    const log = session.log || { currentStep: 0, completedSteps: [], totalFiles: [] };
    targetStep = stepIndex !== undefined ? stepIndex : log.currentStep;

    if (!plan?.steps?.length) {
      return errorResponse('This preview session has no build plan', 400);
    }
    if (targetStep >= plan.steps.length) {
      return errorResponse('All steps are already completed', 400);
    }

    currentStep = plan.steps[targetStep];
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

    startedLog = appendLogEvents(log, [
      createLogEvent('step.started', `Started step ${targetStep + 1}/${plan.steps.length}: ${currentStep.name}.`, {
        data: {
          stepId: currentStep.id,
          guidanceProvided: Boolean(String(userGuidance || '').trim()),
          uploadedFiles: (uploadedFiles || []).map((file) => file.name).filter(Boolean),
          existingFileCount: existingFiles.length
        }
      })
    ]);

    session = await updatePreviewSession(env, request.url, session.sessionId, {
      log: startedLog
    });

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

    const updatedLog = appendLogEvents({
      ...startedLog,
      currentStep: targetStep + 1,
      completedSteps: [
        ...(startedLog.completedSteps || []),
        {
          id: currentStep.id,
          name: currentStep.name,
          summary: generation.summary,
          files: generation.files.map((file) => file.path),
          provider: generation.provider,
          model: generation.model,
          completedAt: new Date().toISOString()
        }
      ],
      totalFiles: Array.from(new Set([
        ...(startedLog.totalFiles || []),
        ...nextSnapshot.map((file) => file.path)
      ]))
    }, [
      ...buildAiJsonEvents(generation.diagnostics, 'step'),
      createLogEvent('step.completed', `Completed ${currentStep.name}.`, {
        data: {
          provider: generation.provider,
          model: generation.model,
          files: generation.files.map((file) => file.path),
          summary: generation.summary,
          nextVersion
        }
      })
    ]);

    const updatedSession = await updatePreviewSession(env, request.url, session.sessionId, {
      log: updatedLog,
      currentVersion: nextVersion,
      files: manifestFiles
    });

    emitRuntimeLog('preview.step.completed', {
      sessionId: updatedSession.sessionId,
      stepId: currentStep.id,
      stepName: currentStep.name,
      stepIndex: targetStep,
      provider: generation.provider,
      model: generation.model,
      parseDiagnostics: generation.diagnostics,
      fileCount: generation.files.length,
      version: nextVersion
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
    emitRuntimeLog('preview.step.failed', {
      sessionId: session?.sessionId,
      stepId: currentStep?.id,
      stepName: currentStep?.name,
      stepIndex: targetStep,
      error: err.message
    }, 'error');
    if (session?.sessionId) {
      try {
        const failedLog = appendLogEvents(startedLog || session.log || {}, [
          createLogEvent('step.failed', `Step failed${currentStep?.name ? `: ${currentStep.name}` : ''}.`, {
            level: 'error',
            data: {
              stepId: currentStep?.id,
              stepName: currentStep?.name,
              stepIndex: targetStep,
              error: err.message
            }
          })
        ]);
        await updatePreviewSession(env, request.url, session.sessionId, {
          log: failedLog
        });
      } catch (logErr) {
        console.warn('Preview step failure logging failed:', logErr.message);
      }
    }
    console.error('Preview step error:', err);
    return errorResponse(err.message || 'Failed to execute preview build step', 500);
  }
}

function buildAiJsonEvents(diagnostics = {}, taskLabel = 'task') {
  return Object.entries(diagnostics || {})
    .filter(([, meta]) => meta?.provider)
    .map(([key, meta]) => {
      const status = meta.parseStatus || 'unknown';
      const outcome = status === 'repaired'
        ? 'json repaired'
        : status === 'failed'
          ? 'json parse failed'
          : 'json clean';
      const level = status === 'failed' ? 'error' : status === 'repaired' ? 'warn' : 'info';
      return createLogEvent('ai.task', `AI ${taskLabel}/${key} via ${meta.provider} (${outcome}).`, {
        level,
        data: meta
      });
    });
}
