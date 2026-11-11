CREATE TABLE IF NOT EXISTS source_accounts (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  account_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT,
  token_expires_at TEXT,
  scopes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'connected',
  last_error TEXT,
  connected_at TEXT NOT NULL,
  UNIQUE(provider, account_id)
);

CREATE TABLE IF NOT EXISTS live_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  stream_key_enc TEXT NOT NULL,
  recording_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'starting',
  started_at TEXT NOT NULL,
  stopped_at TEXT,
  error TEXT,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);
