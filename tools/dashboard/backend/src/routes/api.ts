import { Router, type Response } from "express";
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
    minCents: z.coerce.number().int().optional(),
    maxCents: z.coerce.number().int().optional(),
    page: z.coerce.number().int().min(1).optional().default(1),
    pageSize: z.coerce.number().int().min(1).max(200).optional().default(50),
  }),
);

function buildTransactionsWhere(filters: {
  from?: string;
  to?: string;
  q?: string;
  txType?: string;
  minCents?: number;
  maxCents?: number;
}): { whereSql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters.from) {
    clauses.push("booking_date >= ?");
    params.push(filters.from);
  }

  if (filters.to) {
    clauses.push("booking_date <= ?");
    params.push(filters.to);
  }

  if (filters.txType) {
    clauses.push("COALESCE(NULLIF(TRIM(tx_type), ''), 'Unbekannt') = ?");
    params.push(filters.txType);
  }

  if (typeof filters.minCents === "number") {
    clauses.push("amount_cents >= ?");
    params.push(filters.minCents);
  }

  if (typeof filters.maxCents === "number") {
    clauses.push("amount_cents <= ?");
    params.push(filters.maxCents);
  }

  if (filters.q) {
    const pattern = `%${escapeLike(filters.q)}%`;
    clauses.push(
      "(purpose LIKE ? ESCAPE '\\\\' OR counterparty_name LIKE ? ESCAPE '\\\\' OR reference LIKE ? ESCAPE '\\\\')",
    );
    params.push(pattern, pattern, pattern);
  }

  return {
    whereSql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
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

  const message = error instanceof Error ? error.message : "Unbekannter Fehler";
  res.status(500).json({
    error: {
      code: "internal_error",
      message,
    },
  });
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

    const { whereSql, params } = buildTransactionsWhere(query);
    const offset = (query.page - 1) * query.pageSize;

    const totalRow = db
      .prepare(`SELECT COUNT(*) AS total FROM bank_transactions ${whereSql}`)
      .get(...params) as { total: number };

    const items = db
      .prepare(
        `SELECT
           id,
           booking_date,
           valuta_date,
           amount_cents,
           running_balance_cents,
           purpose,
           counterparty_name,
           reference,
           COALESCE(NULLIF(TRIM(tx_type), ''), 'Unbekannt') AS tx_type,
           statement_doc_id
         FROM bank_transactions
         ${whereSql}
         ORDER BY booking_date DESC, id DESC
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
    const txId = Number(req.params.id);
    if (!Number.isInteger(txId) || txId <= 0) {
      throw new ValidationError("Ungültige Transaktions-ID");
    }

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
           sd.statement_no,
           sd.period_from,
           sd.period_to,
           sd.opening_balance_cents,
           sd.closing_balance_cents,
           sf.file_path,
           sf.year,
           sf.file_sha256
         FROM bank_transactions bt
         LEFT JOIN statement_docs sd ON sd.id = bt.statement_doc_id
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

    res.json({
      transaction,
      raw_rows: rawRows,
      audit_rows: auditRows,
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
