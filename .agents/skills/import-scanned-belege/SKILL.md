---
name: import-scanned-belege
description: Verarbeite genau einen gescannten Beleg (PDF) aus dem Buffer /scanned_belege, extrahiere Rechnungsdaten inkl. USt-Klassifikation in JSON und importiere mit tools/scanned-beleg-inserter/main.py.
---

# Import eines gescannten Belegs (PDF -> Extraktion -> documents)

Nutze diesen Skill, wenn genau eine PDF-Datei aus `/scanned_belege` (Root-Buffer) importiert werden soll.

## Harte Regeln

1. Kein direkter SQL-Schreibzugriff durch den Agenten.
2. Genau ein Beleg (ggf. mit mehreren Seiten) pro Lauf.
3. PDF immer lesen und interpretieren (mit `pdf`-Skill).
4. Erst JSON erzeugen, dann Import ueber `tools/scanned-beleg-inserter/main.py`, und zwar mit `uv run`.
5. Fuer Batch-Verarbeitung das Loop-Script in `tools/` verwenden.
   - `tools/import-scanned-belege-inbox.sh`

## Voraussetzungen

- `uv run`
- Datei `tools/scanned-beleg-inserter/main.py`
- in dieser Umgebung: `tools/ocr-pdf-multipage.sh` + `tesseract`

## Befehl

```bash
uv run tools/scanned-beleg-inserter/main.py import --beleg-file /ABS/PFAD/scanned_belege/beleg123.scan.json --strict --relocate-raw-scan --source-buffer-root /ABS/PFAD/scanned_belege
```

## Eingabe

- `input_pdf`: Pfad zu genau einer PDF-Datei
  - Beispiel: `scanned_belege/Rechnung_2023-10-04_DigitalOcean.pdf`

## Ausgabe-Datei

Leite den JSON-Pfad direkt aus dem PDF-Pfad ab:

- `.../Rechnung_2023-10-04_DigitalOcean.pdf`
- `.../Rechnung_2023-10-04_DigitalOcean.scan.json`

Regeln:

- gleicher Ordner
- gleicher Dateiname + Suffix `.scan.json`

## Erwartete Ergebnisse

- Extraktion aus einer PDF:
  - `amount`: Brutto/Netto/MwSt in Cent
  - `ust`: `VAT_19`, `VAT_0`, `VAT_OSS`, `VAT_EXPORT`, `VAT_REVERSE_CHARGE`, `VAT_UNKNOWN`
  - `betreff`: z.B. Rechnungsnummer, kurze Beschreibung
  - `rechnungsdatum`: z.B. "31.12.2023"
  - `sonstige infos`: Dinge wie sonstige Order Numbers, References, ... in das `notes` field im json.
- JSON gespeichert als `*.scan.json`
- Import via `tools/scanned-beleg-inserter/main.py import`

## JSON-Zielformat (verbindlich)

```json
{
  "source_pdf": "/ABS/PFAD/zur/datei.pdf",
  "year": 2023,
  "extracted": {
    "document_date": "2023-10-04",
    "issuer_name": "Digital Ocean LLC",
    "invoice_number": "INV-1234",
    "subject": "Rechnung INV-1234 Hosting",
    "summary_short": "Cloud Hosting Oktober 2023",
    "document_type": "Rechnung",
    "gross_amount_cents": 2467,
    "net_amount_cents": 2073,
    "vat_amount_cents": 394,
    "vat_rate_bps": 1900,
    "vat_treatment": "VAT_19",
    "country_code": "DE",
    "ocr_confidence": 0.92,
    "ai_confidence": 0.88,
    "ocr_text": "optional",
    "notes": ["optional"]
  }
}
```

## Ablauf (verbindliche Reihenfolge)

1. PDF lesen und interpretieren.
   - Nutze den `pdf`-Skill.
   - Bei Scan-PDFs immer alle Seiten OCR'en (nicht nur Seite 1).
   - Bevorzugte Pipeline in diesem Repo: `tools/ocr-pdf-multipage.sh <pdf> <output.txt> eng 2.2`.
   - Vermeide unnoetige Tool-Probing-Runden (`pdfinfo`, `pdftotext`, `mutool`, `magick`, manuelle Einzelseiten-OCR), wenn die bevorzugte Pipeline verfuegbar ist.
2. JSON in obigem Format erzeugen und als `*.scan.json` speichern.
3. JSON validieren (optional, empfohlen):

```bash
uv run tools/scanned-beleg-inserter/main.py validate --beleg-file /ABS/PFAD/datei.scan.json --strict
```

4. Import ausfuehren:

```bash
UV_CACHE_DIR=/tmp/uv-cache uv run tools/scanned-beleg-inserter/main.py import --beleg-file /ABS/PFAD/datei.scan.json --strict --relocate-raw-scan --source-buffer-root /ABS/PFAD/scanned_belege
```

Optional:

- eigene DB: `--db /ABS/PFAD/zur/datenbank.sqlite`

## Buffer-Regel (verbindlich)

- `/scanned_belege` ist ein reiner Eingangsbuffer fuer unprozessierte Scans.
- Nach erfolgreichem Import muss die originale Rohdatei aus dem Buffer verschoben werden.
- Zielordner: `/<year>/belege/<YYYY-MM>/`
- Dateiname PDF: `raw_scan_{rechnungsdatum}_{rechnungsnummer}.pdf`
- Dateiname JSON: `raw_scan_{rechnungsdatum}_{rechnungsnummer}.scan.json` (im gleichen Ordner)
  - Fallback bei fehlendem Datum: `unknown_date`
  - Fallback bei fehlender Rechnungsnummer: `unknown_number`
  - Bei Namenskollision Suffix mit Hash-Praefix anhaengen.
- Zielzustand nach abgeschlossenem Batch: `/scanned_belege` ist leer (Fehlerfaelle werden separat verschoben).

## Kommunikation

- Nach erfolgreichem Lauf kurz zusammenfassen:
  - JSON-Dateipfad
  - `vat_treatment`
  - `gross_amount_cents`
  - Import-Status (`created`/`deduplicated`)
- Danach fragen, ob der naechste Beleg verarbeitet werden soll.
