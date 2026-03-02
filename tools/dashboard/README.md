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

Umgebungsvariablen für das Frontend:
- `VITE_API_BASE` (optional): Default `/api`
