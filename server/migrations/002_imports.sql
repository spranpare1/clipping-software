CREATE TABLE IF NOT EXISTS imports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  bytes_received INTEGER NOT NULL DEFAULT 0,
  content_length INTEGER,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);
