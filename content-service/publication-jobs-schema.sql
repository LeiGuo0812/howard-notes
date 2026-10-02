-- Transient encrypted credentials are deliberately excluded from long-term backups.
CREATE TABLE IF NOT EXISTS publication_jobs (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  fingerprint TEXT NOT NULL,
  kind TEXT NOT NULL,
  input TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  checkpoint TEXT,
  attachment_mappings TEXT,
  token_cipher TEXT,
  token_expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_run_at INTEGER NOT NULL,
  lease_until INTEGER NOT NULL DEFAULT 0,
  lease_id TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS publication_jobs_pending ON publication_jobs(status,next_run_at,lease_until);
