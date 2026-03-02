# Plan: Datenbank + Import-Tool für Kontoauszüge 2023

## 1. Ziel und Scope

Ziel ist ein belastbarer Erstimport aller Kontoauszüge 2023 in `datenbank.sqlite`, sodass:

1. Kontobewegungen vollständig und abfragbar vorliegen.
2. Monats-Saldenabgleiche möglich sind.
3. Die Struktur später ohne Bruch für Belege, SKR03-Kontierung, USt-Logik und BWA erweitert werden kann.

Nicht-Ziel im MVP:

1. Vollautomatische finale Kontierung aller Buchungen.
2. Vollständige Belegzuordnung bei Importstart.

## 2. Grundprinzipien

1. Auditierbarkeit/GoBD: Rohdaten und Ableitungen sind nachvollziehbar gespeichert.
2. Idempotenz: Re-Import derselben PDF erzeugt keine Duplikate.
3. Trennung der Ebenen:
   - `raw` (Extraktion),
   - `normalized` (saubere Banktransaktionen),
   - `accounting` (spätere Kontierung/BWA).
4. Geld als Integer-Cent (`INTEGER`), nie `REAL`.
5. Unsichere Parser-Treffer werden markiert statt verworfen.

## 3. Ziel-Datenmodell (SQLite)

## 3.1 Stammdaten und Importverwaltung

### `bank_accounts`
- Zweck: Zahlungsquellen (Giro, später PayPal)
- Felder:
  - `id` (PK)
  - `name`
  - `iban`
  - `bic`
  - `account_type` (`giro`, `paypal`, ...)
  - `currency` (z. B. `EUR`)

### `import_runs`
- Zweck: Technische Nachvollziehbarkeit einzelner Läufe
- Felder:
  - `id` (PK)
  - `started_at`
  - `finished_at`
  - `parser_version`
  - `status` (`running`, `success`, `error`)
  - `notes`

### `source_files`
- Zweck: Jede importierte PDF-Datei eindeutig erfassen
- Felder:
  - `id` (PK)
  - `account_id` (FK -> `bank_accounts.id`)
  - `year`
  - `file_path`
  - `file_sha256`
  - `file_size`
  - `mtime`
  - `imported_at`
  - `import_run_id` (FK -> `import_runs.id`)
- Constraints:
  - `UNIQUE(account_id, file_sha256)`

## 3.2 Kontoauszug und Rohdaten

### `statement_docs`
- Zweck: Fachliche Klammer je Kontoauszug
- Felder:
  - `id` (PK)
  - `source_file_id` (FK -> `source_files.id`)
  - `statement_no`
  - `period_from`
  - `period_to`
  - `opening_balance_cents`
  - `closing_balance_cents`
  - `currency`

### `statement_raw_markdown`
- Zweck: Unveränderter Output von MarkItDown
- Felder:
  - `id` (PK)
  - `statement_doc_id` (FK -> `statement_docs.id`)
  - `markdown_text`

### `bank_transactions_raw`
- Zweck: Parser-Zwischenstufe pro erkanntem Roh-Buchungsblock
- Felder:
  - `id` (PK)
  - `statement_doc_id` (FK -> `statement_docs.id`)
  - `page_no`
  - `line_start`
  - `line_end`
  - `raw_block_text`
  - `parse_confidence`
  - `parser_rule`
  - `parse_status` (`parsed`, `needs_review`, `error`)

## 3.3 Normalisierte Bewegungen

### `bank_transactions`
- Zweck: Abfragefähige, deduplizierte Kontobewegungen
- Felder:
  - `id` (PK)
  - `account_id` (FK -> `bank_accounts.id`)
  - `statement_doc_id` (FK -> `statement_docs.id`)
  - `booking_date`
  - `valuta_date`
  - `amount_cents`
  - `currency`
  - `running_balance_cents`
  - `purpose`
  - `counterparty_name`
  - `counterparty_iban`
  - `counterparty_bic`
  - `reference`
  - `tx_type`
  - `fingerprint`
  - `is_reversal` (0/1)
- Constraints:
  - `UNIQUE(account_id, fingerprint)`

### `reconciliation_monthly`
- Zweck: Pflicht-Saldenabgleich je Monat und Konto
- Felder:
  - `id` (PK)
  - `account_id` (FK -> `bank_accounts.id`)
  - `year_month` (`YYYY-MM`)
  - `opening_balance_cents`
  - `movement_cents`
  - `closing_balance_cents`
  - `statement_closing_balance_cents`
  - `delta_cents`
  - `status` (`ok`, `mismatch`)

## 3.4 Erweiterungsschicht für Buchhaltung (Phase 2)

### `gl_accounts`
- Zweck: SKR03-Kontenstamm
- Felder:
  - `account_no` (PK)
  - `name`
  - `category`
  - `tax_relevant` (0/1)

### `booking_rules`
- Zweck: Vorschlagsregeln zur Vorkontierung
- Felder:
  - `id` (PK)
  - `priority`
  - `pattern_field` (z. B. `purpose`)
  - `pattern_regex`
  - `target_account_no` (FK -> `gl_accounts.account_no`)
  - `tax_code`
  - `active` (0/1)

### `journal_entries` + `journal_lines`
- Zweck: Doppelte Buchführung auf Basis der Banktransaktionen
- Verknüpfung: Jede Journal-Buchung referenziert Ursprungstransaktionen, damit Herkunft belegbar bleibt.

## 4. Tool-Architektur (`tools/pdf-data-extractor`)

## 4.1 CLI-Kommandos (MVP)

1. `init-db`  
   - Erstellt Tabellen/Indizes.
2. `scan --year 2023 --account giro --input ../../2023/auszuege`  
   - Liest Dateimetadaten und Hashes in `source_files`.
3. `extract --year 2023 --account giro`  
   - Führt MarkItDown je PDF aus, schreibt `statement_raw_markdown`.
4. `parse --year 2023 --account giro`  
   - Zerlegt Rohtext in Buchungsblöcke (`bank_transactions_raw`) und normalisiert nach `bank_transactions`.
5. `reconcile --year 2023 --account giro`  
   - Erstellt monatliche Abgleichswerte in `reconciliation_monthly`.
6. `stats --year 2023 --account giro`  
   - Zeigt Import- und Qualitätsmetriken (Anzahl, `needs_review`, Abweichungen).

## 4.2 Modulaufteilung

1. `main.py`  
   - CLI-Entrypoint.
2. `db.py`  
   - Schemaerzeugung, Verbindungs-/Transaktionslogik.
3. `ingest.py`  
   - Dateiscans, Hashberechnung, Upserts.
4. `extract_markitdown.py`  
   - PDF -> Markdown via `markitdown`.
5. `parser_giro_2023.py`  
   - Formatregeln für die 2023 Giro-Auszüge.
6. `normalize.py`  
   - Datums-/Betragsnormalisierung, Fingerprintbildung.
7. `reconcile.py`  
   - Monatsabgleich.
8. `reports.py`  
   - Qualitäts- und Fortschrittsausgaben.

## 5. Parsing-Strategie mit MarkItDown

1. PDF mit MarkItDown in Markdown/Text konvertieren.
2. Kopfbereich extrahieren:
   - Auszugsnummer, Zeitraum, Anfangs-/Endsaldo.
3. Buchungszeilen erkennen:
   - Datum/Valuta/Betrag/Saldo/Verwendungszweck (inkl. mehrzeilig).
4. Rohblock immer speichern (`bank_transactions_raw`).
5. Bei erfolgreichem Parse:
   - in `bank_transactions` upserten.
6. Bei Unsicherheit:
   - `parse_status='needs_review'` setzen.

## 6. Deduplizierung und Idempotenz

1. Datei-Ebene: `UNIQUE(account_id, file_sha256)`.
2. Transaktions-Ebene: deterministischer `fingerprint`, z. B. aus:
   - `booking_date`,
   - `valuta_date`,
   - `amount_cents`,
   - `running_balance_cents`,
   - normalisiertem `purpose`.
3. Re-Run darf nur aktualisieren, nicht verdoppeln.

## 7. Qualitätssicherung

1. Parser-Quote:
   - Anteil `parsed` vs. `needs_review`.
2. Fachlicher Check:
   - Monatssaldo `delta_cents = 0`.
3. Technischer Check:
   - Anzahl importierter PDFs = Anzahl erkannter Dateien.
4. Stichproben:
   - mehrere zufällige PDFs gegen Datenbankeinträge vergleichen.

## 8. Umsetzungsplan (MVP)

1. Schema in SQLite implementieren (`init-db`).
2. Dateiscanner und Hashing (`scan`) implementieren.
3. MarkItDown-Anbindung (`extract`) implementieren.
4. Parser für Giro 2023 (`parse`) implementieren.
5. Reconciliation (`reconcile`) implementieren.
6. Grundlegende Reports (`stats`) ergänzen.
7. Erstimport aller `2023/auszuege` durchführen.
8. Parser-Fehlerliste erzeugen und gezielt Regeln nachschärfen.

## 9. Definition of Done (Phase 1)

1. Alle 2023 Giro-PDFs sind erfasst und verarbeitet.
2. Jede Transaktion ist auf Ursprungsdatei rückverfolgbar.
3. Keine doppelten Dateien/Transaktionen bei Re-Import.
4. Monatsabgleich ist je Monat erstellt; Abweichungen sind transparent.
5. Datenbasis ist bereit für Phase 2:
   - Belegmapping,
   - SKR03-Kontierung,
   - BWA/Reporting.
