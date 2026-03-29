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
import { runEditGeneration } from '../_generation.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  let session = null;
  let startedLog = null;
  let userRequest = '';

  if (!(await checkAuth(request, env))) {
    return errorResponse('Unauthorized', 401);
  }

  try {
    const body = await request.json();
    const { sessionId, files: uploadedFiles } = body;
    userRequest = String(body?.userRequest || '');

    if (!sessionId || !userRequest?.trim()) {
      return errorResponse('sessionId and userRequest are required', 400);
    }

    session = await getPreviewSession(env, request.url, sessionId);
    if (session.shipped?.branch) {
      return errorResponse('This preview has already been saved to GitHub. For alpha, continue from the shipped branch instead of editing the preview further.', 409);
    }

    const existingSnapshot = await loadSessionSnapshot(env, session);
    const siteFiles = existingSnapshot.map((file) => file.path);
    const textContents = Object.fromEntries(
      existingSnapshot
        .filter((file) => !file.binary)
        .map((file) => [file.path, file.content])
    );
    const contextContents = {};
    for (const file of ['README.md', 'decisions.md']) {
      if (textContents[file]) {
        contextContents[file] = textContents[file];
      }
    }

    startedLog = appendLogEvents(session.log || {}, [
      createLogEvent('edit.started', 'Started preview edit request.', {
        data: {
          request: userRequest,
          uploadedFiles: (uploadedFiles || []).map((file) => file.name).filter(Boolean),
          siteFileCount: siteFiles.length
        }
      })
    ]);

    session = await updatePreviewSession(env, request.url, session.sessionId, {
      log: startedLog
    });

    const generation = await runEditGeneration(env, {
      siteLabel: session.brief?.name || 'preview session',
      siteFiles,
      existingContents: textContents,
      contextContents,
      userRequest,
      uploadedFiles,
      sourceMaterial: session.intake?.sourceMaterial
    });

    const nextVersion = Number(session.currentVersion || 0) + 1;
    const nextSnapshot = createSnapshotFromFiles(existingSnapshot, generation.files, generation.uploadedAssets);
    const manifestFiles = await writeSessionSnapshot(env, session.sessionId, nextVersion, nextSnapshot);

    const updatedLog = appendLogEvents({
      ...(startedLog || session.log || {}),
      previewEdits: [
        ...(((startedLog || session.log || {}).previewEdits) || []),
        {
          summary: generation.summary,
          files: generation.files.map((file) => file.path),
          provider: generation.provider,
          model: generation.model,
          editedAt: new Date().toISOString()
        }
      ],
      totalFiles: Array.from(new Set(nextSnapshot.map((file) => file.path)))
    }, [
      ...buildAiJsonEvents(generation.diagnostics, 'edit'),
      createLogEvent('edit.completed', 'Preview edit applied.', {
        data: {
          provider: generation.provider,
          model: generation.model,
          summary: generation.summary,
          files: generation.files.map((file) => file.path),
          request: userRequest,
          nextVersion
        }
      })
    ]);

    const updatedSession = await updatePreviewSession(env, request.url, session.sessionId, {
      log: updatedLog,
      currentVersion: nextVersion,
      files: manifestFiles
    });

    emitRuntimeLog('preview.edit.completed', {
      sessionId: updatedSession.sessionId,
      provider: generation.provider,
      model: generation.model,
      request: userRequest,
      parseDiagnostics: generation.diagnostics,
      fileCount: generation.files.length,
      version: nextVersion
    });

    return jsonResponse({
      sessionId: updatedSession.sessionId,
      summary: generation.summary,
      files: generation.files.map((file) => ({
        path: file.path,
        action: file.action || 'modified'
      })),
      log: updatedLog,
      siteFiles: updatedSession.files,
      previewUrl: updatedSession.previewUrl,
      expiresAt: updatedSession.expiresAt,
      provider: generation.provider
    }, 200, {
      'Set-Cookie': previewCookieHeader(request.url, updatedSession.sessionId, updatedSession.previewSecret)
    });
  } catch (err) {
    emitRuntimeLog('preview.edit.failed', {
      sessionId: session?.sessionId,
      request: userRequest,
      error: err.message
    }, 'error');
    if (session?.sessionId) {
      try {
        const failedLog = appendLogEvents(startedLog || session.log || {}, [
          createLogEvent('edit.failed', 'Preview edit failed.', {
            level: 'error',
            data: {
              request: userRequest,
              error: err.message
            }
          })
        ]);
        await updatePreviewSession(env, request.url, session.sessionId, {
          log: failedLog
        });
      } catch (logErr) {
        console.warn('Preview edit failure logging failed:', logErr.message);
      }
    }
    console.error('Preview edit error:', err);
    return errorResponse(err.message || 'Failed to edit preview', 500);
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
      const modelLabel = meta.model ? `/${meta.model}` : '';
      return createLogEvent('ai.task', `AI ${taskLabel}/${key} via ${meta.provider}${modelLabel} (${outcome}).`, {
        level,
        data: meta
      });
    });
}
