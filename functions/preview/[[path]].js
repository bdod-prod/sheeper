import {
  buildPreviewPlaceholder,
  getPreviewSession,
  hasPreviewAccess,
  readPreviewAsset
} from '../api/_preview.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    const { sessionId, assetPath } = parsePreviewPath(request.url);
    if (!sessionId) {
      return html('Preview session not found.', 404);
    }

    const session = await getPreviewSession(env, request.url, sessionId);
    if (!hasPreviewAccess(request, session)) {
      return html('This preview is protected. Open it from the same SHEEPER session that created it.', 403);
    }

    if (!session.currentVersion || !session.files?.length) {
      return new Response(buildPreviewPlaceholder(session), {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'private, max-age=30'
        }
      });
    }

    const asset = await readPreviewAsset(env, session, assetPath);
    if (!asset) {
      return html('Preview asset not found.', 404);
    }

    return asset;
  } catch (err) {
    if (/not found|expired/i.test(err.message || '')) {
      return html('This preview session has expired.', 410);
    }
    console.error('Preview route error:', err);
    return html('Failed to load preview.', 500);
  }
}

function parsePreviewPath(requestUrl) {
  const pathname = new URL(requestUrl).pathname;
  const parts = pathname.split('/').filter(Boolean);
  const previewIndex = parts.indexOf('preview');
  const sessionId = previewIndex >= 0 ? parts[previewIndex + 1] : '';
  const assetPath = previewIndex >= 0 ? parts.slice(previewIndex + 2).join('/') : '';
  return { sessionId, assetPath };
}

function html(message, status) {
  return new Response(`<!doctype html><html lang="en"><body style="font-family:sans-serif;padding:2rem;background:#101114;color:#f5f6f8;"><p>${message}</p></body></html>`, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}
