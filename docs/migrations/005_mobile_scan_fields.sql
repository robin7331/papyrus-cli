PRAGMA foreign_keys = ON;

ALTER TABLE documents ADD COLUMN net_amount_cents INTEGER;
ALTER TABLE documents ADD COLUMN vat_amount_cents INTEGER;
ALTER TABLE documents ADD COLUMN vat_rate_bps INTEGER;
ALTER TABLE documents ADD COLUMN subject TEXT;
ALTER TABLE documents ADD COLUMN summary_short TEXT;
ALTER TABLE documents ADD COLUMN ocr_text TEXT;
ALTER TABLE documents ADD COLUMN ocr_confidence REAL;
ALTER TABLE documents ADD COLUMN ai_confidence REAL;
ALTER TABLE documents ADD COLUMN duplicate_group_key TEXT;
ALTER TABLE documents ADD COLUMN image_preview_rel_path TEXT;
ALTER TABLE documents ADD COLUMN scan_session_id TEXT;
ALTER TABLE documents ADD COLUMN capture_device_label TEXT;
ALTER TABLE documents ADD COLUMN capture_taken_at TEXT;
ALTER TABLE documents ADD COLUMN review_required INTEGER NOT NULL DEFAULT 0 CHECK (review_required IN (0,1));
ALTER TABLE documents ADD COLUMN extraction_model TEXT;

CREATE INDEX IF NOT EXISTS idx_documents_year_source_date
  ON documents(year, source_type, document_date);

CREATE INDEX IF NOT EXISTS idx_documents_amount_date
  ON documents(gross_amount_cents, document_date);

CREATE INDEX IF NOT EXISTS idx_documents_duplicate_group
  ON documents(duplicate_group_key);

CREATE INDEX IF NOT EXISTS idx_documents_scan_session
  ON documents(scan_session_id, created_at DESC);
