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
