CREATE TABLE IF NOT EXISTS transcript_words (
  project_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  start REAL NOT NULL,
  end REAL NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY(project_id, ordinal),
  FOREIGN KEY(project_id) REFERENCES projects(id)
);
CREATE TABLE IF NOT EXISTS transcriptions (
  project_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  language TEXT,
  error TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);
CREATE TABLE IF NOT EXISTS clip_edits (
  clip_id TEXT PRIMARY KEY,
  trim_start REAL NOT NULL DEFAULT 0,
  trim_end REAL,
  crop_json TEXT,
  layout TEXT NOT NULL DEFAULT 'auto',
  aspect TEXT NOT NULL DEFAULT '9:16',
  captions_enabled INTEGER NOT NULL DEFAULT 1,
  caption_position TEXT NOT NULL DEFAULT 'bottom',
  caption_style TEXT NOT NULL DEFAULT 'clean',
  updated_at TEXT NOT NULL,
  FOREIGN KEY(clip_id) REFERENCES clips(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS social_accounts (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  account_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT,
  token_expires_at TEXT,
  scopes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'connected',
  last_error TEXT,
  connected_at TEXT NOT NULL,
  UNIQUE(platform, account_id)
);
CREATE TABLE IF NOT EXISTS publishing_jobs (
  id TEXT PRIMARY KEY,
  clip_id TEXT NOT NULL,
  social_account_id TEXT NOT NULL,
  status TEXT NOT NULL,
  scheduled_at TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  metadata TEXT NOT NULL,
  remote_id TEXT,
  post_url TEXT,
  last_error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  progress INTEGER NOT NULL DEFAULT 0,
  session_url_enc TEXT,
  privacy_status TEXT NOT NULL DEFAULT 'public',
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(clip_id) REFERENCES clips(id),
  FOREIGN KEY(social_account_id) REFERENCES social_accounts(id)
);
CREATE TABLE IF NOT EXISTS automation_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  enabled INTEGER NOT NULL DEFAULT 0,
  stop_publishing INTEGER NOT NULL DEFAULT 0,
  daily_limit INTEGER NOT NULL DEFAULT 3,
  minimum_score INTEGER NOT NULL DEFAULT 0,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  config TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);
INSERT OR IGNORE INTO automation_settings(id,updated_at) VALUES(1,datetime('now'));
