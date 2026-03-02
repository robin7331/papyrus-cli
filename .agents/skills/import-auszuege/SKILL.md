---
name: import-auszuege
description: Verarbeite genau einen Girokonto-Kontoauszug (PDF) pro Lauf, extrahiere Buchungszeilen, erzeuge JSON im raw-booking-inserter-Format und importiere mit tools/raw-booking-inserter/main.py.
---

# Import eines Kontoauszugs (PDF -> JSON -> raw-booking-inserter import)

## Wann diese Skill genutzt wird

Nutze diese Skill, wenn ein einzelner Girokonto-Kontoauszug der BitMechanics GmbH verarbeitet werden soll.

Wichtige Rahmenbedingungen:
- Immer nur ein Auszug pro Lauf
- SKR03-Kontext
- Kein direkter SQL-Zugriff durch den Agenten (nur ueber das CLI-Tool)

## Eingabe

- `input_pdf`: Pfad zu genau einer Kontoauszug-PDF
  - Beispiel: `2023/Auszuege/Konto_0101173915-Auszug_2023_0131.pdf`

## Ausgabe-Datei

Leite den JSON-Pfad direkt aus dem PDF-Pfad ab:
- `.../Konto_0101173915-Auszug_2023_0131.pdf`
- `.../Konto_0101173915-Auszug_2023_0131.json`

Regeln:
- Dateiname identisch, nur Endung `.json` statt `.pdf`
- JSON im gleichen Ordner wie die PDF speichern

## Harte Regeln (immer einhalten)

1. Verarbeite nur einen Auszug pro Lauf. Wenn unklar ist, welche Datei gemeint ist, frage nach.
2. Lies und interpretiere die PDF mit dem `pdf`-Skill. Fuer die reine Text-Extraktion immer `swift` mit `PDFKit` verwenden (kein `pdftotext`, keine Python-PDF-Bibliotheken).
3. Erzeuge JSON exakt im Format von `tools/raw-booking-inserter/README.md`.
4. Fuehre danach immer den `import`-Befehl von `tools/raw-booking-inserter/main.py` mit der JSON-Datei aus, und zwar mit `uv run`.
5. Schreibe niemals direkt per SQL in die Datenbank.
6. Wenn die Verarbeitung erfolgreich ist, frage explizit, ob der nachste Auszug bearbeitet werden soll.
7. Bei Fehlern/Issues: strukturiert berichten und um Entscheidung/Korrektur bitten.

## JSON-Zielformat (verbindlich)

```json
{
  "statement_no": "131/2023",
  "rows": [
    {
      "datum": "02.10.2023",
      "typ": "Eröffnungssaldo",
      "buchungstext": "Kontostand am 02.10.2023, Auszug Nr. 130",
      "soll_eur": null,
      "haben_eur": null,
      "saldo_eur": "2.496,97"
    },
    {
      "datum": "04.10.2023",
      "typ": "Lastschrift",
      "buchungstext": "PayPal Europe S.a.r.l. et Cie S.C.A ... DigitalOcean",
      "soll_eur": "24,67",
      "haben_eur": null,
      "saldo_eur": "2.472,30"
    },
    {
      "datum": "04.10.2023",
      "typ": "Gutschrift/Überweisung",
      "buchungstext": "STRIPE SHOPIFY ...",
      "soll_eur": null,
      "haben_eur": "560,97",
      "saldo_eur": "2.864,33"
    },
    {
      "datum": "04.10.2023",
      "typ": "Schlusssaldo",
      "buchungstext": "Kontostand am 04.10.2023 um 20:04 Uhr",
      "soll_eur": null,
      "haben_eur": null,
      "saldo_eur": "2.864,33"
    }
  ]
}
```

## Feld- und Strukturregeln

- Zulassige `typ`-Werte:
  - `Eröffnungssaldo`
  - `Schlusssaldo`
  - `Lastschrift`
  - `Gutschrift/Überweisung`
- Genau 1 `Eröffnungssaldo`
- Genau 1 `Schlusssaldo`
- `Schlusssaldo` muss letzte Zeile sein
- Zwischen Eroffnungs- und Schlusssaldo muss mindestens eine Bewegungszeile stehen
- Betrage im deutschen Format (`1.234,56`)
- Fur `Lastschrift`: `soll_eur > 0`, `haben_eur = null`
- Fur `Gutschrift/Überweisung`: `haben_eur > 0`, `soll_eur = null`
- Fur Eroffnungs-/Schlusssaldo: `soll_eur = null` und `haben_eur = null`

## Ablauf (verbindliche Reihenfolge)

1. PDF lesen und alle Buchungszeilen inkl. Eroffnungs- und Schlusssaldo extrahieren.
   - Immer per `swift` + `PDFKit`:

```bash
swift - <<'SWIFT'
import Foundation
import PDFKit

let path = "/ABS/PFAD/ZUM/AUSZUG.pdf"
guard let doc = PDFDocument(url: URL(fileURLWithPath: path)) else {
    fputs("ERR: cannot open\n", stderr)
    exit(1)
}
for i in 0..<doc.pageCount {
    if let page = doc.page(at: i), let s = page.string {
        print("===== PAGE \(i+1) =====")
        print(s)
    }
}
SWIFT
```

2. JSON im geforderten Format erstellen.
3. JSON mit korrekter Namensregel im selben Ordner speichern.
4. Import ausfuehren (inkl. Validierung):

```bash
uv run tools/raw-booking-inserter/main.py import --bookings-file /ABS/PFAD/ZUR/DATEI.json --strict
```

Optional:
- Eigene DB-Datei: `--db /ABS/PFAD/zur/datenbank.sqlite`
- Spezifisches Konto: `--account-id 1`
- eine eigene DB-Datei nur explizit mitgeben, wenn der Nutzer das verlangt. Standardmäßig wird `./datenbank.sqlite` im Projekt verwendet.

Hinweis:
- Bei leerer/neuer DB bereitet das Tool das benoetigte Schema automatisch vor.

5. Tool-Resultat (JSON auf stdout) auswerten.

## Interpretation des Tool-Resultats

- Erfolg:
  - Exit Code `0`
  - `status == "ok"`
  - `error_count == 0`
- Validierungsfehler:
  - Exit Code `2`
  - `status == "error"` oder `error_count > 0`
- Technischer Fehler:
  - Exit Code `3`

Wichtige Erfolgsfelder bei `import`:
- `db_path`
- `account_id`
- `db_prepared`
- `source_file_id`
- `statement_doc_id`
- `inserted_raw`
- `inserted_tx`
- `duplicate_tx`
- `inserted_audit`

## Kommunikation mit dem Nutzer

### Wenn erfolgreich

Kurz ausgeben:
- JSON-Dateipfad
- `statement_no`
- `row_count`
- `movement_count`
- `inserted_tx`
- `duplicate_tx`
- `warning_count` (falls `> 0`, Warnungen auflisten)

Danach immer fragen:
- `Soll ich mit dem naechsten Kontoauszug weitermachen?`

### Wenn Fehler/Issues vorhanden

1. Alle `errors[]` und relevante `warnings[]` strukturiert auflisten.
2. Pro Fehler mindestens zeigen:
   - `code`
   - `message`
   - `row_index`/`field` (falls vorhanden)
   - `ask_user`
3. Nutzer gezielt um Entscheidung/Korrektur bitten, bevor fortgefahren wird.

## Verbotene Aktionen

- Kein direkter SQL-Zugriff durch den Agenten
- Keine parallele Verarbeitung mehrerer Auszuge
- Kein Uberspringen der Nutzer-Freigabe vor dem nachsten Auszug
