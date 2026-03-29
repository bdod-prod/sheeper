const BROWSER_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const OAUTH_STATE_TTL_SECONDS = 60 * 10;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS browser_sessions (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    authenticated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS github_connections (
    id TEXT PRIMARY KEY,
    browser_session_id TEXT NOT NULL UNIQUE,
    github_user_id TEXT NOT NULL,
    github_login TEXT NOT NULL,
    github_avatar_url TEXT,
    access_token_enc TEXT NOT NULL,
    access_token_expires_at TEXT,
    refresh_token_enc TEXT,
    refresh_token_expires_at TEXT,
    personal_installation_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (browser_session_id) REFERENCES browser_sessions(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS github_oauth_states (
    state TEXT PRIMARY KEY,
    browser_session_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    return_to_session_id TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (browser_session_id) REFERENCES browser_sessions(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_browser_sessions_expires_at ON browser_sessions(expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_github_oauth_states_expires_at ON github_oauth_states(expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_github_connections_browser_session_id ON github_connections(browser_session_id)`
];

export async function ensureAppDb(env) {
  if (!env.APP_DB) {
    throw new Error('APP_DB binding is not configured.');
  }
  if (env.__sheeperAppDbReady) {
    return;
  }

  await env.APP_DB.batch(SCHEMA.map((statement) => env.APP_DB.prepare(statement)));
  env.__sheeperAppDbReady = true;
}

export async function createBrowserSession(env) {
  await ensureAppDb(env);
  const now = new Date();
  const session = {
    id: crypto.randomUUID(),
    createdAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    authenticatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + BROWSER_SESSION_TTL_SECONDS * 1000).toISOString()
  };

  await env.APP_DB.prepare(`
    INSERT INTO browser_sessions (id, created_at, last_seen_at, expires_at, authenticated_at)
    VALUES (?1, ?2, ?3, ?4, ?5)
  `).bind(
    session.id,
    session.createdAt,
    session.lastSeenAt,
    session.expiresAt,
    session.authenticatedAt
  ).run();

  return session;
}

export async function getBrowserSession(env, sessionId) {
  await ensureAppDb(env);
  if (!sessionId) return null;

  const row = await env.APP_DB.prepare(`
    SELECT id, created_at, last_seen_at, expires_at, authenticated_at
    FROM browser_sessions
    WHERE id = ?1
    LIMIT 1
  `).bind(sessionId).first();

  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await deleteBrowserSession(env, sessionId);
    return null;
  }

  return mapBrowserSession(row);
}

export async function touchBrowserSession(env, sessionId) {
  const session = await getBrowserSession(env, sessionId);
  if (!session) return null;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + BROWSER_SESSION_TTL_SECONDS * 1000).toISOString();
  const lastSeenAt = now.toISOString();

  await env.APP_DB.prepare(`
    UPDATE browser_sessions
    SET last_seen_at = ?2, expires_at = ?3
    WHERE id = ?1
  `).bind(sessionId, lastSeenAt, expiresAt).run();

  return {
    ...session,
    lastSeenAt,
    expiresAt
  };
}

export async function deleteBrowserSession(env, sessionId) {
  await ensureAppDb(env);
  if (!sessionId) return;

  await env.APP_DB.batch([
    env.APP_DB.prepare('DELETE FROM github_oauth_states WHERE browser_session_id = ?1').bind(sessionId),
    env.APP_DB.prepare('DELETE FROM github_connections WHERE browser_session_id = ?1').bind(sessionId),
    env.APP_DB.prepare('DELETE FROM browser_sessions WHERE id = ?1').bind(sessionId)
  ]);
}

export async function storeGitHubOAuthState(env, {
  state,
  browserSessionId,
  kind,
  returnToSessionId = null
}) {
  await ensureAppDb(env);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + OAUTH_STATE_TTL_SECONDS * 1000).toISOString();

  await env.APP_DB.prepare(`
    INSERT OR REPLACE INTO github_oauth_states (
      state,
      browser_session_id,
      kind,
      return_to_session_id,
      created_at,
      expires_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
  `).bind(
    state,
    browserSessionId,
    kind,
    returnToSessionId,
    now.toISOString(),
    expiresAt
  ).run();
}

export async function consumeGitHubOAuthState(env, state, expectedKind = null) {
  await ensureAppDb(env);
  if (!state) return null;

  const row = await env.APP_DB.prepare(`
    SELECT state, browser_session_id, kind, return_to_session_id, created_at, expires_at
    FROM github_oauth_states
    WHERE state = ?1
    LIMIT 1
  `).bind(state).first();

  if (!row) return null;

  await env.APP_DB.prepare('DELETE FROM github_oauth_states WHERE state = ?1').bind(state).run();

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return null;
  }
  if (expectedKind && row.kind !== expectedKind) {
    return null;
  }

  return {
    state: row.state,
    browserSessionId: row.browser_session_id,
    kind: row.kind,
    returnToSessionId: row.return_to_session_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at
  };
}

export async function upsertGitHubConnection(env, connection) {
  await ensureAppDb(env);
  const now = new Date().toISOString();
  const existing = await getGitHubConnectionByBrowserSession(env, connection.browserSessionId);
  const id = existing?.id || crypto.randomUUID();
  const createdAt = existing?.createdAt || now;

  await env.APP_DB.prepare(`
    INSERT OR REPLACE INTO github_connections (
      id,
      browser_session_id,
      github_user_id,
      github_login,
      github_avatar_url,
      access_token_enc,
      access_token_expires_at,
      refresh_token_enc,
      refresh_token_expires_at,
      personal_installation_id,
      created_at,
      updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
  `).bind(
    id,
    connection.browserSessionId,
    String(connection.githubUserId),
    connection.githubLogin,
    connection.githubAvatarUrl || '',
    connection.accessTokenEnc,
    connection.accessTokenExpiresAt || null,
    connection.refreshTokenEnc || null,
    connection.refreshTokenExpiresAt || null,
    connection.personalInstallationId ? String(connection.personalInstallationId) : null,
    createdAt,
    now
  ).run();

  return getGitHubConnectionByBrowserSession(env, connection.browserSessionId);
}

export async function getGitHubConnectionByBrowserSession(env, browserSessionId) {
  await ensureAppDb(env);
  if (!browserSessionId) return null;

  const row = await env.APP_DB.prepare(`
    SELECT
      id,
      browser_session_id,
      github_user_id,
      github_login,
      github_avatar_url,
      access_token_enc,
      access_token_expires_at,
      refresh_token_enc,
      refresh_token_expires_at,
      personal_installation_id,
      created_at,
      updated_at
    FROM github_connections
    WHERE browser_session_id = ?1
    LIMIT 1
  `).bind(browserSessionId).first();

  if (!row) return null;

  return {
    id: row.id,
    browserSessionId: row.browser_session_id,
    githubUserId: row.github_user_id,
    githubLogin: row.github_login,
    githubAvatarUrl: row.github_avatar_url || '',
    accessTokenEnc: row.access_token_enc,
    accessTokenExpiresAt: row.access_token_expires_at,
    refreshTokenEnc: row.refresh_token_enc,
    refreshTokenExpiresAt: row.refresh_token_expires_at,
    personalInstallationId: row.personal_installation_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function clearGitHubConnection(env, browserSessionId) {
  await ensureAppDb(env);
  if (!browserSessionId) return;
  await env.APP_DB.prepare('DELETE FROM github_connections WHERE browser_session_id = ?1').bind(browserSessionId).run();
}

export function browserSessionTtlSeconds() {
  return BROWSER_SESSION_TTL_SECONDS;
}

function mapBrowserSession(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    authenticatedAt: row.authenticated_at
  };
}
