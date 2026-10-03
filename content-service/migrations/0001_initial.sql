-- Immutable baseline. Existing installations retain all data.
-- Subsequent changes belong in a new numbered migration.

-- schema.sql
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

-- memories-schema.sql
-- Memory cards are deliberately independent of public article snapshots and Git.
CREATE TABLE IF NOT EXISTS memory_cards (
  id TEXT PRIMARY KEY,
  source_origin TEXT,
  source_id TEXT,
  source_hash TEXT,
  visibility TEXT NOT NULL CHECK (visibility IN ('PUBLIC','PROTECTED','PRIVATE')),
  status TEXT NOT NULL CHECK (status IN ('NORMAL','ARCHIVED','TRASH')),
  created_at INTEGER NOT NULL,
  modified_at INTEGER NOT NULL,
  deleted_at INTEGER,
  previous_status TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  body TEXT NOT NULL,
  UNIQUE(source_origin, source_id)
);
CREATE INDEX IF NOT EXISTS memory_cards_listing ON memory_cards(status, visibility, created_at);
CREATE INDEX IF NOT EXISTS memory_cards_modified ON memory_cards(status, modified_at);
CREATE INDEX IF NOT EXISTS memory_cards_expiry ON memory_cards(deleted_at) WHERE status = 'TRASH';
CREATE TABLE IF NOT EXISTS memory_files (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  total_chunks INTEGER NOT NULL,
  complete INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS memory_file_chunks (
  file_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  size INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY(file_id, chunk_index)
);
CREATE TABLE IF NOT EXISTS memory_attachments (
  memory_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  PRIMARY KEY(memory_id, file_id)
);
CREATE INDEX IF NOT EXISTS memory_attachments_file ON memory_attachments(file_id, memory_id);

-- personal-notes-schema.sql
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

-- publication-jobs-schema.sql
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

-- backups-schema.sql
-- A monotonic epoch makes a paged backup provably stable across its complete read.
-- Install after memories-schema.sql and personal-notes-schema.sql.
CREATE TABLE IF NOT EXISTS backups_epoch (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  generation INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO backups_epoch (id,generation) VALUES (1,0);

-- Coordinates manual and scheduled invocations without touching content epoch.
CREATE TABLE IF NOT EXISTS backups_lease (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  lease TEXT NOT NULL,
  expires INTEGER NOT NULL
);

CREATE TRIGGER IF NOT EXISTS backup_epoch_memory_cards_insert
AFTER INSERT ON memory_cards BEGIN
  UPDATE backups_epoch SET generation=generation+1 WHERE id=1;
END;

CREATE TRIGGER IF NOT EXISTS backup_epoch_memory_cards_update
AFTER UPDATE ON memory_cards BEGIN
  UPDATE backups_epoch SET generation=generation+1 WHERE id=1;
END;

CREATE TRIGGER IF NOT EXISTS backup_epoch_memory_cards_delete
AFTER DELETE ON memory_cards BEGIN
  UPDATE backups_epoch SET generation=generation+1 WHERE id=1;
END;

CREATE TRIGGER IF NOT EXISTS backup_epoch_memory_files_insert
AFTER INSERT ON memory_files BEGIN
  UPDATE backups_epoch SET generation=generation+1 WHERE id=1;
END;

CREATE TRIGGER IF NOT EXISTS backup_epoch_memory_files_update
AFTER UPDATE ON memory_files BEGIN
  UPDATE backups_epoch SET generation=generation+1 WHERE id=1;
END;

CREATE TRIGGER IF NOT EXISTS backup_epoch_memory_files_delete
AFTER DELETE ON memory_files BEGIN
  UPDATE backups_epoch SET generation=generation+1 WHERE id=1;
END;

CREATE TRIGGER IF NOT EXISTS backup_epoch_memory_file_chunks_insert
AFTER INSERT ON memory_file_chunks BEGIN
  UPDATE backups_epoch SET generation=generation+1 WHERE id=1;
END;

CREATE TRIGGER IF NOT EXISTS backup_epoch_memory_file_chunks_update
AFTER UPDATE ON memory_file_chunks BEGIN
  UPDATE backups_epoch SET generation=generation+1 WHERE id=1;
END;

CREATE TRIGGER IF NOT EXISTS backup_epoch_memory_file_chunks_delete
AFTER DELETE ON memory_file_chunks BEGIN
  UPDATE backups_epoch SET generation=generation+1 WHERE id=1;
END;

CREATE TRIGGER IF NOT EXISTS backup_epoch_memory_attachments_insert
AFTER INSERT ON memory_attachments BEGIN
  UPDATE backups_epoch SET generation=generation+1 WHERE id=1;
END;

CREATE TRIGGER IF NOT EXISTS backup_epoch_memory_attachments_update
AFTER UPDATE ON memory_attachments BEGIN
  UPDATE backups_epoch SET generation=generation+1 WHERE id=1;
END;

CREATE TRIGGER IF NOT EXISTS backup_epoch_memory_attachments_delete
AFTER DELETE ON memory_attachments BEGIN
  UPDATE backups_epoch SET generation=generation+1 WHERE id=1;
END;

CREATE TRIGGER IF NOT EXISTS backup_epoch_personal_articles_insert
AFTER INSERT ON personal_articles BEGIN
  UPDATE backups_epoch SET generation=generation+1 WHERE id=1;
END;

CREATE TRIGGER IF NOT EXISTS backup_epoch_personal_articles_update
AFTER UPDATE ON personal_articles BEGIN
  UPDATE backups_epoch SET generation=generation+1 WHERE id=1;
END;

CREATE TRIGGER IF NOT EXISTS backup_epoch_personal_articles_delete
AFTER DELETE ON personal_articles BEGIN
  UPDATE backups_epoch SET generation=generation+1 WHERE id=1;
END;

CREATE TRIGGER IF NOT EXISTS backup_epoch_personal_article_versions_insert
AFTER INSERT ON personal_article_versions BEGIN
  UPDATE backups_epoch SET generation=generation+1 WHERE id=1;
END;

CREATE TRIGGER IF NOT EXISTS backup_epoch_personal_article_versions_update
AFTER UPDATE ON personal_article_versions BEGIN
  UPDATE backups_epoch SET generation=generation+1 WHERE id=1;
END;

CREATE TRIGGER IF NOT EXISTS backup_epoch_personal_article_versions_delete
AFTER DELETE ON personal_article_versions BEGIN
  UPDATE backups_epoch SET generation=generation+1 WHERE id=1;
END;

CREATE TRIGGER IF NOT EXISTS backup_epoch_personal_drafts_insert
AFTER INSERT ON personal_drafts BEGIN
  UPDATE backups_epoch SET generation=generation+1 WHERE id=1;
END;

CREATE TRIGGER IF NOT EXISTS backup_epoch_personal_drafts_update
AFTER UPDATE ON personal_drafts BEGIN
  UPDATE backups_epoch SET generation=generation+1 WHERE id=1;
END;

CREATE TRIGGER IF NOT EXISTS backup_epoch_personal_drafts_delete
AFTER DELETE ON personal_drafts BEGIN
  UPDATE backups_epoch SET generation=generation+1 WHERE id=1;
END;

CREATE TRIGGER IF NOT EXISTS backup_epoch_personal_draft_versions_insert
AFTER INSERT ON personal_draft_versions BEGIN
  UPDATE backups_epoch SET generation=generation+1 WHERE id=1;
END;

CREATE TRIGGER IF NOT EXISTS backup_epoch_personal_draft_versions_update
AFTER UPDATE ON personal_draft_versions BEGIN
  UPDATE backups_epoch SET generation=generation+1 WHERE id=1;
END;

CREATE TRIGGER IF NOT EXISTS backup_epoch_personal_draft_versions_delete
AFTER DELETE ON personal_draft_versions BEGIN
  UPDATE backups_epoch SET generation=generation+1 WHERE id=1;
END;

CREATE TRIGGER IF NOT EXISTS backup_epoch_personal_files_insert
AFTER INSERT ON personal_files BEGIN
  UPDATE backups_epoch SET generation=generation+1 WHERE id=1;
END;

CREATE TRIGGER IF NOT EXISTS backup_epoch_personal_files_update
AFTER UPDATE ON personal_files BEGIN
  UPDATE backups_epoch SET generation=generation+1 WHERE id=1;
END;

CREATE TRIGGER IF NOT EXISTS backup_epoch_personal_files_delete
AFTER DELETE ON personal_files BEGIN
  UPDATE backups_epoch SET generation=generation+1 WHERE id=1;
END;

CREATE TRIGGER IF NOT EXISTS backup_epoch_personal_attachments_insert
AFTER INSERT ON personal_attachments BEGIN
  UPDATE backups_epoch SET generation=generation+1 WHERE id=1;
END;

CREATE TRIGGER IF NOT EXISTS backup_epoch_personal_attachments_update
AFTER UPDATE ON personal_attachments BEGIN
  UPDATE backups_epoch SET generation=generation+1 WHERE id=1;
END;

CREATE TRIGGER IF NOT EXISTS backup_epoch_personal_attachments_delete
AFTER DELETE ON personal_attachments BEGIN
  UPDATE backups_epoch SET generation=generation+1 WHERE id=1;
END;


