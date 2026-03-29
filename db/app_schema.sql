CREATE TABLE IF NOT EXISTS browser_sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  authenticated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS github_connections (
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
);

CREATE TABLE IF NOT EXISTS github_oauth_states (
  state TEXT PRIMARY KEY,
  browser_session_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  return_to_session_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (browser_session_id) REFERENCES browser_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_browser_sessions_expires_at ON browser_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_github_oauth_states_expires_at ON github_oauth_states(expires_at);
CREATE INDEX IF NOT EXISTS idx_github_connections_browser_session_id ON github_connections(browser_session_id);
