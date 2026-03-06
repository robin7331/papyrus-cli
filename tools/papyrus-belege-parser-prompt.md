## Aufgabe
Du bekommst ein PDF-Belegdokument fuer die Buchhaltung der BitMechanics GmbH.
Das kann z. B. eine Rechnung, Gutschrift, Storno, ein Kassenbeleg oder ein amtliches Schreiben sein.

Ziel:
Extrahiere die relevanten Inhalte und gib genau ein JSON-Objekt im unten definierten Format aus.
Der Beleg kann mehrseitig sein; irrelevante Seiten ignorieren.

Wichtig:
- Betragsfelder als Integer in Cent ausgeben (nicht als EUR-String).
- Datum immer im Format `YYYY-MM-DD`.
- Ausgabe muss mit `tools/scanned-beleg-inserter/main.py` kompatibel sein.

## Demo JSON (import-kompatibel)
```json
{
  "source_pdf": "/Users/robin/Documents/Projects/buchhaltung/scanned_belege/2023-11-15_Adobe_Invoice_INV-DE-2023-11983.pdf",
  "year": 2023,
  "extracted": {
    "document_date": "2023-11-15",
    "issuer_name": "Adobe Systems Software Ireland Ltd.",
    "invoice_number": "INV-DE-2023-11983",
    "subject": "Adobe Creative Cloud Abo November 2023, Rechnung INV-DE-2023-11983",
    "summary_short": "Adobe Creative Cloud Monatsabo 11/2023",
    "document_type": "Rechnung",
    "gross_amount_cents": 7139,
    "net_amount_cents": 5999,
    "vat_amount_cents": 1140,
    "vat_rate_bps": 1900,
    "vat_treatment": "VAT_19",
    "country_code": "DE",
    "notes": [
      "Leistungsmonat: November 2023",
      "Zahlungsmethode laut Beleg: Firmenkreditkarte",
      "Kundennummer: BM-447102"
    ]
  }
}
```

## Feldbeschreibung (inkl. Beispiele)

### Top-Level
`source_pdf`
- Typ: `string` (Pflicht)
- Bedeutung: Absoluter Pfad zur Ursprungs-PDF-Datei.
- Beispiel: `"/Users/robin/Documents/Projects/buchhaltung/scanned_belege/beleg_2023_11_15.pdf"`

`year`
- Typ: `integer` (Pflicht)
- Bedeutung: Buchhaltungsjahr. Muss zwischen `2000` und `2100` liegen.
- Beispiel: `2023`

`extracted`
- Typ: `object` (Pflicht)
- Bedeutung: Alle extrahierten Belegdaten.
- Beispiel: `{ "document_date": "2023-11-15", "...": "..." }`

### extracted.*
`document_date`
- Typ: `string | null`
- Bedeutung: Beleg-/Rechnungsdatum im Format `YYYY-MM-DD`.
- Beispiel: `"2023-11-15"`

`issuer_name`
- Typ: `string | null`
- Bedeutung: Aussteller/Lieferant.
- Beispiel: `"Adobe Systems Software Ireland Ltd."`

`invoice_number`
- Typ: `string | null`
- Bedeutung: Eindeutige Referenz wie Rechnungsnummer/Belegnummer.
- Beispiel: `"INV-DE-2023-11983"`

`subject`
- Typ: `string | null`
- Bedeutung: Klarer, sprechender Betreff fuer die Buchhaltung.
- Beispiel: `"Adobe Creative Cloud Abo November 2023, Rechnung INV-DE-2023-11983"`

`summary_short`
- Typ: `string | null`
- Bedeutung: Kurzzusammenfassung in einem Satz.
- Beispiel: `"Adobe Creative Cloud Monatsabo 11/2023"`

`document_type`
- Typ: `string | null`
- Bedeutung: Dokumentart.
- Beispiel: `"Rechnung"` (weitere Beispiele: `"Gutschrift"`, `"Kassenbeleg"`, `"Bescheid"`)

`gross_amount_cents`
- Typ: `integer | null`
- Bedeutung: Bruttobetrag in Cent.
- Beispiel: `7139` (entspricht 71,39 EUR)

`net_amount_cents`
- Typ: `integer | null`
- Bedeutung: Nettobetrag in Cent.
- Beispiel: `5999`

`vat_amount_cents`
- Typ: `integer | null`
- Bedeutung: Umsatzsteuerbetrag in Cent.
- Beispiel: `1140`

`vat_rate_bps`
- Typ: `integer | null`
- Bedeutung: USt-Satz in Basispunkten (`1900` = 19,00%).
- Beispiel: `1900`

`vat_treatment`
- Typ: `string` (Pflicht fuer gute Qualitaet)
- Bedeutung: Steuerklassifikation.
- Erlaubte Werte: `VAT_19`, `VAT_0`, `VAT_OSS`, `VAT_EXPORT`, `VAT_REVERSE_CHARGE`, `VAT_UNKNOWN`
- Beispiel: `"VAT_19"`

`country_code`
- Typ: `string | null`
- Bedeutung: ISO-2 Laendercode des Ausstellers/Steuerlandes.
- Beispiel: `"DE"` (weitere Beispiele: `"NL"`, `"IE"`, `"US"`)

`notes`
- Typ: `string[]`
- Bedeutung: Zusatzhinweise, Unsicherheiten, Kontext. Alles was für die Spätere Volltextsuche verwendet werden könnte und oben nocht nicht eingetragen ist.
- Beispiel: `["Leistungsmonat: November 2023", "Kundennummer: BM-447102"]`

## Validierungsregeln (wichtig fuer direkten Import)
- Wenn moeglich immer `subject`, `gross_amount_cents` und konkretes `vat_treatment` setzen.
- Unbekanntes lieber als `null` ausgeben statt erfundene Werte.
- `country_code` nur als 2 Grossbuchstaben (`DE`, `NL`, ...).
- `vat_rate_bps` nur zwischen `0` und `10000`.
- `ocr_confidence` und `ai_confidence` nur zwischen `0` und `1`.
