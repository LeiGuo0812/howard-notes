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

