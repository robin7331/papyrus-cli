import { Router, type Response } from "express";
import { z } from "zod";
import { getDb } from "../db/connection.js";
import { ValidationError, validateQuery } from "../lib/validation.js";

const router = Router();

type DeterminationStatus = "draft" | "final" | "review_required";

type DeterminationInput = {
  status: DeterminationStatus;
  calculationMode: "auto" | "manual";
  taxCode: string | null;
  taxRateBps: number | null;
  netAmountCents: number | null;
  taxAmountCents: number | null;
  countryCode: string | null;
  counterpartyVatId: string | null;
  evidenceLevel: "low" | "medium" | "high";
  confidence: number;
  reasonCodes: string[];
  sourceSnapshot: Record<string, unknown>;
  decidedBy: string;
};

const recomputeBodySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
});

const monthlyReportQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
});

const reviewQueueQuerySchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  status: z.enum(["review_required", "draft", "final"]).optional().default("review_required"),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).optional().default(50),
});

const patchDeterminationSchema = z.object({
  status: z.enum(["draft", "final", "review_required"]),
  calculationMode: z.enum(["auto", "manual"]).optional(),
  taxCode: z.string().trim().max(80).nullable().optional(),
  taxRateBps: z.number().int().min(0).max(10000).nullable().optional(),
  netAmountCents: z.number().int().nullable().optional(),
  taxAmountCents: z.number().int().nullable().optional(),
  countryCode: z.string().trim().toUpperCase().length(2).nullable().optional(),
  counterpartyVatId: z.string().trim().max(64).nullable().optional(),
  evidenceLevel: z.enum(["low", "medium", "high"]).optional(),
  confidence: z.number().min(0).max(1).optional(),
  reasonCodes: z.array(z.string().trim().min(1).max(80)).optional(),
});

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

function nowIso(): string {
  return new Date().toISOString();
}

function getTaxRateBpsForCode(taxCode: string | null): number {
  if (!taxCode) {
    return 0;
  }
  const db = getDb();
  const row = db.prepare("SELECT rate_bps FROM tax_codes WHERE code = ?").get(taxCode) as { rate_bps: number } | undefined;
  return row?.rate_bps ?? 0;
}

function computeTaxFromGross(grossCents: number, rateBps: number): { netCents: number; taxCents: number } {
  if (rateBps <= 0) {
    return { netCents: grossCents, taxCents: 0 };
  }
  const absGross = Math.abs(grossCents);
  const taxCents = Math.round((absGross * rateBps) / (10_000 + rateBps));
  const netCents = absGross - taxCents;
  return { netCents, taxCents };
}

function buildLedgerLineType(taxCode: string | null, amountCents: number):
  | "output_tax"
  | "input_tax"
  | "reverse_charge_output"
  | "reverse_charge_input"
  | "oss_output"
  | "non_taxable" {
  if (!taxCode) {
    return "non_taxable";
  }

  if (taxCode === "EU_B2C_OSS_STD") {
    return "oss_output";
  }
  if (taxCode === "EU_B2B_RC_OUT") {
    return "reverse_charge_output";
  }
  if (taxCode === "EU_B2B_RC_IN") {
    return amountCents < 0 ? "reverse_charge_input" : "reverse_charge_output";
  }
  if (taxCode === "NON_TAXABLE" || taxCode === "THIRD_COUNTRY_EXPORT_0") {
    return "non_taxable";
  }

  return amountCents >= 0 ? "output_tax" : "input_tax";
}

function rebuildLedgerForTransaction(bankTransactionId: number) {
  const db = getDb();
  const tx = db
    .prepare(
      `SELECT id, booking_date, amount_cents
       FROM bank_transactions
       WHERE id = ?`,
    )
    .get(bankTransactionId) as { id: number; booking_date: string; amount_cents: number } | undefined;

  if (!tx) {
    throw new ValidationError("Transaktion nicht gefunden");
  }

  const determination = db
    .prepare(
      `SELECT id, status, tax_code, tax_rate_bps, net_amount_cents, tax_amount_cents, country_code
       FROM transaction_tax_determinations
       WHERE bank_transaction_id = ?`,
    )
    .get(bankTransactionId) as
    | {
        id: number;
        status: DeterminationStatus;
        tax_code: string | null;
        tax_rate_bps: number | null;
        net_amount_cents: number | null;
        tax_amount_cents: number | null;
        country_code: string | null;
      }
    | undefined;

  db.prepare("DELETE FROM vat_ledger_lines WHERE bank_transaction_id = ?").run(bankTransactionId);

  if (!determination || determination.status !== "final") {
    return;
  }

  const taxRateBps = determination.tax_rate_bps ?? getTaxRateBpsForCode(determination.tax_code);
  const computed = computeTaxFromGross(tx.amount_cents, taxRateBps);
  const netCents = determination.net_amount_cents ?? computed.netCents;
  const taxCents = determination.tax_amount_cents ?? computed.taxCents;
  const period = tx.booking_date.slice(0, 7);
  const lineType = buildLedgerLineType(determination.tax_code, tx.amount_cents);

  const elsterRow = determination.tax_code
    ? (db.prepare("SELECT elster_key FROM tax_codes WHERE code = ?").get(determination.tax_code) as { elster_key: string | null } | undefined)
    : undefined;

  db.prepare(
    `INSERT INTO vat_ledger_lines
      (period, bank_transaction_id, determination_id, line_type, base_cents, tax_cents, tax_code, elster_key, oss_country_code, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    period,
    bankTransactionId,
    determination.id,
    lineType,
    Math.abs(netCents),
    Math.abs(taxCents),
    determination.tax_code,
    elsterRow?.elster_key ?? null,
    lineType === "oss_output" ? determination.country_code : null,
    nowIso(),
  );
}

function refreshPeriodReports(year: number) {
  const db = getDb();
  const periodPrefix = `${year}-%`;

  db.prepare("DELETE FROM vat_period_reports WHERE period LIKE ?").run(periodPrefix);

  const periodRows = db
    .prepare(
      `SELECT DISTINCT substr(booking_date, 1, 7) AS period
       FROM bank_transactions
       WHERE booking_date LIKE ?
       ORDER BY period ASC`,
    )
    .all(periodPrefix) as Array<{ period: string }>;

  for (const row of periodRows) {
    const period = row.period;

    const agg = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN line_type IN ('output_tax','reverse_charge_output','oss_output') THEN tax_cents ELSE 0 END), 0) AS output_tax_cents,
           COALESCE(SUM(CASE WHEN line_type IN ('input_tax','reverse_charge_input') THEN tax_cents ELSE 0 END), 0) AS input_tax_cents
         FROM vat_ledger_lines
         WHERE period = ?`,
      )
      .get(period) as { output_tax_cents: number; input_tax_cents: number };

    const uncertain = db
      .prepare(
        `SELECT
           COUNT(*) AS uncertain_case_count,
           COALESCE(SUM(ABS(bt.amount_cents) * 19 / 119), 0) AS uncertain_tax_cents
         FROM transaction_tax_determinations d
         JOIN bank_transactions bt ON bt.id = d.bank_transaction_id
         WHERE d.status = 'review_required'
           AND substr(bt.booking_date, 1, 7) = ?`,
      )
      .get(period) as { uncertain_case_count: number; uncertain_tax_cents: number };

    const outputTax = agg.output_tax_cents ?? 0;
    const inputTax = agg.input_tax_cents ?? 0;

    db.prepare(
      `INSERT INTO vat_period_reports
        (period, output_tax_cents, input_tax_cents, net_liability_cents, uncertain_case_count, uncertain_tax_cents, generated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      period,
      outputTax,
      inputTax,
      outputTax - inputTax,
      uncertain.uncertain_case_count ?? 0,
      Math.round(uncertain.uncertain_tax_cents ?? 0),
      nowIso(),
    );
  }
}

function determineTaxForTransaction(
  tx: { id: number; booking_date: string; amount_cents: number; purpose: string | null; counterparty_name: string | null },
  docs: Array<{
    id: number;
    source_type: string;
    gross_amount_cents: number | null;
    invoice_number: string | null;
    metadata_json: string | null;
  }>,
): DeterminationInput {
  const text = `${tx.purpose ?? ""} ${tx.counterparty_name ?? ""}`.toLowerCase();
  const hasUsaHint = /\busa\b|united states|\bus\b/.test(text);
  const hasOssHint = docs.some((doc) => {
    if (!doc.metadata_json) {
      return false;
    }
    try {
      const parsed = JSON.parse(doc.metadata_json) as Record<string, unknown>;
      return typeof parsed.oss_country_code === "string";
    } catch {
      return false;
    }
  });
  const hasInvoiceEvidence = docs.some((doc) => Boolean(doc.invoice_number)) || docs.some((doc) => doc.gross_amount_cents !== null);

  const sourceSnapshot = {
    linkedDocuments: docs.length,
    purpose: tx.purpose,
    counterparty: tx.counterparty_name,
  };

  if (docs.length === 0) {
    return {
      status: "review_required",
      calculationMode: "auto",
      taxCode: null,
      taxRateBps: null,
      netAmountCents: null,
      taxAmountCents: null,
      countryCode: null,
      counterpartyVatId: null,
      evidenceLevel: "low",
      confidence: 0.05,
      reasonCodes: ["no_document"],
      sourceSnapshot,
      decidedBy: "tax-engine",
    };
  }

  if (hasUsaHint && tx.amount_cents > 0) {
    if (!hasInvoiceEvidence) {
      return {
        status: "review_required",
        calculationMode: "auto",
        taxCode: null,
        taxRateBps: null,
        netAmountCents: null,
        taxAmountCents: null,
        countryCode: "US",
        counterpartyVatId: null,
        evidenceLevel: "medium",
        confidence: 0.45,
        reasonCodes: ["third_country_without_strong_evidence"],
        sourceSnapshot,
        decidedBy: "tax-engine",
      };
    }

    return {
      status: "final",
      calculationMode: "auto",
      taxCode: "THIRD_COUNTRY_EXPORT_0",
      taxRateBps: 0,
      netAmountCents: Math.abs(tx.amount_cents),
      taxAmountCents: 0,
      countryCode: "US",
      counterpartyVatId: null,
      evidenceLevel: "medium",
      confidence: 0.9,
      reasonCodes: ["third_country_export_with_invoice"],
      sourceSnapshot,
      decidedBy: "tax-engine",
    };
  }

  if (hasOssHint && tx.amount_cents > 0) {
    return {
      status: hasInvoiceEvidence ? "final" : "review_required",
      calculationMode: "auto",
      taxCode: hasInvoiceEvidence ? "EU_B2C_OSS_STD" : null,
      taxRateBps: 0,
      netAmountCents: Math.abs(tx.amount_cents),
      taxAmountCents: 0,
      countryCode: null,
      counterpartyVatId: null,
      evidenceLevel: hasInvoiceEvidence ? "medium" : "low",
      confidence: hasInvoiceEvidence ? 0.75 : 0.35,
      reasonCodes: ["oss_signal_detected"],
      sourceSnapshot,
      decidedBy: "tax-engine",
    };
  }

  if (!hasInvoiceEvidence) {
    return {
      status: "review_required",
      calculationMode: "auto",
      taxCode: null,
      taxRateBps: null,
      netAmountCents: null,
      taxAmountCents: null,
      countryCode: null,
      counterpartyVatId: null,
      evidenceLevel: "low",
      confidence: 0.2,
      reasonCodes: ["document_without_tax_fields"],
      sourceSnapshot,
      decidedBy: "tax-engine",
    };
  }

  const taxCode = tx.amount_cents >= 0 ? "DE_OUTPUT_19" : "DE_INPUT_19";
  const rate = 1900;
  const computed = computeTaxFromGross(tx.amount_cents, rate);

  return {
    status: "final",
    calculationMode: "auto",
    taxCode,
    taxRateBps: rate,
    netAmountCents: computed.netCents,
    taxAmountCents: computed.taxCents,
    countryCode: "DE",
    counterpartyVatId: null,
    evidenceLevel: "high",
    confidence: 0.92,
    reasonCodes: ["invoice_evidence", "default_domestic_19"],
    sourceSnapshot,
    decidedBy: "tax-engine",
  };
}

function upsertDetermination(bankTransactionId: number, payload: DeterminationInput) {
  const db = getDb();
  const now = nowIso();

  db.prepare(
    `INSERT INTO transaction_tax_determinations
      (bank_transaction_id, status, tax_code, tax_rate_bps, is_gross_amount, net_amount_cents, tax_amount_cents,
       country_code, counterparty_vat_id, evidence_level, confidence, calculation_mode, reason_codes_json, source_snapshot_json,
       decided_at, decided_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(bank_transaction_id)
     DO UPDATE SET
       status = excluded.status,
       tax_code = excluded.tax_code,
       tax_rate_bps = excluded.tax_rate_bps,
       net_amount_cents = excluded.net_amount_cents,
       tax_amount_cents = excluded.tax_amount_cents,
       country_code = excluded.country_code,
       counterparty_vat_id = excluded.counterparty_vat_id,
       evidence_level = excluded.evidence_level,
       confidence = excluded.confidence,
       calculation_mode = excluded.calculation_mode,
       reason_codes_json = excluded.reason_codes_json,
       source_snapshot_json = excluded.source_snapshot_json,
       decided_at = excluded.decided_at,
       decided_by = excluded.decided_by,
       updated_at = excluded.updated_at`,
  ).run(
    bankTransactionId,
    payload.status,
    payload.taxCode,
    payload.taxRateBps,
    payload.netAmountCents,
    payload.taxAmountCents,
    payload.countryCode,
    payload.counterpartyVatId,
    payload.evidenceLevel,
    payload.confidence,
    payload.calculationMode,
    JSON.stringify(payload.reasonCodes),
    JSON.stringify(payload.sourceSnapshot),
    now,
    payload.decidedBy,
    now,
    now,
  );
}

type RecomputeFromLinksOptions = {
  forceFinalIfNoErrors?: boolean;
};

type RecomputeFromLinksResult = {
  transaction_id: number;
  skipped_manual_final: boolean;
  forced_final: boolean;
  determination: Record<string, unknown> | null;
};

export function recomputeTaxFromLinksForTransaction(
  txId: number,
  options: RecomputeFromLinksOptions = {},
): RecomputeFromLinksResult {
  if (!Number.isInteger(txId) || txId <= 0) {
    throw new ValidationError("Ungültige Transaktions-ID");
  }

  const db = getDb();
  const tx = db
    .prepare(
      `SELECT id, booking_date, amount_cents, purpose, counterparty_name
       FROM bank_transactions
       WHERE id = ?`,
    )
    .get(txId) as
    | {
        id: number;
        booking_date: string;
        amount_cents: number;
        purpose: string | null;
        counterparty_name: string | null;
      }
    | undefined;

  if (!tx) {
    throw new ValidationError("Transaktion nicht gefunden");
  }

  const existing = db
    .prepare(
      `SELECT status, decided_by
       FROM transaction_tax_determinations
       WHERE bank_transaction_id = ?`,
    )
    .get(txId) as { status: DeterminationStatus; decided_by: string | null } | undefined;

  if (existing?.status === "final" && existing.decided_by && existing.decided_by !== "tax-engine") {
    const existingDetermination = db
      .prepare("SELECT * FROM transaction_tax_determinations WHERE bank_transaction_id = ?")
      .get(txId) as Record<string, unknown> | undefined;
    return {
      transaction_id: txId,
      skipped_manual_final: true,
      forced_final: false,
      determination: existingDetermination ?? null,
    };
  }

  const docs = db
    .prepare(
      `SELECT d.id, d.source_type, d.gross_amount_cents, d.invoice_number, d.metadata_json
       FROM transaction_document_links l
       JOIN documents d ON d.id = l.document_id
       WHERE l.bank_transaction_id = ?
         AND l.is_active = 1`,
    )
    .all(txId) as Array<{
    id: number;
    source_type: string;
    gross_amount_cents: number | null;
    invoice_number: string | null;
    metadata_json: string | null;
  }>;

  let determination = determineTaxForTransaction(tx, docs);
  let forcedFinal = false;

  if (options.forceFinalIfNoErrors && determination.status !== "final") {
    const fallbackTaxCode = determination.taxCode ?? (tx.amount_cents >= 0 ? "DE_OUTPUT_19" : "DE_INPUT_19");
    const fallbackRateBps = determination.taxRateBps ?? getTaxRateBpsForCode(fallbackTaxCode);
    const computed = computeTaxFromGross(tx.amount_cents, fallbackRateBps);
    determination = {
      ...determination,
      status: "final",
      taxCode: fallbackTaxCode,
      taxRateBps: fallbackRateBps,
      netAmountCents: determination.netAmountCents ?? computed.netCents,
      taxAmountCents: determination.taxAmountCents ?? computed.taxCents,
      evidenceLevel: determination.evidenceLevel === "low" ? "medium" : determination.evidenceLevel,
      confidence: Math.max(determination.confidence, 0.75),
      reasonCodes: Array.from(new Set([...determination.reasonCodes, "auto_finalize_on_link"])),
      decidedBy: "tax-engine",
    };
    forcedFinal = true;
  }

  upsertDetermination(txId, determination);
  rebuildLedgerForTransaction(txId);

  const year = Number.parseInt(tx.booking_date.slice(0, 4), 10);
  refreshPeriodReports(year);

  const savedDetermination = db
    .prepare("SELECT * FROM transaction_tax_determinations WHERE bank_transaction_id = ?")
    .get(txId) as Record<string, unknown> | undefined;

  return {
    transaction_id: txId,
    skipped_manual_final: false,
    forced_final: forcedFinal,
    determination: savedDetermination ?? null,
  };
}

router.post("/recompute", (req, res) => {
  try {
    const input = recomputeBodySchema.parse(req.body);
    const db = getDb();
    const periodPrefix = `${input.year}-%`;

    const txRows = db
      .prepare(
        `SELECT id, booking_date, amount_cents, purpose, counterparty_name
         FROM bank_transactions
         WHERE booking_date LIKE ?
         ORDER BY booking_date ASC, id ASC`,
      )
      .all(periodPrefix) as Array<{
      id: number;
      booking_date: string;
      amount_cents: number;
      purpose: string | null;
      counterparty_name: string | null;
    }>;

    let finalCount = 0;
    let reviewCount = 0;
    let skippedManualCount = 0;

    const run = db.transaction(() => {
      db.prepare("DELETE FROM vat_ledger_lines WHERE period LIKE ?").run(periodPrefix);

      for (const tx of txRows) {
        const existing = db
          .prepare(
            `SELECT status, decided_by
             FROM transaction_tax_determinations
             WHERE bank_transaction_id = ?`,
          )
          .get(tx.id) as { status: DeterminationStatus; decided_by: string | null } | undefined;

        if (existing?.status === "final" && existing.decided_by && existing.decided_by !== "tax-engine") {
          skippedManualCount += 1;
          rebuildLedgerForTransaction(tx.id);
          continue;
        }

        const docs = db
          .prepare(
            `SELECT d.id, d.source_type, d.gross_amount_cents, d.invoice_number, d.metadata_json
             FROM transaction_document_links l
             JOIN documents d ON d.id = l.document_id
             WHERE l.bank_transaction_id = ?
               AND l.is_active = 1`,
          )
          .all(tx.id) as Array<{
          id: number;
          source_type: string;
          gross_amount_cents: number | null;
          invoice_number: string | null;
          metadata_json: string | null;
        }>;

        const determination = determineTaxForTransaction(tx, docs);
        if (determination.status === "final") {
          finalCount += 1;
        } else if (determination.status === "review_required") {
          reviewCount += 1;
        }

        upsertDetermination(tx.id, determination);
        rebuildLedgerForTransaction(tx.id);
      }

      refreshPeriodReports(input.year);
    });

    run();

    res.json({
      year: input.year,
      processed: txRows.length,
      final_count: finalCount,
      review_count: reviewCount,
      skipped_manual_final_count: skippedManualCount,
    });
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/reports/monthly", (req, res) => {
  try {
    const query = validateQuery(monthlyReportQuerySchema, req.query);
    const db = getDb();

    const rows = db
      .prepare(
        `SELECT period, output_tax_cents, input_tax_cents, net_liability_cents, uncertain_case_count, uncertain_tax_cents, generated_at
         FROM vat_period_reports
         WHERE period LIKE ?
         ORDER BY period ASC`,
      )
      .all(`${query.year}-%`);

    const totals = db
      .prepare(
        `SELECT
           COALESCE(SUM(output_tax_cents), 0) AS output_tax_cents,
           COALESCE(SUM(input_tax_cents), 0) AS input_tax_cents,
           COALESCE(SUM(net_liability_cents), 0) AS net_liability_cents,
           COALESCE(SUM(uncertain_case_count), 0) AS uncertain_case_count,
           COALESCE(SUM(uncertain_tax_cents), 0) AS uncertain_tax_cents
         FROM vat_period_reports
         WHERE period LIKE ?`,
      )
      .get(`${query.year}-%`);

    res.json({
      year: query.year,
      items: rows,
      totals,
    });
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/reports/oss", (req, res) => {
  try {
    const query = validateQuery(monthlyReportQuerySchema, req.query);
    const db = getDb();

    const rows = db
      .prepare(
        `SELECT
           period,
           COALESCE(oss_country_code, 'UNSPECIFIED') AS oss_country_code,
           COALESCE(SUM(base_cents), 0) AS base_cents,
           COALESCE(SUM(tax_cents), 0) AS tax_cents,
           COUNT(*) AS line_count
         FROM vat_ledger_lines
         WHERE period LIKE ?
           AND line_type = 'oss_output'
         GROUP BY period, COALESCE(oss_country_code, 'UNSPECIFIED')
         ORDER BY period ASC, oss_country_code ASC`,
      )
      .all(`${query.year}-%`);

    res.json({
      year: query.year,
      items: rows,
    });
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/review-queue", (req, res) => {
  try {
    const query = validateQuery(reviewQueueQuerySchema, req.query);
    const db = getDb();

    const clauses: string[] = ["d.status = ?"];
    const params: unknown[] = [query.status];

    if (query.period) {
      clauses.push("substr(bt.booking_date, 1, 7) = ?");
      params.push(query.period);
    }

    const whereSql = `WHERE ${clauses.join(" AND ")}`;
    const offset = (query.page - 1) * query.pageSize;

    const totalRow = db
      .prepare(
        `SELECT COUNT(*) AS total
         FROM transaction_tax_determinations d
         JOIN bank_transactions bt ON bt.id = d.bank_transaction_id
         ${whereSql}`,
      )
      .get(...params) as { total: number };

    const items = db
      .prepare(
        `SELECT
           d.id,
           d.bank_transaction_id,
           d.status,
           d.tax_code,
           d.tax_rate_bps,
           d.net_amount_cents,
           d.tax_amount_cents,
           d.country_code,
           d.evidence_level,
           d.confidence,
           d.calculation_mode,
           d.reason_codes_json,
           d.updated_at,
           bt.booking_date,
           bt.amount_cents,
           bt.purpose,
           bt.counterparty_name,
           COALESCE(doc_counts.doc_count, 0) AS linked_document_count
         FROM transaction_tax_determinations d
         JOIN bank_transactions bt ON bt.id = d.bank_transaction_id
         LEFT JOIN (
           SELECT l.bank_transaction_id, COUNT(*) AS doc_count
           FROM transaction_document_links l
           WHERE l.is_active = 1
           GROUP BY l.bank_transaction_id
         ) doc_counts ON doc_counts.bank_transaction_id = bt.id
         ${whereSql}
         ORDER BY d.confidence ASC, bt.booking_date ASC, bt.id ASC
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

router.post("/transactions/:id/recompute-from-links", (req, res) => {
  try {
    const txId = Number(req.params.id);
    const result = recomputeTaxFromLinksForTransaction(txId, { forceFinalIfNoErrors: true });
    res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    sendError(res, error);
  }
});

router.patch("/transactions/:id/determination", (req, res) => {
  try {
    const txId = Number(req.params.id);
    if (!Number.isInteger(txId) || txId <= 0) {
      throw new ValidationError("Ungültige Transaktions-ID");
    }

    const payload = patchDeterminationSchema.parse(req.body);
    const db = getDb();

    const tx = db
      .prepare("SELECT id, amount_cents FROM bank_transactions WHERE id = ?")
      .get(txId) as { id: number; amount_cents: number } | undefined;

    if (!tx) {
      throw new ValidationError("Transaktion nicht gefunden");
    }

    const existing = db
      .prepare(
        `SELECT
           tax_code,
           tax_rate_bps,
           net_amount_cents,
           tax_amount_cents,
           country_code,
           counterparty_vat_id,
           evidence_level,
           confidence,
           calculation_mode,
           reason_codes_json,
           source_snapshot_json
         FROM transaction_tax_determinations
         WHERE bank_transaction_id = ?`,
      )
      .get(txId) as
      | {
          tax_code: string | null;
          tax_rate_bps: number | null;
          net_amount_cents: number | null;
          tax_amount_cents: number | null;
          country_code: string | null;
          counterparty_vat_id: string | null;
          evidence_level: "low" | "medium" | "high";
          confidence: number;
          calculation_mode: "auto" | "manual";
          reason_codes_json: string;
          source_snapshot_json: string;
        }
      | undefined;

    const taxCode = payload.taxCode === undefined ? (existing?.tax_code ?? null) : payload.taxCode;
    const rateBps = payload.taxRateBps === undefined ? (existing?.tax_rate_bps ?? getTaxRateBpsForCode(taxCode)) : payload.taxRateBps;

    const calculationMode = payload.calculationMode ?? existing?.calculation_mode ?? "auto";
    const computed = computeTaxFromGross(tx.amount_cents, rateBps ?? 0);
    let netAmountCents = payload.netAmountCents === undefined ? (existing?.net_amount_cents ?? computed.netCents) : payload.netAmountCents;
    let taxAmountCents = payload.taxAmountCents === undefined ? (existing?.tax_amount_cents ?? computed.taxCents) : payload.taxAmountCents;

    if (payload.status === "final") {
      const mergedRate = rateBps ?? getTaxRateBpsForCode(taxCode);
      const hasAutoBasis = taxCode !== null && mergedRate !== null;
      const hasManualBasis = netAmountCents !== null && taxAmountCents !== null;

      if (!hasAutoBasis && !hasManualBasis) {
        throw new ValidationError(
          "Für finalen Steuerstatus müssen entweder Tax-Code+Satz oder Netto+MwSt gesetzt sein.",
        );
      }

      if (calculationMode === "auto") {
        if (!hasAutoBasis) {
          throw new ValidationError("Im Auto-Modus müssen Tax-Code und Steuersatz gesetzt sein.");
        }
        const autoComputed = computeTaxFromGross(tx.amount_cents, mergedRate ?? 0);
        netAmountCents = autoComputed.netCents;
        taxAmountCents = autoComputed.taxCents;
      }

      if (netAmountCents === null || taxAmountCents === null) {
        throw new ValidationError("Netto- und MwSt-Betrag sind für finalen Status erforderlich.");
      }
      if (netAmountCents < 0 || taxAmountCents < 0) {
        throw new ValidationError("Netto- und MwSt-Betrag müssen >= 0 sein.");
      }

      const diff = Math.abs(netAmountCents + taxAmountCents - Math.abs(tx.amount_cents));
      if (diff > 1) {
        throw new ValidationError("Netto + MwSt passt nicht zum Transaktionsbetrag (Toleranz 1 Cent).");
      }
    }

    upsertDetermination(txId, {
      status: payload.status,
      calculationMode,
      taxCode,
      taxRateBps: rateBps,
      netAmountCents,
      taxAmountCents,
      countryCode: payload.countryCode === undefined ? (existing?.country_code ?? null) : payload.countryCode,
      counterpartyVatId:
        payload.counterpartyVatId === undefined ? (existing?.counterparty_vat_id ?? null) : payload.counterpartyVatId,
      evidenceLevel: payload.evidenceLevel ?? existing?.evidence_level ?? "medium",
      confidence: payload.confidence ?? existing?.confidence ?? 0.5,
      reasonCodes: payload.reasonCodes ?? (existing ? (JSON.parse(existing.reason_codes_json) as string[]) : ["manual_override"]),
      sourceSnapshot: existing ? (JSON.parse(existing.source_snapshot_json) as Record<string, unknown>) : {},
      decidedBy: "dashboard-manual",
    });

    rebuildLedgerForTransaction(txId);

    const year = Number.parseInt(
      (db.prepare("SELECT booking_date FROM bank_transactions WHERE id = ?").get(txId) as { booking_date: string }).booking_date.slice(0, 4),
      10,
    );
    refreshPeriodReports(year);

    const determination = db
      .prepare("SELECT * FROM transaction_tax_determinations WHERE bank_transaction_id = ?")
      .get(txId);

    res.json({
      ok: true,
      transaction_id: txId,
      determination,
    });
  } catch (error) {
    sendError(res, error);
  }
});

export default router;
