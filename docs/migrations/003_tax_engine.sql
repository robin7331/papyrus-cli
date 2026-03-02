PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tax_codes (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  scope TEXT NOT NULL,
  rate_bps INTEGER NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('output', 'input', 'both')),
  elster_key TEXT,
  oss_flag INTEGER NOT NULL DEFAULT 0 CHECK (oss_flag IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);

CREATE TABLE IF NOT EXISTS transaction_tax_determinations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_transaction_id INTEGER NOT NULL UNIQUE REFERENCES bank_transactions(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('draft','final','review_required')),
  tax_code TEXT REFERENCES tax_codes(code),
  tax_rate_bps INTEGER,
  is_gross_amount INTEGER NOT NULL DEFAULT 1 CHECK (is_gross_amount IN (0,1)),
  net_amount_cents INTEGER,
  tax_amount_cents INTEGER,
  country_code TEXT,
  counterparty_vat_id TEXT,
  evidence_level TEXT NOT NULL DEFAULT 'low' CHECK (evidence_level IN ('low','medium','high')),
  confidence REAL NOT NULL DEFAULT 0,
  reason_codes_json TEXT NOT NULL DEFAULT '[]',
  source_snapshot_json TEXT NOT NULL DEFAULT '{}',
  decided_at TEXT,
  decided_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ttd_status ON transaction_tax_determinations(status, confidence DESC);
CREATE INDEX IF NOT EXISTS idx_ttd_tax_code ON transaction_tax_determinations(tax_code);

CREATE TABLE IF NOT EXISTS transaction_tax_evidence_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  determination_id INTEGER NOT NULL REFERENCES transaction_tax_determinations(id) ON DELETE CASCADE,
  document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  evidence_ref TEXT,
  evidence_type TEXT NOT NULL CHECK (evidence_type IN ('invoice','shipping','platform_report','vat_id_check','other')),
  is_required INTEGER NOT NULL CHECK (is_required IN (0,1)),
  is_present INTEGER NOT NULL CHECK (is_present IN (0,1)),
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ttel_determination ON transaction_tax_evidence_links(determination_id);

CREATE TABLE IF NOT EXISTS vat_ledger_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period TEXT NOT NULL,
  bank_transaction_id INTEGER NOT NULL REFERENCES bank_transactions(id) ON DELETE CASCADE,
  determination_id INTEGER NOT NULL REFERENCES transaction_tax_determinations(id) ON DELETE CASCADE,
  line_type TEXT NOT NULL CHECK (line_type IN ('output_tax','input_tax','reverse_charge_output','reverse_charge_input','oss_output','non_taxable')),
  base_cents INTEGER NOT NULL,
  tax_cents INTEGER NOT NULL,
  tax_code TEXT REFERENCES tax_codes(code),
  elster_key TEXT,
  oss_country_code TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(bank_transaction_id, determination_id, line_type)
);

CREATE INDEX IF NOT EXISTS idx_vll_period ON vat_ledger_lines(period, line_type);
CREATE INDEX IF NOT EXISTS idx_vll_tax_code ON vat_ledger_lines(tax_code, period);

CREATE TABLE IF NOT EXISTS vat_period_reports (
  period TEXT PRIMARY KEY,
  output_tax_cents INTEGER NOT NULL,
  input_tax_cents INTEGER NOT NULL,
  net_liability_cents INTEGER NOT NULL,
  uncertain_case_count INTEGER NOT NULL,
  uncertain_tax_cents INTEGER NOT NULL,
  generated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO tax_codes(code, name, scope, rate_bps, direction, elster_key, oss_flag) VALUES
  ('DE_OUTPUT_19', 'Inland Umsatzsteuer 19%', 'DE_IN', 1900, 'output', '81', 0),
  ('DE_OUTPUT_7', 'Inland Umsatzsteuer 7%', 'DE_IN', 700, 'output', '86', 0),
  ('DE_INPUT_19', 'Vorsteuer 19%', 'DE_IN', 1900, 'input', '66', 0),
  ('DE_INPUT_7', 'Vorsteuer 7%', 'DE_IN', 700, 'input', '61', 0),
  ('EU_B2B_RC_OUT', 'EU B2B Reverse Charge Ausgang', 'EU_B2B', 0, 'output', '21', 0),
  ('EU_B2B_RC_IN', 'EU B2B Reverse Charge Eingang', 'EU_B2B', 0, 'both', '46', 0),
  ('EU_B2C_OSS_STD', 'EU B2C OSS Standardsatz', 'EU_B2C_OSS', 0, 'output', NULL, 1),
  ('THIRD_COUNTRY_EXPORT_0', 'Drittlandexport steuerfrei', 'THIRD_COUNTRY', 0, 'output', '45', 0),
  ('NON_TAXABLE', 'Nicht steuerbarer Vorgang', 'NONE', 0, 'both', NULL, 0);
