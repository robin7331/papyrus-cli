PRAGMA foreign_keys = ON;

ALTER TABLE transaction_tax_determinations
  ADD COLUMN calculation_mode TEXT NOT NULL DEFAULT 'auto'
  CHECK (calculation_mode IN ('auto', 'manual'));
