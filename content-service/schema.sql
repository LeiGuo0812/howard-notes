-- Separate from the login database. Only public content and bounded sync staging.
CREATE TABLE IF NOT EXISTS content_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 0,
  commit_sha TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO content_state(id) VALUES (1);
CREATE TABLE IF NOT EXISTS sync_session (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  sync_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  base_revision INTEGER NOT NULL,
  commit_sha TEXT NOT NULL,
  manifest TEXT NOT NULL,
  expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS public_documents (
  revision INTEGER NOT NULL,
  id TEXT NOT NULL,
  source_sha TEXT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY(revision, id)
);
CREATE TABLE IF NOT EXISTS public_pages (
  revision INTEGER NOT NULL,
  path TEXT NOT NULL,
  body TEXT NOT NULL,
  page_hash TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(revision, path)
);
CREATE TABLE IF NOT EXISTS public_payloads (
  revision INTEGER NOT NULL,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY(revision, name)
);
