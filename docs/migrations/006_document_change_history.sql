PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS document_change_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  changed_at TEXT NOT NULL,
  changed_by TEXT,
  change_reason TEXT,
  changed_fields_json TEXT NOT NULL,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_document_change_history_doc_changed
  ON document_change_history(document_id, changed_at DESC);
