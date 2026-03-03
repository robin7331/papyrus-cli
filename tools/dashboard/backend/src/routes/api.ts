import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { getDb, getDbPath } from "../db/connection.js";
import {
  ValidationError,
  escapeLike,
  isoDateSchema,
  validateQuery,
  withValidDateRange,
} from "../lib/validation.js";

const router = Router();

const dateRangeBaseSchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});

const dateRangeSchema = withValidDateRange(dateRangeBaseSchema);

const topCounterpartiesQuerySchema = withValidDateRange(
  dateRangeBaseSchema.extend({
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  }),
);

const transactionsQuerySchema = withValidDateRange(
  dateRangeBaseSchema.extend({
    q: z.string().trim().max(160).optional(),
    txType: z.string().trim().max(120).optional(),
    documentStatus: z.enum(["offen", "zugeordnet", "nicht_erforderlich", "in_klaerung"]).optional(),
    minCents: z.coerce.number().int().optional(),
    maxCents: z.coerce.number().int().optional(),
    page: z.coerce.number().int().min(1).optional().default(1),
    pageSize: z.coerce.number().int().min(1).max(200).optional().default(50),
  }),
);

const documentsQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  sourceType: z.enum(["email", "scan", "portal", "manuell", "sonstiges"]).optional(),
  lifecycleStatus: z.enum(["inbox", "archiviert", "verworfen"]).optional(),
  q: z.string().trim().max(160).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).optional().default(50),
});

const uploadSourceTypeSchema = z.enum(["email", "scan", "portal", "manuell", "sonstiges"]);

const documentLinkCreateSchema = z.object({
  documentId: z.coerce.number().int().positive(),
  linkRole: z.enum(["primary", "supporting"]).optional().default("primary"),
});

const documentStatusPatchSchema = z.object({
  status: z.enum(["offen", "zugeordnet", "nicht_erforderlich", "in_klaerung"]),
  reason: z.string().trim().max(240).optional(),
});

const missingInvoicePatchSchema = z.object({
  missingInvoiceFlag: z.boolean(),
});

const matchSuggestionsRefreshSchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).optional().default(8),
});

const matchSelectionSchema = z.object({
  primaryDocumentId: z.coerce.number().int().positive(),
  supportingDocumentIds: z.array(z.coerce.number().int().positive()).max(20).optional().default([]),
});

const nextOpenQuerySchema = withValidDateRange(
  dateRangeBaseSchema.extend({
    q: z.string().trim().max(160).optional(),
    txType: z.string().trim().max(120).optional(),
    minCents: z.coerce.number().int().optional(),
    maxCents: z.coerce.number().int().optional(),
  }),
);

const projectRoot = path.resolve(fileURLToPath(new URL("../../../../../", import.meta.url)));
const documentsRoot = path.join(projectRoot, "belege");
const maxUploadBytes = Number(process.env.DASHBOARD_MAX_UPLOAD_BYTES ?? 25 * 1024 * 1024);

const allowedExtensions = new Set([".pdf", ".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"]);
const allowedMimeTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/tiff",
]);
const preferredExtensionByMime: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/tiff": ".tiff",
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxUploadBytes,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const extensionAllowed = allowedExtensions.has(extension);
    const mimeAllowed = allowedMimeTypes.has(file.mimetype);
    if (!extensionAllowed && !mimeAllowed) {
      cb(new ValidationError("Dateityp nicht erlaubt. Erlaubt sind PDF und gängige Bildformate."));
      return;
    }
    cb(null, true);
  },
});

function nowIso(): string {
  return new Date().toISOString();
}

function sanitizeFilename(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_\.]+|[_\.]+$/g, "")
    .slice(0, 120);
}

function ensureDocumentRootExists() {
  if (!fs.existsSync(documentsRoot)) {
    fs.mkdirSync(documentsRoot, { recursive: true });
  }
}

function txIdFromParams(value: string): number {
  const txId = Number(value);
  if (!Number.isInteger(txId) || txId <= 0) {
    throw new ValidationError("Ungültige Transaktions-ID");
  }
  return txId;
}

function parseStatementNo(valueRaw: string | null): { statementNo: number | null; year: number | null } {
  if (!valueRaw) {
    return { statementNo: null, year: null };
  }
  const value = valueRaw.trim();
  if (!value) {
    return { statementNo: null, year: null };
  }
  const slashMatch = value.match(/^(\d{1,6})\s*\/\s*(\d{4})$/);
  if (slashMatch) {
    return {
      statementNo: Number.parseInt(slashMatch[1], 10),
      year: Number.parseInt(slashMatch[2], 10),
    };
  }
  const numberMatch = value.match(/(\d{1,6})/);
  if (!numberMatch) {
    return { statementNo: null, year: null };
  }
  return {
    statementNo: Number.parseInt(numberMatch[1], 10),
    year: null,
  };
}

function resolveAccountTokenFromIban(ibanRaw: string | null): string | null {
  if (!ibanRaw) {
    return null;
  }
  const digits = ibanRaw.replace(/\D/g, "");
  if (digits.length < 10) {
    return null;
  }
  return digits.slice(-10);
}

function resolveStatementFilePath(input: {
  filePathRaw: string | null;
  statementNoRaw?: string | null;
  sourceFileYear?: number | null;
  bookingDate?: string | null;
  accountIban?: string | null;
}): string | null {
  const filePathRaw = input.filePathRaw;
  if (!filePathRaw) {
    return null;
  }

  const value = filePathRaw.trim();
  if (!value) {
    return null;
  }

  if (!value.startsWith("raw-booking-inserter://")) {
    if (value.startsWith("file://")) {
      try {
        const url = new URL(value);
        const resolved = url.protocol === "file:" ? decodeURIComponent(url.pathname) : "";
        if (resolved && fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
          return resolved;
        }
        return null;
      } catch {
        return null;
      }
    }

    const absolutePath = path.isAbsolute(value) ? path.resolve(value) : path.resolve(projectRoot, value);
    if (!fs.existsSync(absolutePath)) {
      return null;
    }
    try {
      if (!fs.statSync(absolutePath).isFile()) {
        return null;
      }
    } catch {
      return null;
    }

    return absolutePath;
  }

  const statementInfo = parseStatementNo(input.statementNoRaw ?? value.slice("raw-booking-inserter://".length));
  if (!statementInfo.statementNo || statementInfo.statementNo <= 0) {
    return null;
  }

  const inferredYear =
    (typeof input.sourceFileYear === "number" ? input.sourceFileYear : null) ??
    statementInfo.year ??
    (input.bookingDate && /^\d{4}-\d{2}-\d{2}$/.test(input.bookingDate) ? Number.parseInt(input.bookingDate.slice(0, 4), 10) : null);
  if (!inferredYear || inferredYear < 2000 || inferredYear > 2100) {
    return null;
  }

  const statementSuffix = String(statementInfo.statementNo).padStart(4, "0");
  const accountToken = resolveAccountTokenFromIban(input.accountIban ?? null);
  const baseDirs = [path.join(projectRoot, String(inferredYear), "Auszuege"), path.join(projectRoot, String(inferredYear), "auszuege")];

  const matches: string[] = [];
  for (const dir of baseDirs) {
    if (!fs.existsSync(dir)) {
      continue;
    }
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.toLowerCase().endsWith(".pdf")) {
        continue;
      }
      if (!new RegExp(`[-_]Auszug_${inferredYear}_${statementSuffix}\\.pdf$`, "i").test(entry)) {
        continue;
      }
      const entryPath = path.join(dir, entry);
      if (!fs.existsSync(entryPath)) {
        continue;
      }
      matches.push(entryPath);
    }
  }

  if (matches.length === 0) {
    return null;
  }

  if (accountToken) {
    const tokenMatch = matches.filter((item) =>
      new RegExp(`Konto_${accountToken}-`, "i").test(path.basename(item)),
    );
    if (tokenMatch.length > 0) {
      tokenMatch.sort();
      return tokenMatch[0];
    }
  }

  matches.sort();
  return matches[0];
}

function buildTransactionsWhere(
  filters: {
    from?: string;
    to?: string;
    q?: string;
    txType?: string;
    documentStatus?: "offen" | "zugeordnet" | "nicht_erforderlich" | "in_klaerung";
    minCents?: number;
    maxCents?: number;
  },
  tableAlias?: string,
): { whereSql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const col = (name: string) => (tableAlias ? `${tableAlias}.${name}` : name);

  if (filters.from) {
    clauses.push(`${col("booking_date")} >= ?`);
    params.push(filters.from);
  }

  if (filters.to) {
    clauses.push(`${col("booking_date")} <= ?`);
    params.push(filters.to);
  }

  if (filters.txType) {
    clauses.push(`COALESCE(NULLIF(TRIM(${col("tx_type")}), ''), 'Unbekannt') = ?`);
    params.push(filters.txType);
  }

  if (filters.documentStatus) {
    clauses.push(`${col("document_status")} = ?`);
    params.push(filters.documentStatus);
  }

  if (typeof filters.minCents === "number") {
    clauses.push(`${col("amount_cents")} >= ?`);
    params.push(filters.minCents);
  }

  if (typeof filters.maxCents === "number") {
    clauses.push(`${col("amount_cents")} <= ?`);
    params.push(filters.maxCents);
  }

  if (filters.q) {
    const pattern = `%${escapeLike(filters.q)}%`;
    clauses.push(
      `(${col("purpose")} LIKE ? ESCAPE '\\\\' OR ${col("counterparty_name")} LIKE ? ESCAPE '\\\\' OR ${col("reference")} LIKE ? ESCAPE '\\\\')`,
    );
    params.push(pattern, pattern, pattern);
  }

  return {
    whereSql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

function buildDocumentsWhere(
  filters: {
    year?: number;
    sourceType?: string;
    lifecycleStatus?: string;
    q?: string;
  },
  availableColumns: Set<string>,
  tableAlias?: string,
): { whereSql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const col = (name: string) => (tableAlias ? `${tableAlias}.${name}` : name);

  if (typeof filters.year === "number") {
    clauses.push(`${col("year")} = ?`);
    params.push(filters.year);
  }

  if (filters.sourceType) {
    clauses.push(`${col("source_type")} = ?`);
    params.push(filters.sourceType);
  }

  if (filters.lifecycleStatus) {
    clauses.push(`${col("lifecycle_status")} = ?`);
    params.push(filters.lifecycleStatus);
  }

  if (filters.q) {
    const searchableTextColumns = [
      "original_filename",
      "issuer_name",
      "invoice_number",
      "storage_rel_path",
      "mime_type",
      "source_type",
      "document_date",
      "subject",
      "summary_short",
      "ocr_text",
      "metadata_json",
    ].filter((name) => availableColumns.has(name));

    const searchableNumericColumns = [
      "gross_amount_cents",
      "net_amount_cents",
      "vat_amount_cents",
      "vat_rate_bps",
      "file_size_bytes",
      "id",
      "year",
    ].filter((name) => availableColumns.has(name));

    const terms = filters.q
      .split(/\s+/)
      .map((term) => term.trim())
      .filter((term) => term.length > 0)
      .slice(0, 10);

    for (const term of terms) {
      const pattern = `%${escapeLike(term)}%`;
      const termClauses: string[] = [];

      for (const textCol of searchableTextColumns) {
        termClauses.push(`${col(textCol)} LIKE ? ESCAPE '\\\\'`);
        params.push(pattern);
      }

      for (const numericCol of searchableNumericColumns) {
        termClauses.push(`CAST(${col(numericCol)} AS TEXT) LIKE ? ESCAPE '\\\\'`);
        params.push(pattern);
      }

      if (termClauses.length > 0) {
        clauses.push(`(${termClauses.join(" OR ")})`);
      }
    }
  }

  return {
    whereSql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

function getDocumentsColumnSet(): Set<string> {
  const db = getDb();
  const rows = db.prepare("PRAGMA table_info(documents)").all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

type MatchInputTransaction = {
  id: number;
  booking_date: string;
  amount_cents: number;
  purpose: string | null;
  counterparty_name: string | null;
  reference: string | null;
};

type MatchInputDocument = {
  id: number;
  source_type: string;
  storage_rel_path: string;
  original_filename: string | null;
  document_date: string | null;
  issuer_name: string | null;
  invoice_number: string | null;
  gross_amount_cents: number | null;
  currency: string;
  review_required: number;
  ai_confidence: number | null;
};

type MatchSuggestionDraft = {
  documentId: number;
  score: number;
  reasonCodes: string[];
};

type MatchSuggestionRow = {
  id: number;
  document_id: number;
  matcher_name: string;
  matcher_version: string;
  score: number;
  reason_codes_json: string;
  status: "pending" | "accepted" | "rejected" | "auto_applied" | "expired";
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
  storage_rel_path: string;
  original_filename: string | null;
  source_type: string;
  document_date: string | null;
  issuer_name: string | null;
  invoice_number: string | null;
  gross_amount_cents: number | null;
  currency: string;
};

function normalizeTokens(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  const normalized = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");

  const unique = new Set<string>();
  for (const token of normalized.split(/\s+/)) {
    if (token.length < 3) {
      continue;
    }
    unique.add(token.slice(0, 40));
  }
  return Array.from(unique);
}

function hasAnyTokenOverlap(needle: string[], haystack: string[]): boolean {
  if (needle.length === 0 || haystack.length === 0) {
    return false;
  }
  const haystackSet = new Set(haystack);
  return needle.some((token) => haystackSet.has(token));
}

function dateDistanceDays(dateA: string | null, dateB: string | null): number {
  if (!dateA || !dateB) {
    return Number.POSITIVE_INFINITY;
  }
  const a = Date.parse(`${dateA}T00:00:00Z`);
  const b = Date.parse(`${dateB}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return Number.POSITIVE_INFINITY;
  }
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.abs(a - b) / msPerDay;
}

function buildSuggestionDraft(tx: MatchInputTransaction, doc: MatchInputDocument): MatchSuggestionDraft | null {
  if (typeof doc.gross_amount_cents !== "number" || !doc.document_date) {
    return null;
  }

  const amountDiff = Math.abs(Math.abs(tx.amount_cents) - doc.gross_amount_cents);
  const dateDiffDays = dateDistanceDays(tx.booking_date, doc.document_date);
  if (amountDiff > 500 || dateDiffDays > 30) {
    return null;
  }

  let score = 0;
  const reasons: string[] = [];

  if (amountDiff === 0) {
    score += 0.65;
    reasons.push("amount_exact");
  } else if (amountDiff <= 50) {
    score += 0.45;
    reasons.push("amount_50c");
  } else if (amountDiff <= 200) {
    score += 0.25;
    reasons.push("amount_200c");
  } else {
    score += 0.1;
    reasons.push("amount_500c");
  }

  if (dateDiffDays <= 3) {
    score += 0.2;
    reasons.push("date_3d");
  } else if (dateDiffDays <= 7) {
    score += 0.12;
    reasons.push("date_7d");
  } else if (dateDiffDays <= 14) {
    score += 0.08;
    reasons.push("date_14d");
  } else {
    score += 0.04;
    reasons.push("date_30d");
  }

  const counterpartyTokens = normalizeTokens(tx.counterparty_name);
  const purposeTokens = normalizeTokens(tx.purpose);
  const referenceTokens = normalizeTokens(tx.reference);
  const txEntityTokens = [...counterpartyTokens, ...purposeTokens];
  const txRefTokens = [...referenceTokens, ...purposeTokens];

  const issuerTokens = normalizeTokens(doc.issuer_name);
  if (hasAnyTokenOverlap(issuerTokens, txEntityTokens)) {
    score += 0.1;
    reasons.push("issuer_overlap");
  }

  const invoiceTokens = normalizeTokens(doc.invoice_number);
  if (hasAnyTokenOverlap(invoiceTokens, txRefTokens)) {
    score += 0.1;
    reasons.push("invoice_overlap");
  }

  if (doc.review_required === 0 && typeof doc.ai_confidence === "number") {
    if (doc.ai_confidence >= 0.85) {
      score += 0.05;
      reasons.push("doc_high_confidence");
    } else if (doc.ai_confidence >= 0.7) {
      score += 0.02;
      reasons.push("doc_medium_confidence");
    }
  }

  if (score < 0.2) {
    return null;
  }

  return {
    documentId: doc.id,
    score: Math.min(1, Number(score.toFixed(6))),
    reasonCodes: reasons,
  };
}

function getMatchSuggestionsForTransaction(
  db: ReturnType<typeof getDb>,
  txId: number,
  maxRows = 200,
) {
  return db
    .prepare(
      `SELECT
         s.id,
         s.document_id,
         s.matcher_name,
         s.matcher_version,
         s.score,
         s.reason_codes_json,
         s.status,
         s.created_at,
         s.decided_at,
         s.decided_by,
         d.storage_rel_path,
         d.original_filename,
         d.source_type,
         d.document_date,
         d.issuer_name,
         d.invoice_number,
         d.gross_amount_cents,
         d.currency
       FROM transaction_document_match_suggestions s
       JOIN documents d ON d.id = s.document_id
       WHERE s.bank_transaction_id = ?
       ORDER BY s.status = 'pending' DESC, s.score DESC, s.id DESC
       LIMIT ?`,
    )
    .all(txId, maxRows) as MatchSuggestionRow[];
}

function sendError(res: Response, error: unknown) {
  if (error instanceof ValidationError) {
    res.status(error.status).json({
      error: {
        code: "invalid_query",
        message: error.message,
        details: error.details,
      },
    });
    return;
  }

  if (error instanceof multer.MulterError) {
    const message =
      error.code === "LIMIT_FILE_SIZE"
        ? `Datei zu groß. Maximal erlaubt: ${Math.floor(maxUploadBytes / (1024 * 1024))} MB`
        : error.message;

    res.status(400).json({
      error: {
        code: "invalid_upload",
        message,
      },
    });
    return;
  }

  if (error instanceof z.ZodError) {
    res.status(400).json({
      error: {
        code: "invalid_input",
        message: "Ungültige Eingabedaten",
        details: error.flatten(),
      },
    });
    return;
  }

  const message = error instanceof Error ? error.message : "Unbekannter Fehler";
  res.status(500).json({
    error: {
      code: "internal_error",
      message,
    },
  });
}

function getTransactionOrThrow(db: ReturnType<typeof getDb>, txId: number) {
  const transaction = db
    .prepare(
      `SELECT id, booking_date, document_status, missing_invoice_flag
       FROM bank_transactions
       WHERE id = ?`,
    )
    .get(txId) as
    | {
        id: number;
        booking_date: string;
        document_status: "offen" | "zugeordnet" | "nicht_erforderlich" | "in_klaerung";
        missing_invoice_flag: 0 | 1;
      }
    | undefined;

  if (!transaction) {
    throw new ValidationError("Transaktion nicht gefunden");
  }

  return transaction;
}

function setTransactionDocumentStatus(
  db: ReturnType<typeof getDb>,
  txId: number,
  newStatus: "offen" | "zugeordnet" | "nicht_erforderlich" | "in_klaerung",
  reason: string,
  changedBy = "dashboard",
) {
  const now = nowIso();
  const current = db
    .prepare("SELECT document_status FROM bank_transactions WHERE id = ?")
    .get(txId) as { document_status: "offen" | "zugeordnet" | "nicht_erforderlich" | "in_klaerung" } | undefined;

  if (!current) {
    throw new ValidationError("Transaktion nicht gefunden");
  }

  if (current.document_status === newStatus) {
    return newStatus;
  }

  db.prepare("UPDATE bank_transactions SET document_status = ?, document_status_updated_at = ? WHERE id = ?").run(
    newStatus,
    now,
    txId,
  );

  db.prepare(
    `INSERT INTO transaction_document_status_history
     (bank_transaction_id, old_status, new_status, reason, changed_by, changed_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(txId, current.document_status, newStatus, reason, changedBy, now);

  return newStatus;
}

function recomputeTransactionDocumentStatus(
  db: ReturnType<typeof getDb>,
  txId: number,
  reason: string,
  changedBy = "dashboard",
): "offen" | "zugeordnet" | "nicht_erforderlich" | "in_klaerung" {
  const row = db
    .prepare(
      `SELECT
         bt.document_status,
         bt.missing_invoice_flag,
         EXISTS(
           SELECT 1
           FROM transaction_document_links l
           WHERE l.bank_transaction_id = bt.id
             AND l.is_active = 1
         ) AS has_active_link
       FROM bank_transactions bt
       WHERE bt.id = ?`,
    )
    .get(txId) as
    | {
        document_status: "offen" | "zugeordnet" | "nicht_erforderlich" | "in_klaerung";
        missing_invoice_flag: 0 | 1;
        has_active_link: 0 | 1;
      }
    | undefined;

  if (!row) {
    throw new ValidationError("Transaktion nicht gefunden");
  }

  if (row.document_status === "nicht_erforderlich") {
    return row.document_status;
  }

  const targetStatus: "offen" | "zugeordnet" | "in_klaerung" = row.has_active_link
    ? "zugeordnet"
    : row.missing_invoice_flag === 1
      ? "in_klaerung"
      : "offen";

  return setTransactionDocumentStatus(db, txId, targetStatus, reason, changedBy);
}

router.get("/health", (_req, res) => {
  try {
    const db = getDb();
    db.prepare("SELECT 1").get();

    res.json({
      status: "ok",
      dbPath: getDbPath(),
    });
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/meta/overview", (_req, res) => {
  try {
    const db = getDb();

    const tableNames = [
      "bank_accounts",
      "source_files",
      "statement_docs",
      "bank_transactions_raw",
      "bank_transactions",
      "statement_import_audit",
      "documents",
      "transaction_document_links",
      "transaction_document_match_suggestions",
    ];

    const counts = tableNames.reduce<Record<string, number>>((acc, tableName) => {
      const row = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count: number };
      acc[tableName] = row.count ?? 0;
      return acc;
    }, {});

    const rangeRow = db
      .prepare(
        `SELECT MIN(booking_date) AS min_booking_date, MAX(booking_date) AS max_booking_date
         FROM bank_transactions`,
      )
      .get() as { min_booking_date: string | null; max_booking_date: string | null };

    res.json({
      counts,
      range: rangeRow,
    });
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/kpis", (req, res) => {
  try {
    const query = validateQuery(dateRangeSchema, req.query);
    const db = getDb();
    const { whereSql, params } = buildTransactionsWhere(query);

    const row = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END), 0) AS total_inflow_cents,
           COALESCE(SUM(CASE WHEN amount_cents < 0 THEN amount_cents ELSE 0 END), 0) AS total_outflow_cents,
           COALESCE(SUM(amount_cents), 0) AS net_cents,
           COUNT(*) AS tx_count,
           COUNT(DISTINCT COALESCE(NULLIF(TRIM(counterparty_name), ''), 'Unbekannt')) AS distinct_counterparties
         FROM bank_transactions
         ${whereSql}`,
      )
      .get(...params) as {
      total_inflow_cents: number;
      total_outflow_cents: number;
      net_cents: number;
      tx_count: number;
      distinct_counterparties: number;
    };

    res.json(row);
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/charts/monthly-cashflow", (req, res) => {
  try {
    const query = validateQuery(dateRangeSchema, req.query);
    const db = getDb();
    const { whereSql, params } = buildTransactionsWhere(query);

    const rows = db
      .prepare(
        `SELECT
           strftime('%Y-%m', booking_date) AS month,
           COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END), 0) AS inflow_cents,
           COALESCE(SUM(CASE WHEN amount_cents < 0 THEN amount_cents ELSE 0 END), 0) AS outflow_cents,
           COALESCE(SUM(amount_cents), 0) AS net_cents,
           COUNT(*) AS tx_count
         FROM bank_transactions
         ${whereSql}
         GROUP BY strftime('%Y-%m', booking_date)
         ORDER BY month ASC`,
      )
      .all(...params);

    res.json(rows);
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/charts/tx-type-distribution", (req, res) => {
  try {
    const query = validateQuery(dateRangeSchema, req.query);
    const db = getDb();
    const { whereSql, params } = buildTransactionsWhere(query);

    const rows = db
      .prepare(
        `SELECT
           COALESCE(NULLIF(TRIM(tx_type), ''), 'Unbekannt') AS tx_type,
           COUNT(*) AS count,
           COALESCE(SUM(amount_cents), 0) AS amount_cents
         FROM bank_transactions
         ${whereSql}
         GROUP BY COALESCE(NULLIF(TRIM(tx_type), ''), 'Unbekannt')
         ORDER BY count DESC, amount_cents DESC`,
      )
      .all(...params);

    res.json(rows);
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/top/counterparties", (req, res) => {
  try {
    const query = validateQuery(topCounterpartiesQuerySchema, req.query);
    const db = getDb();
    const { whereSql, params } = buildTransactionsWhere(query);

    const rows = db
      .prepare(
        `SELECT
           COALESCE(NULLIF(TRIM(counterparty_name), ''), 'Unbekannt') AS counterparty_name,
           COUNT(*) AS tx_count,
           COALESCE(SUM(amount_cents), 0) AS sum_cents,
           COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END), 0) AS inflow_cents,
           COALESCE(SUM(CASE WHEN amount_cents < 0 THEN amount_cents ELSE 0 END), 0) AS outflow_cents
         FROM bank_transactions
         ${whereSql}
         GROUP BY COALESCE(NULLIF(TRIM(counterparty_name), ''), 'Unbekannt')
         ORDER BY ABS(sum_cents) DESC
         LIMIT ?`,
      )
      .all(...params, query.limit);

    res.json(rows);
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/transactions", (req, res) => {
  try {
    const query = validateQuery(transactionsQuerySchema, req.query);
    const db = getDb();

    if (typeof query.minCents === "number" && typeof query.maxCents === "number" && query.minCents > query.maxCents) {
      throw new ValidationError("minCents darf nicht größer als maxCents sein");
    }

    const { whereSql, params } = buildTransactionsWhere(query, "bt");
    const offset = (query.page - 1) * query.pageSize;

    const totalRow = db
      .prepare(`SELECT COUNT(*) AS total FROM bank_transactions bt ${whereSql}`)
      .get(...params) as { total: number };

    const items = db
      .prepare(
        `SELECT
           bt.id,
           bt.booking_date,
           bt.valuta_date,
           bt.amount_cents,
           bt.running_balance_cents,
           bt.purpose,
           bt.counterparty_name,
           bt.reference,
           COALESCE(NULLIF(TRIM(bt.tx_type), ''), 'Unbekannt') AS tx_type,
           bt.statement_doc_id,
           bt.document_status,
           bt.missing_invoice_flag,
           COALESCE(ld.linked_documents_count, 0) AS linked_documents_count,
           COALESCE(ms.pending_match_suggestions_count, 0) AS pending_match_suggestions_count
         FROM bank_transactions bt
         LEFT JOIN (
           SELECT bank_transaction_id, COUNT(*) AS linked_documents_count
           FROM transaction_document_links
           WHERE is_active = 1
           GROUP BY bank_transaction_id
         ) ld ON ld.bank_transaction_id = bt.id
         LEFT JOIN (
           SELECT bank_transaction_id, COUNT(*) AS pending_match_suggestions_count
           FROM transaction_document_match_suggestions
           WHERE status = 'pending'
           GROUP BY bank_transaction_id
         ) ms ON ms.bank_transaction_id = bt.id
         ${whereSql}
         ORDER BY bt.booking_date DESC, bt.id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, query.pageSize, offset);

    res.json({
      items,
      page: query.page,
      pageSize: query.pageSize,
      total: totalRow.total ?? 0,
    });
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/transactions/:id", (req, res) => {
  try {
    const txId = txIdFromParams(req.params.id);
    const db = getDb();

    const transaction = db
      .prepare(
        `SELECT
           bt.id,
           bt.account_id,
           bt.statement_doc_id,
           bt.booking_date,
           bt.valuta_date,
           bt.amount_cents,
           bt.currency,
           bt.running_balance_cents,
           bt.purpose,
           bt.counterparty_name,
           bt.counterparty_iban,
           bt.counterparty_bic,
           bt.reference,
           bt.tx_type,
           bt.fingerprint,
           bt.is_reversal,
           bt.document_status,
           bt.missing_invoice_flag,
           bt.document_status_updated_at,
           bt.document_note,
           sd.statement_no,
           sd.period_from,
           sd.period_to,
           sd.opening_balance_cents,
           sd.closing_balance_cents,
           ba.iban AS account_iban,
           sf.file_path,
           sf.year,
           sf.file_sha256
         FROM bank_transactions bt
         LEFT JOIN statement_docs sd ON sd.id = bt.statement_doc_id
         LEFT JOIN bank_accounts ba ON ba.id = bt.account_id
         LEFT JOIN source_files sf ON sf.id = sd.source_file_id
         WHERE bt.id = ?`,
      )
      .get(txId);

    if (!transaction) {
      res.status(404).json({
        error: {
          code: "not_found",
          message: "Transaktion nicht gefunden",
        },
      });
      return;
    }

    const statementDocId = (transaction as { statement_doc_id: number | null }).statement_doc_id;

    const rawRows =
      typeof statementDocId === "number"
        ? db
            .prepare(
              `SELECT id, page_no, line_start, line_end, raw_block_text, parse_confidence, parser_rule, parse_status
               FROM bank_transactions_raw
               WHERE statement_doc_id = ?
               ORDER BY id ASC
               LIMIT 250`,
            )
            .all(statementDocId)
        : [];

    const auditRows =
      typeof statementDocId === "number"
        ? db
            .prepare(
              `SELECT
                 id,
                 record_type,
                 source_ref,
                 parser_rule,
                 parse_confidence,
                 parse_status,
                 parsed_data_json,
                 created_at,
                 bank_transaction_id
               FROM statement_import_audit
               WHERE statement_doc_id = ?
                 AND (bank_transaction_id = ? OR bank_transaction_id IS NULL)
               ORDER BY id ASC
               LIMIT 500`,
            )
            .all(statementDocId, txId)
        : [];

    const linkedDocuments = db
      .prepare(
        `SELECT
           l.id,
           l.link_role,
           l.link_origin,
           l.confidence,
           l.is_active,
           l.created_at,
           l.created_by,
           d.id AS document_id,
           d.year,
           d.source_type,
           d.lifecycle_status,
           d.storage_rel_path,
           d.original_filename,
           d.mime_type,
           d.file_size_bytes,
           d.file_sha256,
           d.document_date,
           d.issuer_name,
           d.invoice_number,
           d.gross_amount_cents,
           d.currency
         FROM transaction_document_links l
         JOIN documents d ON d.id = l.document_id
         WHERE l.bank_transaction_id = ?
           AND l.is_active = 1
         ORDER BY l.id DESC`,
      )
      .all(txId);

    const suggestions = getMatchSuggestionsForTransaction(db, txId, 200);

    const statusHistory = db
      .prepare(
        `SELECT id, old_status, new_status, reason, changed_by, changed_at
         FROM transaction_document_status_history
         WHERE bank_transaction_id = ?
         ORDER BY id DESC
         LIMIT 100`,
      )
      .all(txId);

    const taxDetermination = db
      .prepare(
        `SELECT
           id,
           bank_transaction_id,
           status,
           calculation_mode,
           tax_code,
           tax_rate_bps,
           net_amount_cents,
           tax_amount_cents,
           country_code,
           counterparty_vat_id,
           evidence_level,
           confidence,
           reason_codes_json,
           source_snapshot_json,
           decided_at,
           decided_by,
           updated_at
         FROM transaction_tax_determinations
         WHERE bank_transaction_id = ?`,
      )
      .get(txId);

    const statementFilePath = resolveStatementFilePath({
      filePathRaw: (transaction as { file_path: string | null }).file_path,
      statementNoRaw: (transaction as { statement_no: string | null }).statement_no,
      sourceFileYear: (transaction as { year: number | null }).year,
      bookingDate: (transaction as { booking_date: string | null }).booking_date,
      accountIban: (transaction as { account_iban: string | null }).account_iban,
    });
    const transactionWithStatementLink = {
      ...(transaction as Record<string, unknown>),
      statement_file_url: statementFilePath ? `/api/transactions/${txId}/statement-file` : null,
    };

    res.json({
      transaction: transactionWithStatementLink,
      raw_rows: rawRows,
      audit_rows: auditRows,
      linked_documents: linkedDocuments,
      match_suggestions: suggestions,
      document_status_history: statusHistory,
      tax_determination: taxDetermination ?? null,
    });
  } catch (error) {
    sendError(res, error);
  }
});

router.post("/transactions/:id/match-suggestions/refresh", (req, res) => {
  try {
    const txId = txIdFromParams(req.params.id);
    const payload = matchSuggestionsRefreshSchema.parse(req.body ?? {});
    const db = getDb();

    const tx = db
      .prepare(
        `SELECT id, booking_date, amount_cents, purpose, counterparty_name, reference
         FROM bank_transactions
         WHERE id = ?`,
      )
      .get(txId) as MatchInputTransaction | undefined;

    if (!tx) {
      throw new ValidationError("Transaktion nicht gefunden");
    }

    const hasActiveLinkRow = db
      .prepare(
        `SELECT EXISTS(
           SELECT 1
           FROM transaction_document_links
           WHERE bank_transaction_id = ?
             AND is_active = 1
         ) AS has_active_link`,
      )
      .get(txId) as { has_active_link: 0 | 1 };

    const documentColumns = getDocumentsColumnSet();
    const reviewRequiredExpr = documentColumns.has("review_required")
      ? "COALESCE(d.review_required, 0) AS review_required"
      : "0 AS review_required";
    const aiConfidenceExpr = documentColumns.has("ai_confidence")
      ? "d.ai_confidence AS ai_confidence"
      : "NULL AS ai_confidence";

    const candidates = db
      .prepare(
        `SELECT
           d.id,
           d.source_type,
           d.storage_rel_path,
           d.original_filename,
           d.document_date,
           d.issuer_name,
           d.invoice_number,
           d.gross_amount_cents,
           d.currency,
           ${reviewRequiredExpr},
           ${aiConfidenceExpr}
         FROM documents d
         WHERE d.lifecycle_status = 'archiviert'
           AND d.gross_amount_cents IS NOT NULL
           AND d.document_date IS NOT NULL
           AND ABS(? - d.gross_amount_cents) <= 500
           AND ABS(julianday(?) - julianday(d.document_date)) <= 30
           AND NOT EXISTS (
             SELECT 1
             FROM transaction_document_links l
             WHERE l.document_id = d.id
               AND l.is_active = 1
           )
         ORDER BY ABS(? - d.gross_amount_cents) ASC, ABS(julianday(?) - julianday(d.document_date)) ASC, d.id DESC
         LIMIT 400`,
      )
      .all(
        Math.abs(tx.amount_cents),
        tx.booking_date,
        Math.abs(tx.amount_cents),
        tx.booking_date,
      ) as MatchInputDocument[];

    const drafts = candidates
      .map((doc) => buildSuggestionDraft(tx, doc))
      .filter((row): row is MatchSuggestionDraft => row !== null)
      .sort((a, b) => b.score - a.score || a.documentId - b.documentId)
      .slice(0, payload.limit);

    const writeTx = db.transaction(() => {
      const now = nowIso();
      const expiredResult = db
        .prepare(
          `UPDATE transaction_document_match_suggestions
           SET status = 'expired', decided_at = ?, decided_by = 'dashboard'
           WHERE bank_transaction_id = ?
             AND status = 'pending'`,
        )
        .run(now, txId);

      const updateSuggestion = db.prepare(
        `UPDATE transaction_document_match_suggestions
         SET score = ?,
             reason_codes_json = ?,
             status = 'pending',
             created_at = ?,
             decided_at = NULL,
             decided_by = NULL
         WHERE bank_transaction_id = ?
           AND document_id = ?
           AND matcher_name = 'deterministic_v1'
           AND matcher_version = '1.0.0'`,
      );
      const insertSuggestion = db.prepare(
        `INSERT INTO transaction_document_match_suggestions
          (bank_transaction_id, document_id, matcher_name, matcher_version, score, reason_codes_json, status, created_at, decided_at, decided_by)
         VALUES (?, ?, 'deterministic_v1', '1.0.0', ?, ?, 'pending', ?, NULL, NULL)`,
      );

      for (const suggestion of drafts) {
        const updated = updateSuggestion.run(
          suggestion.score,
          JSON.stringify(suggestion.reasonCodes),
          now,
          txId,
          suggestion.documentId,
        );
        if (updated.changes === 0) {
          insertSuggestion.run(txId, suggestion.documentId, suggestion.score, JSON.stringify(suggestion.reasonCodes), now);
        }
      }

      return {
        expiredCount: expiredResult.changes,
      };
    });

    const writeResult = writeTx();
    const pendingSuggestions = getMatchSuggestionsForTransaction(db, txId, 200).filter((row) => row.status === "pending");

    res.json({
      ok: true,
      transaction_id: txId,
      has_active_link: hasActiveLinkRow.has_active_link === 1,
      expired_count: writeResult.expiredCount,
      candidate_count: pendingSuggestions.length,
      suggestions: pendingSuggestions,
    });
  } catch (error) {
    sendError(res, error);
  }
});

router.post("/transactions/:id/match-selection", (req, res) => {
  try {
    const txId = txIdFromParams(req.params.id);
    const payload = matchSelectionSchema.parse(req.body);
    const db = getDb();

    getTransactionOrThrow(db, txId);

    const supportingUnique = Array.from(new Set(payload.supportingDocumentIds));
    if (supportingUnique.length !== payload.supportingDocumentIds.length) {
      throw new ValidationError("supportingDocumentIds enthält Duplikate.");
    }
    if (supportingUnique.includes(payload.primaryDocumentId)) {
      throw new ValidationError("Der Primary-Beleg darf nicht gleichzeitig als Supporting gewählt werden.");
    }

    const selectedIds = [payload.primaryDocumentId, ...supportingUnique];
    const placeholders = selectedIds.map(() => "?").join(", ");

    const pendingRows = db
      .prepare(
        `SELECT document_id, score
         FROM transaction_document_match_suggestions
         WHERE bank_transaction_id = ?
           AND status = 'pending'
           AND document_id IN (${placeholders})`,
      )
      .all(txId, ...selectedIds) as Array<{ document_id: number; score: number }>;

    if (pendingRows.length !== selectedIds.length) {
      throw new ValidationError("Auswahl muss aus den aktuell offenen Vorschlägen stammen.");
    }

    const scoreByDocument = new Map<number, number>(pendingRows.map((row) => [row.document_id, row.score]));

    const writeTx = db.transaction(() => {
      const now = nowIso();
      db.prepare(
        `UPDATE transaction_document_links
         SET link_role = 'supporting'
         WHERE bank_transaction_id = ?
           AND is_active = 1
           AND link_role = 'primary'
           AND document_id <> ?`,
      ).run(txId, payload.primaryDocumentId);

      const upsertLink = db.prepare(
        `INSERT INTO transaction_document_links
          (bank_transaction_id, document_id, link_role, link_origin, confidence, is_active, created_at, created_by)
         VALUES (?, ?, ?, 'manual', ?, 1, ?, 'dashboard')
         ON CONFLICT(bank_transaction_id, document_id)
         DO UPDATE SET
           is_active = 1,
           link_role = excluded.link_role,
           link_origin = excluded.link_origin,
           confidence = excluded.confidence,
           created_at = excluded.created_at,
           created_by = excluded.created_by`,
      );

      for (const documentId of selectedIds) {
        const role = documentId === payload.primaryDocumentId ? "primary" : "supporting";
        upsertLink.run(txId, documentId, role, scoreByDocument.get(documentId) ?? null, now);
      }

      db.prepare(
        `UPDATE transaction_document_match_suggestions
         SET status = 'accepted', decided_at = ?, decided_by = 'dashboard'
         WHERE bank_transaction_id = ?
           AND status = 'pending'
           AND document_id IN (${placeholders})`,
      ).run(now, txId, ...selectedIds);

      db.prepare(
        `UPDATE transaction_document_match_suggestions
         SET status = 'rejected', decided_at = ?, decided_by = 'dashboard'
         WHERE bank_transaction_id = ?
           AND status = 'pending'`,
      ).run(now, txId);

      const status = recomputeTransactionDocumentStatus(db, txId, "Belegauswahl aus Match-Vorschlag übernommen", "dashboard");
      return { status };
    });

    const result = writeTx();

    res.json({
      ok: true,
      transaction_id: txId,
      linked_document_ids: selectedIds,
      new_status: result.status,
    });
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/transactions/:id/next-open", (req, res) => {
  try {
    const txId = txIdFromParams(req.params.id);
    const query = validateQuery(nextOpenQuerySchema, req.query);
    const db = getDb();

    if (typeof query.minCents === "number" && typeof query.maxCents === "number" && query.minCents > query.maxCents) {
      throw new ValidationError("minCents darf nicht größer als maxCents sein");
    }

    const current = db
      .prepare(
        `SELECT id, booking_date
         FROM bank_transactions
         WHERE id = ?`,
      )
      .get(txId) as { id: number; booking_date: string } | undefined;

    if (!current) {
      throw new ValidationError("Transaktion nicht gefunden");
    }

    const { whereSql, params } = buildTransactionsWhere(
      {
        from: query.from,
        to: query.to,
        q: query.q,
        txType: query.txType,
        minCents: query.minCents,
        maxCents: query.maxCents,
      },
      "bt",
    );

    const openStatusClause = `bt.document_status IN ('offen', 'in_klaerung')`;
    const cursorClause = `(bt.booking_date < ? OR (bt.booking_date = ? AND bt.id < ?))`;
    const finalWhereSql = whereSql
      ? `${whereSql} AND ${openStatusClause} AND ${cursorClause}`
      : `WHERE ${openStatusClause} AND ${cursorClause}`;

    const next = db
      .prepare(
        `SELECT bt.id
         FROM bank_transactions bt
         ${finalWhereSql}
         ORDER BY bt.booking_date DESC, bt.id DESC
         LIMIT 1`,
      )
      .get(...params, current.booking_date, current.booking_date, current.id) as { id: number } | undefined;

    res.json({
      nextTransactionId: next?.id ?? null,
    });
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/transactions/:id/statement-file", (req, res) => {
  try {
    const txId = txIdFromParams(req.params.id);
    const db = getDb();

    const row = db
      .prepare(
        `SELECT
           sf.file_path,
           sd.statement_no,
           sf.year,
           bt.booking_date,
           ba.iban AS account_iban
         FROM bank_transactions bt
         LEFT JOIN statement_docs sd ON sd.id = bt.statement_doc_id
         LEFT JOIN bank_accounts ba ON ba.id = bt.account_id
         LEFT JOIN source_files sf ON sf.id = sd.source_file_id
         WHERE bt.id = ?`,
      )
      .get(txId) as
      | {
          file_path: string | null;
          statement_no: string | null;
          year: number | null;
          booking_date: string | null;
          account_iban: string | null;
        }
      | undefined;

    if (!row) {
      res.status(404).json({
        error: {
          code: "not_found",
          message: "Transaktion nicht gefunden",
        },
      });
      return;
    }

    const statementFilePath = resolveStatementFilePath({
      filePathRaw: row.file_path,
      statementNoRaw: row.statement_no,
      sourceFileYear: row.year,
      bookingDate: row.booking_date,
      accountIban: row.account_iban,
    });
    if (!statementFilePath) {
      res.status(404).json({
        error: {
          code: "statement_file_not_found",
          message: "Kein oeffenbarer Kontoauszug fuer diese Transaktion gefunden.",
        },
      });
      return;
    }

    res.sendFile(statementFilePath, {
      headers: {
        "Content-Disposition": "inline",
      },
    });
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/documents/:id/file", (req, res) => {
  try {
    const documentId = Number(req.params.id);
    if (!Number.isInteger(documentId) || documentId <= 0) {
      throw new ValidationError("Ungültige Dokument-ID");
    }

    const db = getDb();
    const row = db
      .prepare(
        `SELECT id, storage_rel_path, original_filename
         FROM documents
         WHERE id = ?`,
      )
      .get(documentId) as { id: number; storage_rel_path: string; original_filename: string | null } | undefined;

    if (!row) {
      res.status(404).json({
        error: {
          code: "not_found",
          message: "Dokument nicht gefunden",
        },
      });
      return;
    }

    const absPath = path.resolve(projectRoot, row.storage_rel_path);
    const projectRootAbs = path.resolve(projectRoot);
    if (absPath !== projectRootAbs && !absPath.startsWith(`${projectRootAbs}${path.sep}`)) {
      throw new ValidationError("Ungültiger Dokumentpfad");
    }

    if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
      res.status(404).json({
        error: {
          code: "file_not_found",
          message: "Datei zu diesem Dokument wurde nicht gefunden",
        },
      });
      return;
    }

    const fileName = row.original_filename?.trim() || path.basename(absPath);
    const encoded = encodeURIComponent(fileName);
    res.sendFile(absPath, {
      headers: {
        "Content-Disposition": `inline; filename*=UTF-8''${encoded}`,
      },
    });
  } catch (error) {
    sendError(res, error);
  }
});

router.post("/transactions/:id/documents/upload", upload.single("file"), (req, res) => {
  try {
    const txId = txIdFromParams(req.params.id);
    if (!req.file) {
      throw new ValidationError("Es wurde keine Datei hochgeladen");
    }

    const sourceType = uploadSourceTypeSchema.parse(req.body.sourceType ?? "manuell");
    const documentDate = req.body.documentDate ? isoDateSchema.parse(req.body.documentDate) : null;
    const invoiceNumber = typeof req.body.invoiceNumber === "string" ? req.body.invoiceNumber.trim() : null;
    const issuerName = typeof req.body.issuerName === "string" ? req.body.issuerName.trim() : null;
    const grossAmountCents =
      typeof req.body.grossAmountCents === "string" && req.body.grossAmountCents.length > 0
        ? Number.parseInt(req.body.grossAmountCents, 10)
        : null;

    if (grossAmountCents !== null && !Number.isInteger(grossAmountCents)) {
      throw new ValidationError("grossAmountCents muss eine Ganzzahl sein");
    }

    const db = getDb();
    const tx = getTransactionOrThrow(db, txId);
    const year = Number.parseInt(tx.booking_date.slice(0, 4), 10);
    const month = tx.booking_date.slice(0, 7);

    const sha256 = createHash("sha256").update(req.file.buffer).digest("hex");
    const existingDoc = db
      .prepare("SELECT * FROM documents WHERE file_sha256 = ?")
      .get(sha256) as
      | {
          id: number;
          year: number;
          source_type: string;
          lifecycle_status: string;
          storage_rel_path: string;
          file_sha256: string;
        }
      | undefined;

    let documentId: number;
    let documentRow: Record<string, unknown>;
    let deduplicated = false;
    let writtenPath: string | null = null;

    if (existingDoc) {
      deduplicated = true;
      documentId = existingDoc.id;
    } else {
      ensureDocumentRootExists();
      const originalExt = path.extname(req.file.originalname).toLowerCase();
      const extension = allowedExtensions.has(originalExt) ? originalExt : preferredExtensionByMime[req.file.mimetype] ?? ".pdf";
      const originalBase = path.basename(req.file.originalname, path.extname(req.file.originalname));
      const safeBase = sanitizeFilename(originalBase) || "beleg";
      const fileName = `${sha256}_${safeBase}${extension}`;
      const relPath = path.join("belege", String(year), "archiviert", sourceType, month, fileName);
      const absPath = path.join(projectRoot, relPath);

      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, req.file.buffer, { flag: "wx" });
      writtenPath = absPath;

      const now = nowIso();
      const insertResult = db
        .prepare(
          `INSERT INTO documents
             (year, source_type, lifecycle_status, storage_rel_path, original_filename, mime_type, file_size_bytes, file_sha256,
              document_date, issuer_name, invoice_number, gross_amount_cents, metadata_json, created_at, updated_at)
           VALUES (?, ?, 'archiviert', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          year,
          sourceType,
          relPath,
          req.file.originalname,
          req.file.mimetype,
          req.file.size,
          sha256,
          documentDate,
          issuerName,
          invoiceNumber,
          grossAmountCents,
          JSON.stringify({ upload_source: "dashboard" }),
          now,
          now,
        );
      documentId = Number(insertResult.lastInsertRowid);
    }

    const writeTx = db.transaction(() => {
      const now = nowIso();
      db.prepare(
        `INSERT INTO transaction_document_links
          (bank_transaction_id, document_id, link_role, link_origin, confidence, is_active, created_at, created_by)
         VALUES (?, ?, 'primary', 'manual', NULL, 1, ?, 'dashboard')
         ON CONFLICT(bank_transaction_id, document_id)
         DO UPDATE SET
           is_active = 1,
           link_origin = excluded.link_origin,
           created_at = excluded.created_at,
           created_by = excluded.created_by`,
      ).run(txId, documentId, now);

      const newStatus = recomputeTransactionDocumentStatus(db, txId, "Beleg verknüpft", "dashboard");

      const document = db.prepare("SELECT * FROM documents WHERE id = ?").get(documentId);
      const link = db
        .prepare(
          `SELECT id, bank_transaction_id, document_id, link_role, link_origin, is_active, created_at, created_by
           FROM transaction_document_links
           WHERE bank_transaction_id = ? AND document_id = ?`,
        )
        .get(txId, documentId);

      return {
        document,
        link,
        newStatus,
      };
    });

    try {
      const result = writeTx();
      documentRow = (result.document ?? {}) as Record<string, unknown>;
      res.json({
        transaction_id: txId,
        deduplicated,
        document: documentRow,
        link: result.link,
        new_status: result.newStatus,
      });
    } catch (error) {
      if (writtenPath) {
        fs.rmSync(writtenPath, { force: true });
      }
      throw error;
    }
  } catch (error) {
    sendError(res, error);
  }
});

router.post("/transactions/:id/document-links", (req, res) => {
  try {
    const txId = txIdFromParams(req.params.id);
    const payload = documentLinkCreateSchema.parse(req.body);
    const db = getDb();

    getTransactionOrThrow(db, txId);

    const document = db.prepare("SELECT id FROM documents WHERE id = ?").get(payload.documentId) as { id: number } | undefined;
    if (!document) {
      throw new ValidationError("Dokument nicht gefunden");
    }

    const now = nowIso();
    db.prepare(
      `INSERT INTO transaction_document_links
        (bank_transaction_id, document_id, link_role, link_origin, confidence, is_active, created_at, created_by)
       VALUES (?, ?, ?, 'manual', NULL, 1, ?, 'dashboard')
       ON CONFLICT(bank_transaction_id, document_id)
       DO UPDATE SET
         is_active = 1,
         link_role = excluded.link_role,
         link_origin = excluded.link_origin,
         created_at = excluded.created_at,
         created_by = excluded.created_by`,
    ).run(txId, payload.documentId, payload.linkRole, now);

    const status = recomputeTransactionDocumentStatus(db, txId, "Beleg manuell verknüpft", "dashboard");

    res.json({
      ok: true,
      transaction_id: txId,
      document_id: payload.documentId,
      new_status: status,
    });
  } catch (error) {
    sendError(res, error);
  }
});

router.delete("/transactions/:id/document-links/:linkId", (req, res) => {
  try {
    const txId = txIdFromParams(req.params.id);
    const linkId = Number(req.params.linkId);
    if (!Number.isInteger(linkId) || linkId <= 0) {
      throw new ValidationError("Ungültige Link-ID");
    }

    const db = getDb();
    getTransactionOrThrow(db, txId);

    const result = db
      .prepare(
        `UPDATE transaction_document_links
         SET is_active = 0
         WHERE id = ?
           AND bank_transaction_id = ?
           AND is_active = 1`,
      )
      .run(linkId, txId);

    if (result.changes === 0) {
      throw new ValidationError("Aktive Belegverknüpfung nicht gefunden");
    }

    const status = recomputeTransactionDocumentStatus(db, txId, "Belegverknüpfung entfernt", "dashboard");

    res.json({
      ok: true,
      transaction_id: txId,
      link_id: linkId,
      new_status: status,
    });
  } catch (error) {
    sendError(res, error);
  }
});

router.patch("/transactions/:id/document-status", (req, res) => {
  try {
    const txId = txIdFromParams(req.params.id);
    const payload = documentStatusPatchSchema.parse(req.body);
    const db = getDb();

    getTransactionOrThrow(db, txId);
    const status = setTransactionDocumentStatus(db, txId, payload.status, payload.reason ?? "Status manuell gesetzt", "dashboard");

    res.json({ ok: true, transaction_id: txId, status });
  } catch (error) {
    sendError(res, error);
  }
});

router.patch("/transactions/:id/missing-invoice-flag", (req, res) => {
  try {
    const txId = txIdFromParams(req.params.id);
    const payload = missingInvoicePatchSchema.parse(req.body);
    const db = getDb();

    getTransactionOrThrow(db, txId);

    db.prepare("UPDATE bank_transactions SET missing_invoice_flag = ? WHERE id = ?").run(payload.missingInvoiceFlag ? 1 : 0, txId);

    const status = recomputeTransactionDocumentStatus(
      db,
      txId,
      payload.missingInvoiceFlag ? "Fehlende Rechnung markiert" : "Fehlende Rechnung entfernt",
      "dashboard",
    );

    res.json({
      ok: true,
      transaction_id: txId,
      missing_invoice_flag: payload.missingInvoiceFlag,
      status,
    });
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/documents", (req, res) => {
  try {
    const query = validateQuery(documentsQuerySchema, req.query);
    const db = getDb();
    const documentColumns = getDocumentsColumnSet();

    const { whereSql, params } = buildDocumentsWhere(query, documentColumns, "d");
    const offset = (query.page - 1) * query.pageSize;

    const totalRow = db.prepare(`SELECT COUNT(*) AS total FROM documents d ${whereSql}`).get(...params) as { total: number };
    const items = db
      .prepare(
        `SELECT
           d.*,
           COALESCE(link_counts.link_count, 0) AS linked_transactions_count,
           COALESCE(link_counts.inflow_count, 0) AS linked_inflow_count,
           COALESCE(link_counts.outflow_count, 0) AS linked_outflow_count
         FROM documents d
         LEFT JOIN (
           SELECT
             l.document_id,
             COUNT(*) AS link_count,
             SUM(CASE WHEN t.amount_cents > 0 THEN 1 ELSE 0 END) AS inflow_count,
             SUM(CASE WHEN t.amount_cents < 0 THEN 1 ELSE 0 END) AS outflow_count
           FROM transaction_document_links l
           JOIN bank_transactions t ON t.id = l.bank_transaction_id
           WHERE l.is_active = 1
           GROUP BY l.document_id
         ) link_counts ON link_counts.document_id = d.id
         ${whereSql}
         ORDER BY d.id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, query.pageSize, offset);

    res.json({
      items,
      page: query.page,
      pageSize: query.pageSize,
      total: totalRow.total ?? 0,
    });
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/ops/import-quality", (req, res) => {
  try {
    const query = validateQuery(dateRangeSchema, req.query);
    const db = getDb();

    const tableNames = [
      "source_files",
      "statement_docs",
      "bank_transactions_raw",
      "bank_transactions",
      "statement_import_audit",
      "documents",
      "transaction_document_links",
      "transaction_document_match_suggestions",
    ];

    const entityCounts = tableNames.reduce<Record<string, number>>((acc, tableName) => {
      const row = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count: number };
      acc[tableName] = row.count ?? 0;
      return acc;
    }, {});

    const auditStatusRows = db
      .prepare(
        `SELECT parse_status, COUNT(*) AS count
         FROM statement_import_audit
         WHERE record_type = 'transaction'
         GROUP BY parse_status
         ORDER BY parse_status`,
      )
      .all();

    const rawStatusRows = db
      .prepare(
        `SELECT parse_status, COUNT(*) AS count
         FROM bank_transactions_raw
         GROUP BY parse_status
         ORDER BY parse_status`,
      )
      .all();

    const { whereSql, params } = buildTransactionsWhere(query);

    const coverageRow = db
      .prepare(
        `WITH filtered_tx AS (
           SELECT id FROM bank_transactions ${whereSql}
         ),
         tx_with_audit AS (
           SELECT DISTINCT bank_transaction_id AS id
           FROM statement_import_audit
           WHERE record_type = 'transaction'
             AND bank_transaction_id IS NOT NULL
         )
         SELECT
           (SELECT COUNT(*) FROM filtered_tx) AS tx_total,
           (SELECT COUNT(*) FROM filtered_tx f JOIN tx_with_audit a ON a.id = f.id) AS tx_with_audit`,
      )
      .get(...params) as { tx_total: number; tx_with_audit: number };

    const docsWithoutTransactions = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM statement_docs sd
         LEFT JOIN bank_transactions bt ON bt.statement_doc_id = sd.id
         WHERE bt.id IS NULL`,
      )
      .get() as { count: number };

    res.json({
      date_range: query,
      entity_counts: entityCounts,
      audit_status_counts: auditStatusRows,
      raw_status_counts: rawStatusRows,
      transaction_coverage: {
        tx_total: coverageRow.tx_total ?? 0,
        tx_with_audit: coverageRow.tx_with_audit ?? 0,
        tx_without_audit: Math.max((coverageRow.tx_total ?? 0) - (coverageRow.tx_with_audit ?? 0), 0),
      },
      docs_without_transactions: docsWithoutTransactions.count ?? 0,
    });
  } catch (error) {
    sendError(res, error);
  }
});

export default router;
