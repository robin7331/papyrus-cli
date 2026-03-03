PRAGMA foreign_keys = ON;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tdms_unique_matcher
  ON transaction_document_match_suggestions(bank_transaction_id, document_id, matcher_name, matcher_version);

CREATE INDEX IF NOT EXISTS idx_tdms_status_created
  ON transaction_document_match_suggestions(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_documents_match_prefilter
  ON documents(lifecycle_status, gross_amount_cents, document_date);
