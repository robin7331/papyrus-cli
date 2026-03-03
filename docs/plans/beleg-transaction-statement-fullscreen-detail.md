# Vollbild-Detailseiten mit Split-View (Beleg, Transaktion, Kontoauszug)

## Ziel
- `Belegdetails`, `Transaktionsdetails` und `Kontoauszug` sollen als Vollbildseiten im gleichen Layout der App funktionieren.
- Detailansicht zeigt Metadaten/Actions links und die zugehörige PDF im rechten Bereich (PDF-Split-View).
- Fokus der Umsetzung ist auf die vorhandene Dashboard-App (`tools/dashboard`).

## Status Quo (bestehende Implementierung)
- `Belege`-Seite nutzt `Sheet`-Drawer für Belegdetails.
- `Transaktionen`-Seite nutzt `Sheet`-Drawer für Transaktionsdetails.
- Kontoauszug hat aktuell keine eigene Seite; es gibt nur den Download-Endpunkt `/api/transactions/:id/statement-file` und den Link in der Transaktionsseite.

## Eingebundene Entscheidungen
- Kontoauszug wird als eigene Seite je `statement_doc_id` umgesetzt.
- Klick auf Zeilen navigiert im gleichen Tab zur Detailseite.
- PDF wird bevorzugt inline angezeigt.
- Bei Transaktionen wird rechts primär der verknüpfte Primär-Beleg angezeigt; fallback `erstes Beleg -> Kontoauszug`.

## Architektur und Routing
1. Neue Routen im Frontend:
   - `/belege/:documentId`
   - `/transactions/:transactionId`
   - `/kontoauszuege/:statementDocId`
2. Bestehende Listenrouten bleiben:
   - `/belege`
   - `/transactions`
3. Tabelle/Listenwechsel auf Detailseiten erfolgt per URL, nicht per `Sheet`-State.
4. Filters/Seitenwerte werden bei Rücksprung über Query-Parameter persistiert.

## Frontend-Dateien (zu ändern)
1. `tools/dashboard/frontend/src/App.tsx`
   - Neue Detailrouten definieren und bestehende `Sheet`-abhängige Navigation aufräumen.
2. `tools/dashboard/frontend/src/pages/belege-page.tsx`
   - Zeilenklick auf ` /belege/:documentId` umstellen.
   - `Sheet`-State entfernen.
   - Optional: bestehende Filter in URL-Parameter spiegeln.
3. `tools/dashboard/frontend/src/pages/transactions-page.tsx`
   - Zeilenklick auf ` /transactions/:transactionId` umstellen.
   - `Sheet`-State entfernen.
4. Neue Seite `tools/dashboard/frontend/src/pages/beleg-detail-page.tsx`
   - Vollbild-Layout mit linker Detailspalte + rechter PDF-Preview-Spalte.
   - Bestehende Detaillogik aus `BelegePage` (`/documents/:id`, linked-transactions, rescan, match suggestions) übernehmen.
5. Neue Seite `tools/dashboard/frontend/src/pages/transaction-detail-page.tsx`
   - Vollbild-Layout mit linker Detailspalte + rechter PDF-Preview-Spalte.
   - Belege-Links (`/belege/:id`) und Kontoauszug-Link (`/kontoauszuege/:id`) anbieten.
   - Standardvorschau-Quelle: Primary-Linked-Beleg > erstes verknüpftes Dokument > Kontoauszug.
6. Neue Seite `tools/dashboard/frontend/src/pages/statement-detail-page.tsx`
   - Metadaten/Transaktionen links, PDF rechts.
   - Verlinkung aller enthaltenen Transaktionen nach `/transactions/:id`.
7. Neue Komponente `tools/dashboard/frontend/src/components/document-preview-pane.tsx`
   - Gemeinsame Vorschau-Logik für Dokumente/Bilder/PDF.
   - Props: `title`, `url`, `mimeType`, `fileName`, optional `fallbackText`.
   - Verhalten:
     - `application/pdf` oder `mime` endet mit `.pdf`: `iframe`/`object`
     - Bild-MIME (`image/*`): `<img>`
     - Sonst: Download/Öffnen-Link.
8. Optionaler UI-Eintrag `docs`-Navigation nicht ändern, da bestehendes Muster beibehalten wird.

## Backend-Dateien (zu ändern)
1. `tools/dashboard/backend/src/routes/api.ts`
   - Bestehendes `GET /documents/:id/file` bleibt als Dokumentdownload für Detailseiten bestehen.
   - `GET /documents/:id/linked-transactions` um Zusatzfeld erweitern:
     - `statement_doc_id` (für schnelle Kontoauszug-Navigation).
   - Neues Endpunktpaar für Auszugdetails:
     - `GET /statement-docs/:id`
     - `GET /statement-docs/:id/file`
   - Die Auszugdetail-Route liefert: `statement`-Metadata, evtl. `statement_file_url`, Transaktionsliste.
2. Zusätzliche DB-Querys:
   - statement_docs + source_files + bank_transactions Joins für detailreichen Kontext.

## Frontend-Typen (zu ändern)
1. `tools/dashboard/frontend/src/lib/types.ts`
   - `DocumentLinkedTransaction` um `statement_doc_id?: number | null` erweitern.
   - Neue Typen ergänzen:
     - `StatementDetailResponse`
     - `StatementDetailTransactionRow`
   - Optional: bestehende `TransactionDetail`-Namen ergänzen, falls nötig.

## Routing/Navigation-Details
1. Zeile Klick in `Belege`:
   - Von Liste zu `/belege/:documentId`.
2. Zeile Klick in `Transaktionen`:
   - Von Liste zu `/transactions/:transactionId`.
3. Kontoauszug-Links in beiden Detailseiten:
   - `Kontoauszug öffnen` → `/kontoauszuege/:statementDocId`.
4. Zurück-Navigation:
   - Zurück in Browser-History auf die Liste inkl. Filterzustand.

## Layout- & Responsive-Umsetzung
1. Detailseiten-Container mit `grid` und Breakpoint (`md`/`lg`) als 2-Spalten (z. B. `1fr 1fr` oder `2fr 3fr`).
2. Links vertikale Scroll-Region für Aktionen und Detailkarten.
3. Rechts „vollflächiger“ Vorschaubereich mit eigener Scroll/`min-height`.
4. Mobile fallback auf einspaltige, gestapelte Darstellung.

## Risikoanalyse
- Bestehende Drawer-Interaktion wird ersetzt; bei vielen Aktionen/Mutationen auf Detailseiten muss auf State-Reset achten.
- Der bestehende Backend-Query `resolveStatementFilePath` für Auszug-Dateipfade muss in der neuen Auszug-Route korrekt wiederverwendet werden.
- Falls manche Dokumente kein PDF sind, wird auf `img` oder Fallback gesetzt.

## Offenhalten als nächste Schritt
1. Soll die Transaktionsseite Links zur Vorschau direkt zwischen mehreren verknüpften Belegen ermöglichen?
2. Wollen wir die bestehende Filter-Persistierung per Query sofort oder minimal als Schritt 1 aufbauen?

## Akzeptanzkriterien
1. Tabellenklick öffnet Detailseiten statt Drawers.
2. Alle drei Detailseiten sind full-page und zeigen links Daten, rechts Dokumentvorschau.
3. Kontoauszug hat eigenständige detailorientierte Seite.
4. Vorschau funktioniert für PDF und Bilder; nicht unterstützte Typen liefern klaren Fallback.
5. Bestehende Kernaktionen bleiben nutzbar (Rescan, Match, Status, Upload, MwSt-Verarbeitung).
6. Navigation ist im gleichen Tab und kompatibel mit Browser Back.
