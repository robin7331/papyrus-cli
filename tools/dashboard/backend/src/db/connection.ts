import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

let dbInstance: Database.Database | null = null;

const DEFAULT_DB_PATH = path.resolve(
  fileURLToPath(new URL("../../../../../datenbank.sqlite", import.meta.url)),
);

export function getDbPath(): string {
  const configuredPath = process.env.DASHBOARD_DB_PATH ?? process.env.DB_PATH;
  return configuredPath ? path.resolve(configuredPath) : DEFAULT_DB_PATH;
}

export function getDb(): Database.Database {
  if (dbInstance) {
    return dbInstance;
  }

  const dbPath = getDbPath();
  if (!fs.existsSync(dbPath)) {
    throw new Error(`SQLite-Datei nicht gefunden: ${dbPath}`);
  }

  dbInstance = new Database(dbPath, {
    readonly: true,
    fileMustExist: true,
    timeout: 5_000,
  });

  dbInstance.pragma("query_only = ON");

  return dbInstance;
}
