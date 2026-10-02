-- Private articles and recovery drafts never participate in public snapshots.
CREATE TABLE IF NOT EXISTS personal_articles (
  id TEXT PRIMARY KEY,
  file TEXT NOT NULL UNIQUE,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PUBLISHED','TRASH')),
  article TEXT NOT NULL,
  raw TEXT NOT NULL,
  source_hash TEXT,
  public_link TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  previous_status TEXT,
  last_request_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS personal_articles_listing ON personal_articles(status,updated_at,id);
CREATE INDEX IF NOT EXISTS personal_articles_expiry ON personal_articles(deleted_at) WHERE status='TRASH';
CREATE TABLE IF NOT EXISTS personal_article_versions (
  article_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  article TEXT NOT NULL,
  raw TEXT NOT NULL,
  public_link TEXT,
  saved_at INTEGER NOT NULL,
  PRIMARY KEY(article_id,version)
);
CREATE TABLE IF NOT EXISTS personal_drafts (
  editor_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 1,
  record TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','TRASH')),
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  last_request_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS personal_drafts_listing ON personal_drafts(status,updated_at,editor_id);
CREATE TABLE IF NOT EXISTS personal_draft_versions (
  editor_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  record TEXT NOT NULL,
  saved_at INTEGER NOT NULL,
  PRIMARY KEY(editor_id,version)
);
CREATE TABLE IF NOT EXISTS personal_files (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  object_key TEXT NOT NULL,
  complete INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS personal_attachments (
  article_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  PRIMARY KEY(article_id,file_id)
);
CREATE INDEX IF NOT EXISTS personal_attachments_file ON personal_attachments(file_id,article_id);
-- A bounded receipt prevents retries from creating a new revision or deleting twice.
CREATE TABLE IF NOT EXISTS personal_requests (
  request_id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  response TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
