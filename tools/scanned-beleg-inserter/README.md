# scanned-beleg-inserter

Validiert und importiert einen gescannten Beleg aus einer JSON-Datei in `documents`.

## Befehle

```bash
python3 tools/scanned-beleg-inserter/main.py validate --beleg-file /abs/path/beleg.scan.json --strict
```

```bash
python3 tools/scanned-beleg-inserter/main.py import --beleg-file /abs/path/beleg.scan.json --strict
```

Optional:

- `--db /abs/path/datenbank.sqlite`

## Eingabeformat (JSON)

```json
{
  "source_pdf": "/abs/path/2023/scanned_belege/rechnung_001.pdf",
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
    "ocr_text": "optional full text",
    "notes": ["optional", "array of notes"]
  }
}
```

`vat_treatment` erlaubt:

- `VAT_19`
- `VAT_0`
- `VAT_OSS`
- `VAT_EXPORT`
- `VAT_REVERSE_CHARGE`
- `VAT_UNKNOWN`

## Exit-Codes

- `0` ok
- `2` validierungsfehler
- `3` technischer fehler
