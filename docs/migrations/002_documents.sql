PRAGMA foreign_keys = ON;

ALTER TABLE bank_transactions ADD COLUMN document_status TEXT NOT NULL DEFAULT 'offen' CHECK (document_status IN ('offen','zugeordnet','nicht_erforderlich','in_klaerung'));
ALTER TABLE bank_transactions ADD COLUMN missing_invoice_flag INTEGER NOT NULL DEFAULT 0 CHECK (missing_invoice_flag IN (0,1));
ALTER TABLE bank_transactions ADD COLUMN document_status_updated_at TEXT;
ALTER TABLE bank_transactions ADD COLUMN document_note TEXT;

CREATE INDEX IF NOT EXISTS idx_bank_transactions_document_status
  ON bank_transactions(document_status, booking_date);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('email','scan','portal','manuell','sonstiges')),
  lifecycle_status TEXT NOT NULL CHECK (lifecycle_status IN ('inbox','archiviert','verworfen')) DEFAULT 'archiviert',
  storage_rel_path TEXT NOT NULL UNIQUE,
  original_filename TEXT,
  mime_type TEXT,
  file_size_bytes INTEGER NOT NULL,
  file_sha256 TEXT NOT NULL UNIQUE,
  document_date TEXT,
  issuer_name TEXT,
  invoice_number TEXT,
  gross_amount_cents INTEGER,
  currency TEXT NOT NULL DEFAULT 'EUR',
  ocr_status TEXT NOT NULL CHECK (ocr_status IN ('pending','done','failed','not_needed')) DEFAULT 'pending',
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_documents_year_source ON documents(year, source_type);
CREATE INDEX IF NOT EXISTS idx_documents_date ON documents(document_date);
CREATE INDEX IF NOT EXISTS idx_documents_lifecycle ON documents(lifecycle_status);

CREATE TABLE IF NOT EXISTS document_email_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL UNIQUE REFERENCES documents(id) ON DELETE CASCADE,
  mailbox TEXT,
  message_id TEXT UNIQUE,
  received_at TEXT,
  sender TEXT,
  recipient TEXT,
  subject TEXT,
  attachment_filename TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_document_email_received_at ON document_email_sources(received_at);

CREATE TABLE IF NOT EXISTS transaction_document_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_transaction_id INTEGER NOT NULL REFERENCES bank_transactions(id) ON DELETE CASCADE,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  link_role TEXT NOT NULL CHECK (link_role IN ('primary','supporting')) DEFAULT 'primary',
  link_origin TEXT NOT NULL CHECK (link_origin IN ('manual','auto_confirmed','import')),
  confidence REAL,
  is_active INTEGER NOT NULL CHECK (is_active IN (0,1)) DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT,
  UNIQUE(bank_transaction_id, document_id)
);

CREATE INDEX IF NOT EXISTS idx_tdl_transaction ON transaction_document_links(bank_transaction_id, is_active);
CREATE INDEX IF NOT EXISTS idx_tdl_document ON transaction_document_links(document_id, is_active);

CREATE TABLE IF NOT EXISTS transaction_document_match_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_transaction_id INTEGER NOT NULL REFERENCES bank_transactions(id) ON DELETE CASCADE,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  matcher_name TEXT NOT NULL,
  matcher_version TEXT NOT NULL,
  score REAL NOT NULL,
  reason_codes_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','accepted','rejected','auto_applied','expired')) DEFAULT 'pending',
  created_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_tdms_tx_status ON transaction_document_match_suggestions(bank_transaction_id, status, score DESC);
CREATE INDEX IF NOT EXISTS idx_tdms_doc_status ON transaction_document_match_suggestions(document_id, status);

CREATE TABLE IF NOT EXISTS transaction_document_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_transaction_id INTEGER NOT NULL REFERENCES bank_transactions(id) ON DELETE CASCADE,
  old_status TEXT,
  new_status TEXT NOT NULL,
  reason TEXT,
  changed_by TEXT,
  changed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tdsh_transaction_changed ON transaction_document_status_history(bank_transaction_id, changed_at DESC);

UPDATE bank_transactions
SET document_status_updated_at = COALESCE(document_status_updated_at, datetime('now'))
WHERE document_status_updated_at IS NULL;
