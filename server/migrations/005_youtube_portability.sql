CREATE TABLE IF NOT EXISTS youtube_archive_jobs (
  import_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  visibility TEXT NOT NULL,
  archive_job_id TEXT,
  state TEXT NOT NULL DEFAULT 'queued',
  updated_at TEXT NOT NULL,
  FOREIGN KEY(import_id) REFERENCES imports(id)
);

CREATE TABLE IF NOT EXISTS twitch_vod_imports (
  import_id TEXT PRIMARY KEY,
  vod_id TEXT NOT NULL,
  end_offset REAL NOT NULL,
  duration REAL NOT NULL,
  title TEXT NOT NULL,
  twitch_clip_id TEXT,
  broadcaster_id TEXT,
  FOREIGN KEY(import_id) REFERENCES imports(id)
);
