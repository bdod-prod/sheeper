export const SESSION_TTL_SECONDS = 60 * 60 * 24;
export const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;

export async function createPreviewSession(env, requestUrl, payload) {
  const sessionId = crypto.randomUUID();
  const response = await callPreviewSessionDO(env, sessionId, '/create', payload);
  return withPreviewSessionContext(response.session, requestUrl);
}

export async function getPreviewSession(env, requestUrl, sessionId) {
  const response = await callPreviewSessionDO(env, sessionId, '/get', {});
  return withPreviewSessionContext(response.session, requestUrl);
}

export async function updatePreviewSession(env, requestUrl, sessionId, patch) {
  const response = await callPreviewSessionDO(env, sessionId, '/update', patch);
  return withPreviewSessionContext(response.session, requestUrl);
}

export function buildPreviewUrl(requestUrl, sessionId, path = '') {
  const normalized = String(path || '').replace(/^\/+/, '');
  return new URL(`/preview/${sessionId}/${normalized}`, requestUrl).toString();
}

export function previewCookieHeader(requestUrl, sessionId, secret) {
  const url = new URL(requestUrl);
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return `${previewCookieName(sessionId)}=${encodeURIComponent(secret)}; Path=/preview/${sessionId}; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; SameSite=Lax${secure}`;
}

export function previewCookieName(sessionId) {
  return `sheeper_preview_${String(sessionId || '').replace(/[^a-zA-Z0-9]/g, '')}`;
}

export function hasPreviewAccess(request, session) {
  const cookies = parseCookies(request.headers.get('Cookie') || '');
  return cookies[previewCookieName(session.sessionId)] === session.previewSecret;
}

export async function writeSessionSnapshot(env, sessionId, version, files) {
  const normalizedFiles = files.map((file) => normalizeSnapshotFile(file));
  const manifest = {
    version,
    files: normalizedFiles.map(({ path, contentType, binary }) => ({
      path,
      contentType,
      binary
    }))
  };

  await env.PREVIEW_ASSETS.put(
    sessionManifestKey(sessionId, version),
    JSON.stringify(manifest, null, 2),
    { httpMetadata: { contentType: 'application/json; charset=utf-8' } }
  );

  for (const file of normalizedFiles) {
    const key = sessionObjectKey(sessionId, version, file.path);
    if (file.binary) {
      await env.PREVIEW_ASSETS.put(key, decodeBase64ToBytes(file.content), {
        httpMetadata: { contentType: file.contentType }
      });
    } else {
      await env.PREVIEW_ASSETS.put(key, file.content, {
        httpMetadata: { contentType: file.contentType }
      });
    }
  }

  return manifest.files;
}

export async function loadSessionSnapshot(env, session) {
  if (!session?.currentVersion || !session?.files?.length) {
    return [];
  }

  const files = [];
  for (const file of session.files) {
    const object = await env.PREVIEW_ASSETS.get(sessionObjectKey(session.sessionId, session.currentVersion, file.path));
    if (!object) continue;

    if (file.binary) {
      const buffer = await object.arrayBuffer();
      files.push({
        path: file.path,
        binary: true,
        contentType: file.contentType,
        content: arrayBufferToBase64(buffer)
      });
    } else {
      files.push({
        path: file.path,
        binary: false,
        contentType: file.contentType,
        content: await object.text()
      });
    }
  }

  return files;
}

export async function readPreviewAsset(env, session, requestedPath) {
  const resolved = resolvePreviewPath(session.files || [], requestedPath);
  if (!resolved) {
    return null;
  }

  const object = await env.PREVIEW_ASSETS.get(
    sessionObjectKey(session.sessionId, session.currentVersion, resolved.path)
  );
  if (!object) {
    return null;
  }

  const headers = new Headers();
  headers.set('Content-Type', resolved.contentType || detectContentType(resolved.path));
  headers.set('Cache-Control', 'private, max-age=60');

  if (resolved.path.endsWith('.html')) {
    const html = rewritePreviewHtml(await object.text(), session.sessionId);
    return new Response(html, { headers });
  }

  if (resolved.path.endsWith('.css')) {
    const css = rewritePreviewCss(await object.text(), session.sessionId);
    return new Response(css, { headers });
  }

  return new Response(object.body, { headers });
}

export function buildPreviewPlaceholder(session) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(session?.brief?.name || 'SHEEPER Preview')}</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #0b0b0d;
        color: #d2d3d8;
        font-family: ui-sans-serif, system-ui, sans-serif;
      }
      main {
        width: min(680px, calc(100% - 2rem));
        padding: 2rem;
        border: 1px solid rgba(255,255,255,0.09);
        border-radius: 12px;
        background: rgba(255,255,255,0.03);
      }
      h1 { margin: 0 0 0.6rem; font-size: 1.6rem; color: #fff; }
      p { margin: 0.4rem 0; line-height: 1.6; }
      .mono { font-family: ui-monospace, monospace; color: #8c8f9b; font-size: 0.9rem; }
    </style>
  </head>
  <body>
    <main>
      <div class="mono">Protected Preview</div>
      <h1>${escapeHtml(session?.brief?.name || 'Preview session')}</h1>
      <p>${escapeHtml(session?.brief?.summary || 'This preview session exists, but no files have been generated yet.')}</p>
      <p>Run the first build step in SHEEPER and this preview will update automatically.</p>
    </main>
  </body>
</html>`;
}

export function createSnapshotFromFiles(existingFiles, changedFiles, uploadedAssets = []) {
  const snapshot = new Map();

  for (const file of existingFiles || []) {
    snapshot.set(file.path, normalizeSnapshotFile(file));
  }

  for (const file of changedFiles || []) {
    snapshot.set(file.path, normalizeSnapshotFile({
      path: file.path,
      content: file.content,
      contentType: detectContentType(file.path),
      binary: false
    }));
  }

  for (const asset of uploadedAssets || []) {
    snapshot.set(asset.path, normalizeSnapshotFile(asset));
  }

  return Array.from(snapshot.values()).sort((left, right) => left.path.localeCompare(right.path));
}

function withPreviewSessionContext(session, requestUrl) {
  return {
    ...session,
    previewUrl: buildPreviewUrl(requestUrl, session.sessionId)
  };
}

async function callPreviewSessionDO(env, sessionId, path, payload) {
  if (!env.PREVIEW_SESSIONS) {
    throw new Error('PREVIEW_SESSIONS binding is not configured.');
  }

  const id = env.PREVIEW_SESSIONS.idFromName(sessionId);
  const stub = env.PREVIEW_SESSIONS.get(id);
  const response = await stub.fetch(`https://preview-session${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, ...payload })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Preview session request failed with ${response.status}`);
  }

  return response.json();
}

function normalizeSnapshotFile(file) {
  const path = String(file?.path || '').replace(/^\/+/, '').trim();
  const binary = Boolean(file?.binary || file?.encoding === 'base64');
  return {
    path,
    content: typeof file?.content === 'string' ? file.content : '',
    binary,
    contentType: file?.contentType || detectContentType(path)
  };
}

function sessionManifestKey(sessionId, version) {
  return `sessions/${sessionId}/versions/${version}/manifest.json`;
}

function sessionObjectKey(sessionId, version, path) {
  return `sessions/${sessionId}/versions/${version}/${String(path || '').replace(/^\/+/, '')}`;
}

function resolvePreviewPath(files, requestedPath) {
  const normalizedPath = String(requestedPath || '').replace(/^\/+/, '');
  const candidateKeys = [];

  if (!normalizedPath) {
    candidateKeys.push('index.html');
  } else {
    candidateKeys.push(normalizedPath);
    if (!/\.[a-z0-9]+$/i.test(normalizedPath)) {
      candidateKeys.push(`${normalizedPath}.html`);
      candidateKeys.push(`${normalizedPath}/index.html`);
    }
  }

  const byPath = new Map(files.map((file) => [file.path, file]));
  for (const candidate of candidateKeys) {
    if (byPath.has(candidate)) {
      return byPath.get(candidate);
    }
  }

  return null;
}

function rewritePreviewHtml(html, sessionId) {
  const baseHref = `/preview/${sessionId}/`;
  const withBase = /<base\s/i.test(html)
    ? html
    : html.replace(/<head([^>]*)>/i, `<head$1><base href="${baseHref}">`);

  return withBase.replace(/(href|src|action)=("|')\/(?!\/|preview\/)/gi, `$1=$2${baseHref}`);
}

function rewritePreviewCss(css, sessionId) {
  const prefix = `/preview/${sessionId}/`;
  return css.replace(/url\((['"]?)\/(?!\/|preview\/)/gi, `url($1${prefix}`);
}

function detectContentType(path) {
  const lower = String(path || '').toLowerCase();
  if (lower.endsWith('.html')) return 'text/html; charset=utf-8';
  if (lower.endsWith('.css')) return 'text/css; charset=utf-8';
  if (lower.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (lower.endsWith('.json')) return 'application/json; charset=utf-8';
  if (lower.endsWith('.xml')) return 'application/xml; charset=utf-8';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.ico')) return 'image/x-icon';
  if (lower.endsWith('.txt') || lower.endsWith('.md')) return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

function parseCookies(rawCookie) {
  return String(rawCookie || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((accumulator, part) => {
      const index = part.indexOf('=');
      if (index === -1) return accumulator;
      const key = part.slice(0, index).trim();
      const value = decodeURIComponent(part.slice(index + 1).trim());
      accumulator[key] = value;
      return accumulator;
    }, {});
}

function decodeBase64ToBytes(base64) {
  const binary = atob(String(base64 || ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
