import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Router, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { getDb } from "../db/connection.js";
import { ValidationError, isoDateSchema, validateQuery } from "../lib/validation.js";

const execFileAsync = promisify(execFile);
const router = Router();

const projectRoot = path.resolve(fileURLToPath(new URL("../../../../../", import.meta.url)));
const documentsRoot = path.join(projectRoot, "belege");
const tempUploadRoot = path.join(projectRoot, "belege", "_mobile_scan_tmp");

const maxUploadBytes = Number(process.env.MOBILE_SCAN_MAX_UPLOAD_MB ?? "30") * 1024 * 1024;
const duplicateThreshold = Number(process.env.MOBILE_SCAN_DUPLICATE_THRESHOLD ?? "0.86");
const reviewConfidenceThreshold = Number(process.env.MOBILE_SCAN_MIN_CONFIDENCE ?? "0.70");
const modelName = process.env.AI_MODEL ?? "gpt-5.3-codex";
const pendingTtlMs = 60 * 60 * 1000;

const analyzePayloadSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  clientScanId: z.string().trim().min(1).max(120).optional(),
  sessionId: z.string().trim().min(1).max(120).optional(),
  deviceInfo: z.string().trim().max(160).optional(),
});

const nullableTrimmedString = z
  .string()
  .trim()
  .transform((value) => (value.length > 0 ? value : null))
  .nullable()
  .optional();

const commitPayloadSchema = z.object({
  analysisId: z.string().uuid(),
  corrections: z
    .object({
      documentDate: isoDateSchema.nullable().optional(),
      grossAmountCents: z.number().int().nullable().optional(),
      netAmountCents: z.number().int().nullable().optional(),
      vatAmountCents: z.number().int().nullable().optional(),
      vatRateBps: z.number().int().min(0).max(10000).nullable().optional(),
      issuerName: nullableTrimmedString,
      invoiceNumber: nullableTrimmedString,
      subject: nullableTrimmedString,
      summaryShort: nullableTrimmedString,
    })
    .optional(),
});

const recentQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

const extractedFieldsSchema = z.object({
  documentDate: isoDateSchema.nullable(),
  grossAmountCents: z.number().int().nullable(),
  netAmountCents: z.number().int().nullable(),
  vatAmountCents: z.number().int().nullable(),
  vatRateBps: z.number().int().min(0).max(10000).nullable(),
  issuerName: z.string().trim().max(200).nullable(),
  invoiceNumber: z.string().trim().max(120).nullable(),
  subject: z.string().trim().max(200).nullable(),
  summaryShort: z.string().trim().max(400).nullable(),
  confidence: z.number().min(0).max(1),
  ocrConfidence: z.number().min(0).max(1).nullable(),
  notes: z.array(z.string().trim().min(1).max(200)).default([]),
});

type ExtractedFields = z.infer<typeof extractedFieldsSchema>;

type DuplicateResult = {
  type: "none" | "exact" | "semantic";
  score: number | null;
  existingDocumentId: number | null;
};

type PendingAnalysis = {
  id: string;
  createdAtMs: number;
  year: number;
  clientScanId: string | null;
  sessionId: string | null;
  deviceInfo: string | null;
  pdfTempPath: string;
  previewTempPath: string;
  pdfSha256: string;
  previewSha256: string;
  pdfSizeBytes: number;
  previewSizeBytes: number;
  previewMimeType: string;
  extracted: ExtractedFields;
  duplicate: DuplicateResult;
  ocrText: string | null;
  captureTakenAt: string;
};

const pendingAnalyses = new Map<string, PendingAnalysis>();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxUploadBytes,
    files: 2,
  },
  fileFilter: (_req, file, cb) => {
    if (file.fieldname === "pdfFile") {
      if (file.mimetype !== "application/pdf") {
        cb(new ValidationError("pdfFile muss eine PDF-Datei sein."));
        return;
      }
      cb(null, true);
      return;
    }

    if (file.fieldname === "previewImage") {
      if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(file.mimetype)) {
        cb(new ValidationError("previewImage muss JPEG, PNG oder WEBP sein."));
        return;
      }
      cb(null, true);
      return;
    }

    cb(new ValidationError(`Unbekanntes Dateifeld: ${file.fieldname}`));
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

function ensureDirExists(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function cleanupExpiredPendingAnalyses(): void {
  const now = Date.now();
  for (const [key, pending] of pendingAnalyses.entries()) {
    if (now - pending.createdAtMs <= pendingTtlMs) {
      continue;
    }

    safeUnlink(pending.pdfTempPath);
    safeUnlink(pending.previewTempPath);
    pendingAnalyses.delete(key);
  }
}

function safeUnlink(filePath: string): void {
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // noop
  }
}

function computeSha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function normalizeStringForKey(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 64);
}

function buildDuplicateGroupKey(extracted: ExtractedFields): string | null {
  const datePart = extracted.documentDate ?? "";
  const amountPart = extracted.grossAmountCents !== null ? String(extracted.grossAmountCents) : "";
  const issuerPart = normalizeStringForKey(extracted.issuerName);
  const invoicePart = normalizeStringForKey(extracted.invoiceNumber);
  const joined = [datePart, amountPart, issuerPart, invoicePart].join("|");
  return joined === "|||" ? null : joined;
}

function determineReviewRequired(extracted: ExtractedFields): boolean {
  if (!extracted.documentDate || extracted.grossAmountCents === null || !extracted.subject || !extracted.summaryShort) {
    return true;
  }

  return extracted.confidence < reviewConfidenceThreshold;
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function authenticateRequest(req: Request, res: Response): boolean {
  const configuredToken = process.env.MOBILE_SCAN_API_TOKEN;
  if (!configuredToken) {
    res.status(503).json({
      error: {
        code: "mobile_scan_not_configured",
        message: "MOBILE_SCAN_API_TOKEN ist nicht gesetzt.",
      },
    });
    return false;
  }

  const requestToken = req.header("x-api-token");
  if (!requestToken || requestToken !== configuredToken) {
    res.status(401).json({
      error: {
        code: "unauthorized",
        message: "Ungültiger API-Token.",
      },
    });
    return false;
  }

  return true;
}

async function extractOcrTextFromPdf(pdfPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("pdftotext", ["-layout", pdfPath, "-"]);
    const normalized = stdout.trim();
    return normalized.length > 0 ? normalized.slice(0, 15_000) : null;
  } catch {
    return null;
  }
}

function parseAssistantJsonFromChatResponse(payload: unknown): unknown {
  const data = payload as Record<string, unknown>;
  const choices = Array.isArray(data.choices) ? data.choices : [];
  const first = choices.at(0) as Record<string, unknown> | undefined;
  const message = (first?.message ?? null) as Record<string, unknown> | null;

  if (message && typeof message.parsed === "object" && message.parsed !== null) {
    return message.parsed;
  }

  const content = message?.content;
  if (typeof content === "string") {
    return JSON.parse(content);
  }

  if (Array.isArray(content)) {
    const textChunks = content
      .map((item) => {
        if (!item || typeof item !== "object") {
          return "";
        }
        const record = item as Record<string, unknown>;
        if (typeof record.text === "string") {
          return record.text;
        }
        if (typeof record.content === "string") {
          return record.content;
        }
        return "";
      })
      .filter((value) => value.length > 0)
      .join("\n")
      .trim();

    if (textChunks.length > 0) {
      return JSON.parse(textChunks);
    }
  }

  throw new Error("Modelantwort enthält kein JSON.");
}

async function analyzeWithCodex(input: {
  previewBytes: Buffer;
  previewMimeType: string;
  ocrText: string | null;
}): Promise<ExtractedFields> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY ist nicht gesetzt.");
  }

  const jsonSchema = {
    name: "beleg_extraction",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        documentDate: { type: ["string", "null"], description: "Datum im Format YYYY-MM-DD oder null" },
        grossAmountCents: { type: ["integer", "null"] },
        netAmountCents: { type: ["integer", "null"] },
        vatAmountCents: { type: ["integer", "null"] },
        vatRateBps: { type: ["integer", "null"] },
        issuerName: { type: ["string", "null"] },
        invoiceNumber: { type: ["string", "null"] },
        subject: { type: ["string", "null"] },
        summaryShort: { type: ["string", "null"] },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        ocrConfidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
        notes: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: [
        "documentDate",
        "grossAmountCents",
        "netAmountCents",
        "vatAmountCents",
        "vatRateBps",
        "issuerName",
        "invoiceNumber",
        "subject",
        "summaryShort",
        "confidence",
        "ocrConfidence",
        "notes",
      ],
    },
  };

  const ocrBlock = input.ocrText ? `OCR-TEXT:\n${input.ocrText}` : "OCR-TEXT: (nicht verfügbar)";

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: modelName,
      temperature: 0,
      response_format: {
        type: "json_schema",
        json_schema: jsonSchema,
      },
      messages: [
        {
          role: "system",
          content:
            "Du extrahierst Daten aus deutschen Eingangsbelegen. Gib nur gültiges JSON laut Schema zurück. Beträge müssen in Cent als Ganzzahl geliefert werden.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                "Extrahiere: documentDate, gross/net/vat in Cent, vatRateBps, issuerName, invoiceNumber, subject, summaryShort.",
                "Wenn ein Feld nicht sicher ermittelbar ist, gib null zurück.",
                ocrBlock,
              ].join("\n\n"),
            },
            {
              type: "image_url",
              image_url: {
                url: `data:${input.previewMimeType};base64,${input.previewBytes.toString("base64")}`,
              },
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API Fehler (${response.status}): ${errorText.slice(0, 500)}`);
  }

  const payload = (await response.json()) as unknown;
  const parsed = parseAssistantJsonFromChatResponse(payload);
  const extracted = extractedFieldsSchema.parse(parsed);

  return {
    ...extracted,
    issuerName: normalizeNullableString(extracted.issuerName),
    invoiceNumber: normalizeNullableString(extracted.invoiceNumber),
    subject: normalizeNullableString(extracted.subject),
    summaryShort: normalizeNullableString(extracted.summaryShort),
  };
}

function findSemanticDuplicate(year: number, extracted: ExtractedFields): DuplicateResult {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, document_date, gross_amount_cents, issuer_name, invoice_number
       FROM documents
       WHERE year = ?
         AND lifecycle_status <> 'verworfen'
       ORDER BY id DESC
       LIMIT 500`,
    )
    .all(year) as Array<{
    id: number;
    document_date: string | null;
    gross_amount_cents: number | null;
    issuer_name: string | null;
    invoice_number: string | null;
  }>;

  const issuerNorm = normalizeStringForKey(extracted.issuerName);
  const invoiceNorm = normalizeStringForKey(extracted.invoiceNumber);

  let bestId: number | null = null;
  let bestScore = 0;

  for (const row of rows) {
    let score = 0;

    if (invoiceNorm.length > 0 && invoiceNorm === normalizeStringForKey(row.invoice_number)) {
      score += 0.55;
    }

    if (extracted.grossAmountCents !== null && row.gross_amount_cents === extracted.grossAmountCents) {
      score += 0.25;
    }

    if (extracted.documentDate && row.document_date === extracted.documentDate) {
      score += 0.15;
    }

    if (issuerNorm.length > 0 && issuerNorm === normalizeStringForKey(row.issuer_name)) {
      score += 0.15;
    }

    if (score > bestScore) {
      bestScore = score;
      bestId = row.id;
    }
  }

  if (bestId && bestScore >= duplicateThreshold) {
    return {
      type: "semantic",
      score: Number(bestScore.toFixed(4)),
      existingDocumentId: bestId,
    };
  }

  return {
    type: "none",
    score: null,
    existingDocumentId: null,
  };
}

function sendError(res: Response, error: unknown): void {
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

function moveToFinalLocation(tempPath: string, desiredPath: string): string {
  ensureDirExists(path.dirname(desiredPath));

  if (!fs.existsSync(desiredPath)) {
    fs.renameSync(tempPath, desiredPath);
    return desiredPath;
  }

  const parsed = path.parse(desiredPath);
  const fallbackPath = path.join(parsed.dir, `${parsed.name}_${randomUUID()}${parsed.ext}`);
  fs.renameSync(tempPath, fallbackPath);
  return fallbackPath;
}

router.post(
  "/mobile-scans/analyze",
  upload.fields([
    { name: "pdfFile", maxCount: 1 },
    { name: "previewImage", maxCount: 1 },
  ]),
  (req, res) => {
    void (async () => {
      let pdfTempPathForCleanup: string | null = null;
      let previewTempPathForCleanup: string | null = null;
      try {
        if (!authenticateRequest(req, res)) {
          return;
        }

        cleanupExpiredPendingAnalyses();

        const payload = analyzePayloadSchema.parse(req.body);
        const year = payload.year ?? 2023;

        const files = req.files as Record<string, Express.Multer.File[]> | undefined;
        const pdfFile = files?.pdfFile?.[0];
        const previewImage = files?.previewImage?.[0];

        if (!pdfFile || !previewImage) {
          throw new ValidationError("pdfFile und previewImage sind Pflichtfelder.");
        }

        const pdfSha256 = computeSha256(pdfFile.buffer);
        const previewSha256 = computeSha256(previewImage.buffer);

        const db = getDb();
        const exactDuplicate = db.prepare("SELECT id FROM documents WHERE file_sha256 = ?").get(pdfSha256) as
          | { id: number }
          | undefined;

        const captureTakenAt = nowIso();
        const tempDir = path.join(tempUploadRoot, String(year), captureTakenAt.slice(0, 10));
        ensureDirExists(tempDir);

        const analysisId = randomUUID();
        const pdfTempPath = path.join(tempDir, `${analysisId}_${pdfSha256}.pdf`);
        const previewExt = previewImage.mimetype === "image/png" ? ".png" : previewImage.mimetype === "image/webp" ? ".webp" : ".jpg";
        const previewTempPath = path.join(tempDir, `${analysisId}_${previewSha256}${previewExt}`);
        pdfTempPathForCleanup = pdfTempPath;
        previewTempPathForCleanup = previewTempPath;

        fs.writeFileSync(pdfTempPath, pdfFile.buffer, { flag: "wx" });
        fs.writeFileSync(previewTempPath, previewImage.buffer, { flag: "wx" });

        const ocrText = await extractOcrTextFromPdf(pdfTempPath);
        const extracted = await analyzeWithCodex({
          previewBytes: previewImage.buffer,
          previewMimeType: previewImage.mimetype,
          ocrText,
        });

        const duplicate = exactDuplicate
          ? ({ type: "exact", score: 1, existingDocumentId: exactDuplicate.id } as DuplicateResult)
          : findSemanticDuplicate(year, extracted);

        const pending: PendingAnalysis = {
          id: analysisId,
          createdAtMs: Date.now(),
          year,
          clientScanId: payload.clientScanId ?? null,
          sessionId: payload.sessionId ?? null,
          deviceInfo: payload.deviceInfo ?? null,
          pdfTempPath,
          previewTempPath,
          pdfSha256,
          previewSha256,
          pdfSizeBytes: pdfFile.size,
          previewSizeBytes: previewImage.size,
          previewMimeType: previewImage.mimetype,
          extracted,
          duplicate,
          ocrText,
          captureTakenAt,
        };

        pendingAnalyses.set(analysisId, pending);
        pdfTempPathForCleanup = null;
        previewTempPathForCleanup = null;

        res.json({
          analysisId,
          year,
          extracted,
          duplicate,
          reviewRequired: determineReviewRequired(extracted),
          model: modelName,
        });
      } catch (error) {
        if (pdfTempPathForCleanup) {
          safeUnlink(pdfTempPathForCleanup);
        }
        if (previewTempPathForCleanup) {
          safeUnlink(previewTempPathForCleanup);
        }
        sendError(res, error);
      }
    })();
  },
);

router.post("/mobile-scans/commit", (req, res) => {
  try {
    if (!authenticateRequest(req, res)) {
      return;
    }

    cleanupExpiredPendingAnalyses();

    const payload = commitPayloadSchema.parse(req.body);
    const pending = pendingAnalyses.get(payload.analysisId);
    if (!pending) {
      throw new ValidationError("Analyse nicht gefunden oder abgelaufen.");
    }

    if (pending.duplicate.type === "exact" && pending.duplicate.existingDocumentId) {
      const db = getDb();
      const existing = db.prepare("SELECT * FROM documents WHERE id = ?").get(pending.duplicate.existingDocumentId);

      pendingAnalyses.delete(payload.analysisId);
      safeUnlink(pending.pdfTempPath);
      safeUnlink(pending.previewTempPath);

      res.json({
        created: false,
        deduplicated: true,
        duplicateType: "exact",
        documentId: pending.duplicate.existingDocumentId,
        document: existing ?? null,
      });
      return;
    }

    const corrected: ExtractedFields = {
      ...pending.extracted,
      documentDate: payload.corrections?.documentDate ?? pending.extracted.documentDate,
      grossAmountCents: payload.corrections?.grossAmountCents ?? pending.extracted.grossAmountCents,
      netAmountCents: payload.corrections?.netAmountCents ?? pending.extracted.netAmountCents,
      vatAmountCents: payload.corrections?.vatAmountCents ?? pending.extracted.vatAmountCents,
      vatRateBps: payload.corrections?.vatRateBps ?? pending.extracted.vatRateBps,
      issuerName: payload.corrections?.issuerName ?? pending.extracted.issuerName,
      invoiceNumber: payload.corrections?.invoiceNumber ?? pending.extracted.invoiceNumber,
      subject: payload.corrections?.subject ?? pending.extracted.subject,
      summaryShort: payload.corrections?.summaryShort ?? pending.extracted.summaryShort,
    };

    const now = nowIso();
    const monthPart = (corrected.documentDate ?? pending.captureTakenAt.slice(0, 10)).slice(0, 7);
    const safeBase =
      sanitizeFilename(
        [corrected.issuerName, corrected.invoiceNumber, corrected.documentDate]
          .filter((value) => value && value.length > 0)
          .join("_"),
      ) || "beleg_scan";

    const relDir = path.join("belege", String(pending.year), "archiviert", "scan", monthPart);
    const relPdfPath = path.join(relDir, `${pending.pdfSha256}_${safeBase}.pdf`);
    const previewExt = pending.previewMimeType === "image/png" ? ".png" : pending.previewMimeType === "image/webp" ? ".webp" : ".jpg";
    const relPreviewPath = path.join(relDir, `${pending.previewSha256}_${safeBase}${previewExt}`);

    const finalPdfPath = moveToFinalLocation(pending.pdfTempPath, path.join(projectRoot, relPdfPath));
    const finalPreviewPath = moveToFinalLocation(pending.previewTempPath, path.join(projectRoot, relPreviewPath));

    const finalPdfRel = path.relative(projectRoot, finalPdfPath);
    const finalPreviewRel = path.relative(projectRoot, finalPreviewPath);
    const reviewRequired = determineReviewRequired(corrected) ? 1 : 0;
    const duplicateGroupKey = buildDuplicateGroupKey(corrected);

    const db = getDb();
    const insertResult = db
      .prepare(
        `INSERT INTO documents
          (
            year,
            source_type,
            lifecycle_status,
            storage_rel_path,
            original_filename,
            mime_type,
            file_size_bytes,
            file_sha256,
            document_date,
            issuer_name,
            invoice_number,
            gross_amount_cents,
            net_amount_cents,
            vat_amount_cents,
            vat_rate_bps,
            subject,
            summary_short,
            ocr_text,
            ocr_confidence,
            ai_confidence,
            duplicate_group_key,
            image_preview_rel_path,
            scan_session_id,
            capture_device_label,
            capture_taken_at,
            review_required,
            extraction_model,
            ocr_status,
            metadata_json,
            created_at,
            updated_at
          )
         VALUES (?, 'scan', 'archiviert', ?, ?, 'application/pdf', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        pending.year,
        finalPdfRel,
        "scan.pdf",
        pending.pdfSizeBytes,
        pending.pdfSha256,
        corrected.documentDate,
        corrected.issuerName,
        corrected.invoiceNumber,
        corrected.grossAmountCents,
        corrected.netAmountCents,
        corrected.vatAmountCents,
        corrected.vatRateBps,
        corrected.subject,
        corrected.summaryShort,
        pending.ocrText,
        corrected.ocrConfidence,
        corrected.confidence,
        duplicateGroupKey,
        finalPreviewRel,
        pending.sessionId,
        pending.deviceInfo,
        pending.captureTakenAt,
        reviewRequired,
        modelName,
        pending.ocrText ? "done" : "failed",
        JSON.stringify({
          source: "mobile_scan",
          analysis_id: pending.id,
          client_scan_id: pending.clientScanId,
          duplicate_candidate_type: pending.duplicate.type,
          duplicate_candidate_score: pending.duplicate.score,
          notes: corrected.notes,
        }),
        now,
        now,
      );

    const documentId = Number(insertResult.lastInsertRowid);
    const document = db.prepare("SELECT * FROM documents WHERE id = ?").get(documentId);

    pendingAnalyses.delete(payload.analysisId);

    res.json({
      created: true,
      deduplicated: pending.duplicate.type !== "none",
      duplicateType: pending.duplicate.type,
      documentId,
      reviewRequired: reviewRequired === 1,
      document,
    });
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/mobile-scans/recent", (req, res) => {
  try {
    if (!authenticateRequest(req, res)) {
      return;
    }

    const query = validateQuery(recentQuerySchema, req.query);
    const db = getDb();

    const params: unknown[] = [];
    const whereParts = ["source_type = 'scan'"];

    if (typeof query.year === "number") {
      whereParts.push("year = ?");
      params.push(query.year);
    }

    params.push(query.limit);

    const items = db
      .prepare(
        `SELECT
           id,
           year,
           created_at,
           document_date,
           issuer_name,
           invoice_number,
           gross_amount_cents,
           net_amount_cents,
           vat_amount_cents,
           subject,
           summary_short,
           review_required,
           storage_rel_path,
           image_preview_rel_path,
           scan_session_id,
           capture_device_label
         FROM documents
         WHERE ${whereParts.join(" AND ")}
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(...params);

    res.json({
      items,
      total: items.length,
    });
  } catch (error) {
    sendError(res, error);
  }
});

export default router;
