# Dashboard Tool

Lokales Dashboard für Buchhaltungs- und Importdaten aus `datenbank.sqlite`.

## Stack
- Frontend: Vite + React + TypeScript + shadcn/ui + Recharts
- Backend: Express + better-sqlite3 + Zod

## Voraussetzungen
- Node.js 22+
- npm 11+

## Installation
```bash
cd tools/dashboard
npm install
```

## Entwicklung
```bash
npm run dev
```

- Frontend: `http://localhost:5173`
- API: `http://127.0.0.1:8787`

## Build
```bash
npm run build
```

## Konfiguration
Umgebungsvariablen für das Backend:
- `DASHBOARD_DB_PATH` (optional): Pfad zur SQLite-Datei. Default: Repo-Root `datenbank.sqlite`.
- `DASHBOARD_API_HOST` (optional): Default `127.0.0.1`
- `DASHBOARD_API_PORT` (optional): Default `8787`
- `DASHBOARD_ALLOWED_ORIGIN` (optional): Default `http://localhost:5173`
- `MOBILE_SCAN_API_TOKEN` (erforderlich für `/api/mobile-scans/*`)
- `OPENAI_API_KEY` (erforderlich für `/api/mobile-scans/analyze`)
- `AI_MODEL` (optional): Default `gpt-5.3-codex`
- `MOBILE_SCAN_MAX_UPLOAD_MB` (optional): Default `30`
- `MOBILE_SCAN_MIN_CONFIDENCE` (optional): Default `0.70`
- `MOBILE_SCAN_DUPLICATE_THRESHOLD` (optional): Default `0.86`

Umgebungsvariablen für das Frontend:
- `VITE_API_BASE` (optional): Default `/api`

## Mobile-Scan API

Neue Endpunkte für die React-Native Scan-App:

- `POST /api/mobile-scans/analyze`
  - Header: `X-Api-Token: <MOBILE_SCAN_API_TOKEN>`
  - `multipart/form-data` mit `pdfFile`, `previewImage`, optional `year`, `sessionId`, `clientScanId`, `deviceInfo`
  - Führt OCR+AI-Extraktion aus und liefert Analysevorschau + Duplikaterkennung

- `POST /api/mobile-scans/commit`
  - Header: `X-Api-Token: <MOBILE_SCAN_API_TOKEN>`
  - JSON: `{ analysisId, corrections? }`
  - Speichert den Beleg final in `documents` (oder dedupliziert auf vorhandenen Datensatz)

- `GET /api/mobile-scans/recent`
  - Header: `X-Api-Token: <MOBILE_SCAN_API_TOKEN>`
  - Query: `year?`, `limit?`
