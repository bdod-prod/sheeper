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
import { runEditGeneration } from '../_generation.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!checkAuth(request, env)) {
    return errorResponse('Unauthorized', 401);
  }

  try {
    const body = await request.json();
    const { sessionId, userRequest, files: uploadedFiles } = body;

    if (!sessionId || !userRequest?.trim()) {
      return errorResponse('sessionId and userRequest are required', 400);
    }

    const session = await getPreviewSession(env, request.url, sessionId);
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

    const updatedLog = {
      ...(session.log || {}),
      previewEdits: [
        ...((session.log?.previewEdits) || []),
        {
          summary: generation.summary,
          files: generation.files.map((file) => file.path),
          provider: generation.provider,
          editedAt: new Date().toISOString()
        }
      ],
      totalFiles: Array.from(new Set(nextSnapshot.map((file) => file.path))),
      lastUpdated: new Date().toISOString()
    };

    const updatedSession = await updatePreviewSession(env, request.url, session.sessionId, {
      log: updatedLog,
      currentVersion: nextVersion,
      files: manifestFiles
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
    console.error('Preview edit error:', err);
    return errorResponse(err.message || 'Failed to edit preview', 500);
  }
}
