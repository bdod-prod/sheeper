import {
  clearGitHubConnection,
  getGitHubConnectionByBrowserSession,
  upsertGitHubConnection
} from './_appdb.js';

const GITHUB_API = 'https://api.github.com';
const GITHUB_OAUTH = 'https://github.com/login/oauth';
const INSTALLATION_TOKEN_SKEW_MS = 60 * 1000;

export function isGitHubAppConfigured(env) {
  return Boolean(
    env.APP_BASE_URL &&
    env.GITHUB_APP_ID &&
    env.GITHUB_APP_CLIENT_ID &&
    env.GITHUB_APP_CLIENT_SECRET &&
    env.GITHUB_APP_PRIVATE_KEY &&
    env.GITHUB_APP_SLUG &&
    env.GITHUB_TOKEN_ENCRYPTION_KEY
  );
}

export function githubConnectUrl(env, state) {
  const url = new URL(`${GITHUB_OAUTH}/authorize`);
  url.searchParams.set('client_id', env.GITHUB_APP_CLIENT_ID);
  url.searchParams.set('redirect_uri', buildGitHubCallbackUrl(env, 'connect/callback'));
  url.searchParams.set('state', state);
  url.searchParams.set('allow_signup', 'false');
  return url.toString();
}

export function githubInstallUrl(env) {
  return `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new`;
}

export async function exchangeGitHubUserCode(env, code) {
  const response = await fetch(`${GITHUB_OAUTH}/access_token`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      client_id: env.GITHUB_APP_CLIENT_ID,
      client_secret: env.GITHUB_APP_CLIENT_SECRET,
      code,
      redirect_uri: buildGitHubCallbackUrl(env, 'connect/callback')
    })
  });

  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(data.error_description || data.error || `GitHub token exchange failed with ${response.status}`);
  }

  return data;
}

export async function refreshGitHubUserToken(env, refreshToken) {
  const response = await fetch(`${GITHUB_OAUTH}/access_token`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      client_id: env.GITHUB_APP_CLIENT_ID,
      client_secret: env.GITHUB_APP_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
  });

  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(data.error_description || data.error || `GitHub token refresh failed with ${response.status}`);
  }

  return data;
}

export async function fetchGitHubUser(userAccessToken) {
  return githubApi('/user', {
    token: userAccessToken
  });
}

export async function listGitHubUserInstallations(userAccessToken) {
  const data = await githubApi('/user/installations?per_page=100', {
    token: userAccessToken
  });
  return Array.isArray(data.installations) ? data.installations : [];
}

export function findPersonalInstallation(installations, githubLogin) {
  return (installations || []).find((installation) =>
    installation?.target_type === 'User' &&
    installation?.account?.login &&
    installation.account.login.toLowerCase() === String(githubLogin || '').toLowerCase()
  ) || null;
}

export async function ensureFreshGitHubConnection(env, browserSessionId) {
  let connection = await getGitHubConnectionByBrowserSession(env, browserSessionId);
  if (!connection) return null;

  try {
    connection = await refreshGitHubConnectionIfNeeded(env, connection);
    connection = await ensurePersonalInstallation(env, connection);
    return connection;
  } catch (error) {
    await clearGitHubConnection(env, browserSessionId);
    throw error;
  }
}

export async function buildGitHubStatus(env, browserSessionId) {
  if (!isGitHubAppConfigured(env)) {
    return {
      configured: false,
      connected: false,
      needsInstallation: false,
      personalInstallationId: null,
      login: null,
      avatarUrl: null
    };
  }

  try {
    const connection = await ensureFreshGitHubConnection(env, browserSessionId);
    if (!connection) {
      return {
        configured: true,
        connected: false,
        needsInstallation: false,
        personalInstallationId: null,
        login: null,
        avatarUrl: null
      };
    }

    return {
      configured: true,
      connected: true,
      login: connection.githubLogin,
      avatarUrl: connection.githubAvatarUrl || null,
      needsInstallation: !connection.personalInstallationId,
      personalInstallationId: connection.personalInstallationId || null
    };
  } catch (error) {
    return {
      configured: true,
      connected: false,
      needsInstallation: false,
      personalInstallationId: null,
      login: null,
      avatarUrl: null,
      error: error.message
    };
  }
}

export async function listAccessibleRepos(env, browserSessionId, page = 1, perPage = 50) {
  const connection = await ensureFreshGitHubConnection(env, browserSessionId);
  if (!connection) {
    throw new Error('Connect GitHub before browsing repositories.');
  }
  if (!connection.personalInstallationId) {
    throw new Error('Install SHEEPER on your personal GitHub account before choosing an existing repo.');
  }

  const installationToken = await createInstallationAccessToken(env, connection.personalInstallationId);
  const query = new URLSearchParams({
    page: String(Math.max(1, Number(page) || 1)),
    per_page: String(Math.min(100, Math.max(1, Number(perPage) || 50)))
  });

  const data = await githubApi(`/installation/repositories?${query.toString()}`, {
    token: installationToken
  });

  const repositories = Array.isArray(data.repositories) ? data.repositories : [];
  return {
    page: Number(page) || 1,
    repos: repositories.map((repo) => ({
      id: repo.id,
      name: repo.name,
      fullName: repo.full_name,
      private: Boolean(repo.private),
      defaultBranch: repo.default_branch,
      updatedAt: repo.updated_at
    })),
    hasMore: repositories.length >= Math.min(100, Math.max(1, Number(perPage) || 50))
  };
}

export async function createRepoForAuthenticatedUser(env, browserSessionId, {
  name,
  private: isPrivate = true
}) {
  const connection = await ensureFreshGitHubConnection(env, browserSessionId);
  if (!connection) {
    throw new Error('Connect GitHub before creating a repository.');
  }
  if (!connection.personalInstallationId) {
    throw new Error('Install SHEEPER on your personal GitHub account before creating a repo.');
  }

  const userAccessToken = await decryptConnectionToken(env, connection.accessTokenEnc);
  const repo = await githubApi('/user/repos', {
    method: 'POST',
    token: userAccessToken,
    body: {
      name,
      private: Boolean(isPrivate),
      auto_init: true
    }
  });

  return {
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    owner: repo.owner?.login,
    private: Boolean(repo.private),
    defaultBranch: repo.default_branch,
    installationId: connection.personalInstallationId
  };
}

export async function getRepoByIdForConnection(env, browserSessionId, repoId) {
  const connection = await ensureFreshGitHubConnection(env, browserSessionId);
  if (!connection) {
    throw new Error('Connect GitHub before selecting a repo.');
  }

  const userAccessToken = await decryptConnectionToken(env, connection.accessTokenEnc);
  const repo = await githubApi(`/repositories/${repoId}`, {
    token: userAccessToken
  });

  return {
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    owner: repo.owner?.login,
    repo: repo.name,
    private: Boolean(repo.private),
    defaultBranch: repo.default_branch
  };
}

export async function createInstallationAccessToken(env, installationId) {
  if (!installationId) {
    throw new Error('GitHub installation is required.');
  }

  const appJwt = await createGitHubAppJwt(env);
  const data = await githubApi(`/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    token: appJwt,
    body: {}
  });

  if (!data.token) {
    throw new Error('GitHub installation token response did not include a token.');
  }

  return data.token;
}

export async function persistGitHubConnection(env, browserSessionId, exchange) {
  const user = await fetchGitHubUser(exchange.access_token);
  const encryptedAccessToken = await encryptSecret(env, exchange.access_token);
  const encryptedRefreshToken = exchange.refresh_token
    ? await encryptSecret(env, exchange.refresh_token)
    : null;

  let connection = await upsertGitHubConnection(env, {
    browserSessionId,
    githubUserId: user.id,
    githubLogin: user.login,
    githubAvatarUrl: user.avatar_url || '',
    accessTokenEnc: encryptedAccessToken,
    accessTokenExpiresAt: deriveExpiry(exchange.expires_in),
    refreshTokenEnc: encryptedRefreshToken,
    refreshTokenExpiresAt: deriveExpiry(exchange.refresh_token_expires_in),
    personalInstallationId: null
  });

  connection = await ensurePersonalInstallation(env, connection);
  return connection;
}

export async function clearGitHubConnectionForBrowserSession(env, browserSessionId) {
  await clearGitHubConnection(env, browserSessionId);
}

export function buildGitHubCallbackUrl(env, endpoint) {
  const base = String(env.APP_BASE_URL || '').replace(/\/+$/, '');
  return `${base}/api/github/${endpoint}`;
}

export async function createScopedGitHubTokenForRepo(env, browserSessionId, repoId) {
  const connection = await ensureFreshGitHubConnection(env, browserSessionId);
  if (!connection) {
    throw new Error('Connect GitHub before saving to a repository.');
  }
  if (!connection.personalInstallationId) {
    throw new Error('Install SHEEPER on your personal GitHub account before saving to a repository.');
  }

  const token = await createInstallationAccessToken(env, connection.personalInstallationId);
  const repo = await getRepoByIdForConnection(env, browserSessionId, repoId);
  return {
    connection,
    installationId: connection.personalInstallationId,
    token,
    repo
  };
}

async function ensurePersonalInstallation(env, connection) {
  if (connection.personalInstallationId) {
    return connection;
  }

  const userAccessToken = await decryptConnectionToken(env, connection.accessTokenEnc);
  const installations = await listGitHubUserInstallations(userAccessToken);
  const personalInstallation = findPersonalInstallation(installations, connection.githubLogin);

  if (!personalInstallation) {
    return connection;
  }

  return upsertGitHubConnection(env, {
    ...connection,
    personalInstallationId: String(personalInstallation.id)
  });
}

async function refreshGitHubConnectionIfNeeded(env, connection) {
  if (!connection.accessTokenExpiresAt) {
    return connection;
  }

  const expiresAt = new Date(connection.accessTokenExpiresAt).getTime();
  if (Number.isNaN(expiresAt) || expiresAt - Date.now() > INSTALLATION_TOKEN_SKEW_MS) {
    return connection;
  }

  if (!connection.refreshTokenEnc) {
    throw new Error('GitHub connection expired and has no refresh token. Reconnect GitHub.');
  }

  const refreshToken = await decryptConnectionToken(env, connection.refreshTokenEnc);
  const refreshed = await refreshGitHubUserToken(env, refreshToken);
  return upsertGitHubConnection(env, {
    ...connection,
    accessTokenEnc: await encryptSecret(env, refreshed.access_token),
    accessTokenExpiresAt: deriveExpiry(refreshed.expires_in),
    refreshTokenEnc: refreshed.refresh_token ? await encryptSecret(env, refreshed.refresh_token) : connection.refreshTokenEnc,
    refreshTokenExpiresAt: refreshed.refresh_token_expires_in
      ? deriveExpiry(refreshed.refresh_token_expires_in)
      : connection.refreshTokenExpiresAt
  });
}

async function decryptConnectionToken(env, cipherText) {
  return decryptSecret(env, cipherText);
}

function deriveExpiry(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Date(Date.now() + value * 1000).toISOString();
}

async function createGitHubAppJwt(env) {
  const pem = normalizePem(env.GITHUB_APP_PRIVATE_KEY);
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(pem),
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256'
    },
    false,
    ['sign']
  );

  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncodeJson({ alg: 'RS256', typ: 'JWT' });
  const payload = base64UrlEncodeJson({
    iat: now - 60,
    exp: now + 540,
    iss: env.GITHUB_APP_ID
  });
  const unsigned = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned)
  );

  return `${unsigned}.${base64UrlEncodeBytes(signature)}`;
}

async function encryptSecret(env, plainText) {
  const key = await deriveEncryptionKey(env.GITHUB_TOKEN_ENCRYPTION_KEY);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(String(plainText || ''))
  );

  return `${base64UrlEncodeBytes(iv)}.${base64UrlEncodeBytes(cipher)}`;
}

async function decryptSecret(env, packed) {
  const [ivPart, dataPart] = String(packed || '').split('.');
  if (!ivPart || !dataPart) {
    throw new Error('Encrypted secret is malformed.');
  }

  const key = await deriveEncryptionKey(env.GITHUB_TOKEN_ENCRYPTION_KEY);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64UrlDecode(ivPart) },
    key,
    base64UrlDecode(dataPart)
  );

  return new TextDecoder().decode(plain);
}

async function deriveEncryptionKey(secret) {
  const seed = String(secret || '').trim();
  if (!seed) {
    throw new Error('GITHUB_TOKEN_ENCRYPTION_KEY is not configured.');
  }

  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed));
  return crypto.subtle.importKey(
    'raw',
    hash,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function githubApi(path, {
  method = 'GET',
  token,
  body = null
} = {}) {
  const response = await fetch(`${GITHUB_API}${path}`, {
    method,
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  const data = text ? safeJson(text) ?? text : null;
  if (!response.ok) {
    const detail = typeof data === 'string'
      ? data
      : data?.message || JSON.stringify(data || {});
    throw new Error(`GitHub API ${response.status}: ${detail}`);
  }
  return data;
}

function normalizePem(input) {
  return String(input || '').replace(/\\n/g, '\n');
}

function pemToArrayBuffer(pem) {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');

  return base64UrlDecode(base64.replace(/\+/g, '-').replace(/\//g, '_'));
}

function base64UrlEncodeJson(value) {
  return base64UrlEncodeBytes(new TextEncoder().encode(JSON.stringify(value)));
}

function base64UrlEncodeBytes(value) {
  const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
