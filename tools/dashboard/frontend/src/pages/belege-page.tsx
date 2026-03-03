import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiGet, apiPatch, apiPost, apiPostFormData } from "@/lib/api";
import type {
  DocumentLinkedTransactionsResponse,
  DocumentListItem,
  DocumentMatchTransactionSuggestion,
  DocumentMatchTransactionsResponse,
  DocumentPatchPayload,
  DocumentPatchResponse,
  DocumentRescanResponse,
  DocumentStatus,
  DocumentsResponse,
} from "@/lib/types";
import { formatEuro, formatInt } from "@/lib/utils";

type DocumentDirection = "Eingehend" | "Ausgehend" | "Gemischt" | "Unklar";

type LinkDocumentToTransactionResponse = {
  ok: boolean;
  transaction_id: number;
  document_id: number;
  new_status: DocumentStatus;
};

type VatTreatment = "VAT_19" | "VAT_0" | "VAT_OSS" | "VAT_EXPORT" | "VAT_REVERSE_CHARGE" | "VAT_UNKNOWN";

type DocumentEditForm = {
  documentDate: string;
  issuerName: string;
  invoiceNumber: string;
  subject: string;
  summaryShort: string;
  grossAmountCents: string;
  netAmountCents: string;
  vatAmountCents: string;
  vatRateBps: string;
  vatTreatment: VatTreatment;
  countryCode: string;
  documentType: string;
  notesText: string;
  reviewRequired: boolean;
  ocrText: string;
  aiConfidence: string;
  ocrConfidence: string;
  changeReason: string;
};

const vatTreatmentOptions: Array<{ value: VatTreatment; label: string }> = [
  { value: "VAT_19", label: "VAT_19 (19% Inland)" },
  { value: "VAT_0", label: "VAT_0 (0%)" },
  { value: "VAT_OSS", label: "VAT_OSS" },
  { value: "VAT_EXPORT", label: "VAT_EXPORT" },
  { value: "VAT_REVERSE_CHARGE", label: "VAT_REVERSE_CHARGE" },
  { value: "VAT_UNKNOWN", label: "VAT_UNKNOWN" },
];

function formatDate(value: string | null): string {
  if (!value) {
    return "-";
  }
  const dateOnlyMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const year = Number.parseInt(dateOnlyMatch[1], 10);
    const month = Number.parseInt(dateOnlyMatch[2], 10) - 1;
    const day = Number.parseInt(dateOnlyMatch[3], 10);
    const parsed = new Date(year, month, day);
    if (!Number.isNaN(parsed.getTime())) {
      return new Intl.DateTimeFormat("de-DE", {
        dateStyle: "medium",
      }).format(parsed);
    }
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
  }).format(parsed);
}

function parseMetadataJson(value: string | null | undefined): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseReasonCodes(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .slice(0, 6);
  } catch {
    return [];
  }
}

function resolveVatTreatment(metadata: Record<string, unknown> | null): string | null {
  const value = metadata?.["vat_treatment"];
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

function resolveMetadataString(metadata: Record<string, unknown> | null, key: string): string | null {
  const value = metadata?.[key];
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

function resolveMetadataNotes(metadata: Record<string, unknown> | null): string[] {
  const value = metadata?.["notes"];
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 30);
}

function intToInput(value: number | null | undefined): string {
  return typeof value === "number" ? String(value) : "";
}

function floatToInput(value: number | null | undefined): string {
  return typeof value === "number" ? String(value) : "";
}

function buildEditForm(document: DocumentListItem): DocumentEditForm {
  const metadata = parseMetadataJson(document.metadata_json);
  const vatTreatment = resolveVatTreatment(metadata);
  const countryCode = resolveMetadataString(metadata, "country_code");
  const documentType = resolveMetadataString(metadata, "document_type");
  const notes = resolveMetadataNotes(metadata);

  return {
    documentDate: document.document_date ?? "",
    issuerName: document.issuer_name ?? "",
    invoiceNumber: document.invoice_number ?? "",
    subject: document.subject ?? "",
    summaryShort: document.summary_short ?? "",
    grossAmountCents: intToInput(document.gross_amount_cents),
    netAmountCents: intToInput(document.net_amount_cents),
    vatAmountCents: intToInput(document.vat_amount_cents),
    vatRateBps: intToInput(document.vat_rate_bps),
    vatTreatment: (vatTreatmentOptions.some((item) => item.value === vatTreatment) ? vatTreatment : "VAT_UNKNOWN") as VatTreatment,
    countryCode: countryCode ?? "",
    documentType: documentType ?? "",
    notesText: notes.join("\n"),
    reviewRequired: document.review_required === 1,
    ocrText: document.ocr_text ?? "",
    aiConfidence: floatToInput(document.ai_confidence),
    ocrConfidence: floatToInput(document.ocr_confidence),
    changeReason: "",
  };
}

function parseIntegerInput(raw: string, fieldLabel: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  if (!/^-?\d+$/.test(trimmed)) {
    throw new Error(`${fieldLabel} muss eine ganze Zahl sein.`);
  }
  return Number.parseInt(trimmed, 10);
}

function parseFloatInput(raw: string, fieldLabel: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldLabel} muss eine Zahl sein.`);
  }
  if (parsed < 0 || parsed > 1) {
    throw new Error(`${fieldLabel} muss zwischen 0 und 1 liegen.`);
  }
  return parsed;
}

function buildPatchPayload(form: DocumentEditForm): DocumentPatchPayload {
  const grossAmountCents = parseIntegerInput(form.grossAmountCents, "Brutto (Cent)");
  const netAmountCents = parseIntegerInput(form.netAmountCents, "Netto (Cent)");
  const vatAmountCents = parseIntegerInput(form.vatAmountCents, "MwSt (Cent)");
  const vatRateBps = parseIntegerInput(form.vatRateBps, "MwSt-Satz (bps)");
  const aiConfidence = parseFloatInput(form.aiConfidence, "AI Confidence");
  const ocrConfidence = parseFloatInput(form.ocrConfidence, "OCR Confidence");

  if (
    typeof grossAmountCents === "number" &&
    typeof netAmountCents === "number" &&
    typeof vatAmountCents === "number" &&
    Math.abs(grossAmountCents - (netAmountCents + vatAmountCents)) > 1
  ) {
    throw new Error("Brutto muss Netto + MwSt entsprechen (Toleranz 1 Cent).");
  }

  const notes = form.notesText
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 30);

  const countryCode = form.countryCode.trim();

  return {
    documentDate: form.documentDate.trim() || null,
    issuerName: form.issuerName.trim() || null,
    invoiceNumber: form.invoiceNumber.trim() || null,
    subject: form.subject.trim() || null,
    summaryShort: form.summaryShort.trim() || null,
    documentType: form.documentType.trim() || null,
    grossAmountCents,
    netAmountCents,
    vatAmountCents,
    vatRateBps,
    vatTreatment: form.vatTreatment,
    countryCode: countryCode ? countryCode.toUpperCase() : null,
    notes,
    reviewRequired: form.reviewRequired,
    ocrText: form.ocrText.trim() || null,
    aiConfidence,
    ocrConfidence,
    changeReason: form.changeReason.trim() || undefined,
  };
}

function resolveDirection(row: DocumentListItem, metadata: Record<string, unknown> | null): DocumentDirection {
  const inflowCount = row.linked_inflow_count ?? 0;
  const outflowCount = row.linked_outflow_count ?? 0;

  if (inflowCount > 0 && outflowCount === 0) {
    return "Eingehend";
  }
  if (outflowCount > 0 && inflowCount === 0) {
    return "Ausgehend";
  }
  if (inflowCount > 0 && outflowCount > 0) {
    return "Gemischt";
  }

  const documentType = typeof metadata?.["document_type"] === "string" ? metadata["document_type"].trim().toLowerCase() : "";
  if (documentType.includes("ausgang")) {
    return "Eingehend";
  }
  if (documentType.includes("eingang")) {
    return "Ausgehend";
  }
  return "Unklar";
}

function statusLabel(status: DocumentStatus): string {
  switch (status) {
    case "zugeordnet":
      return "Zugeordnet";
    case "in_klaerung":
      return "In Klärung";
    case "nicht_erforderlich":
      return "Nicht erforderlich";
    case "offen":
    default:
      return "Offen";
  }
}

function documentFileUrl(documentId: number): string {
  return `/api/documents/${documentId}/file`;
}

function transactionPageUrl(transactionId: number): string {
  return `/transactions?txId=${transactionId}`;
}

function isMapped(row: DocumentListItem): boolean {
  return row.linked_transactions_count > 0;
}

export function BelegePage() {
  const queryClient = useQueryClient();

  const [q, setQ] = useState("");
  const [yearInput, setYearInput] = useState("");
  const [lifecycleStatus, setLifecycleStatus] = useState("archiviert");
  const [mappedStatus, setMappedStatus] = useState("all");
  const [page, setPage] = useState(1);

  const [selectedDocument, setSelectedDocument] = useState<DocumentListItem | null>(null);
  const [txSuggestions, setTxSuggestions] = useState<DocumentMatchTransactionSuggestion[]>([]);
  const [txNotice, setTxNotice] = useState("");
  const [txError, setTxError] = useState("");
  const [rescanNotice, setRescanNotice] = useState("");
  const [rescanRawPdfFile, setRescanRawPdfFile] = useState<File | null>(null);
  const [rescanFileInputKey, setRescanFileInputKey] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<DocumentEditForm | null>(null);
  const [editNotice, setEditNotice] = useState("");
  const [editError, setEditError] = useState("");

  const params = useMemo(
    () => ({
      sourceType: "scan",
      lifecycleStatus: lifecycleStatus === "all" ? undefined : lifecycleStatus,
      mappedStatus: mappedStatus === "all" ? undefined : mappedStatus,
      year: yearInput.trim().length === 4 ? Number.parseInt(yearInput, 10) : undefined,
      q,
      page,
      pageSize: 50,
    }),
    [lifecycleStatus, mappedStatus, yearInput, q, page],
  );

  const belegeQuery = useQuery({
    queryKey: ["belege", params],
    queryFn: () => apiGet<DocumentsResponse>("/documents", params),
  });

  const linkedTransactionsQuery = useQuery({
    queryKey: ["document-linked-transactions", selectedDocument?.id],
    queryFn: () => apiGet<DocumentLinkedTransactionsResponse>(`/documents/${selectedDocument?.id}/linked-transactions`),
    enabled: selectedDocument !== null,
  });

  const refreshTxSuggestionsMutation = useMutation({
    mutationFn: () => {
      if (!selectedDocument) {
        throw new Error("Kein Beleg ausgewählt");
      }
      return apiPost<DocumentMatchTransactionsResponse>(`/documents/${selectedDocument.id}/match-transactions/refresh`, { limit: 8 });
    },
    onSuccess: (result) => {
      setTxError("");
      setTxSuggestions(result.suggestions);
      setTxNotice(result.candidate_count > 0 ? `${result.candidate_count} Transaktions-Kandidat(en) gefunden.` : "Keine passenden Transaktions-Kandidaten gefunden.");
    },
  });

  const linkDocumentMutation = useMutation({
    mutationFn: ({ transactionId }: { transactionId: number }) => {
      if (!selectedDocument) {
        throw new Error("Kein Beleg ausgewählt");
      }
      return apiPost<LinkDocumentToTransactionResponse>(`/transactions/${transactionId}/document-links`, {
        documentId: selectedDocument.id,
        linkRole: "primary",
      });
    },
    onSuccess: async (_result, variables) => {
      setTxError("");
      setTxNotice(`Beleg mit Transaktion #${variables.transactionId} verknüpft.`);
      setTxSuggestions((prev) => prev.filter((row) => row.transaction_id !== variables.transactionId));

      if (selectedDocument) {
        setSelectedDocument({
          ...selectedDocument,
          linked_transactions_count: selectedDocument.linked_transactions_count + 1,
        });
      }

      await queryClient.invalidateQueries({ queryKey: ["belege"] });
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
  });

  const rescanDocumentMutation = useMutation({
    mutationFn: () => {
      if (!selectedDocument) {
        throw new Error("Kein Beleg ausgewählt");
      }
      const formData = new FormData();
      if (rescanRawPdfFile) {
        formData.append("rawPdf", rescanRawPdfFile);
      }
      return apiPostFormData<DocumentRescanResponse>(`/documents/${selectedDocument.id}/rescan`, formData);
    },
    onMutate: () => {
      setRescanNotice("");
    },
    onSuccess: async (result) => {
      setTxError("");
      setRescanNotice(
        result.rescan.ocr_pages !== null
          ? `Beleg erfolgreich neu gescannt (${result.rescan.ocr_pages} Seite(n))${result.rescan.used_uploaded_pdf ? ", mit neuer Raw-PDF" : ""}.`
          : `Beleg erfolgreich neu gescannt${result.rescan.used_uploaded_pdf ? ", mit neuer Raw-PDF" : ""}.`,
      );
      setSelectedDocument((prev) => (prev ? { ...prev, ...result.document } : result.document));
      setEditForm(buildEditForm(result.document));
      setIsEditing(false);
      setRescanRawPdfFile(null);
      setRescanFileInputKey((prev) => prev + 1);
      await queryClient.invalidateQueries({ queryKey: ["belege"] });
    },
  });

  const saveDocumentMutation = useMutation({
    mutationFn: ({ payload }: { payload: DocumentPatchPayload }) => {
      if (!selectedDocument) {
        throw new Error("Kein Beleg ausgewählt");
      }
      return apiPatch<DocumentPatchResponse>(`/documents/${selectedDocument.id}`, payload);
    },
    onMutate: () => {
      setEditNotice("");
      setEditError("");
    },
    onSuccess: async (result) => {
      setSelectedDocument((prev) => (prev ? { ...prev, ...result.document } : result.document));
      setEditForm(buildEditForm(result.document));
      setIsEditing(false);

      const noticeParts = [`Beleg gespeichert (${result.changed_fields.length} Feld(er) geändert).`];
      if (result.expired_match_suggestions > 0) {
        noticeParts.push(`${result.expired_match_suggestions} Match-Vorschlag/Vorschläge wurden als veraltet markiert.`);
      }
      setEditNotice(noticeParts.join(" "));

      await queryClient.invalidateQueries({ queryKey: ["belege"] });
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["document-linked-transactions", result.document.id] });
    },
  });

  useEffect(() => {
    if (!selectedDocument) {
      setEditForm(null);
      return;
    }
    if (!isEditing) {
      setEditForm(buildEditForm(selectedDocument));
    }
  }, [isEditing, selectedDocument]);

  const data = belegeQuery.data;
  const totalPages = data ? Math.max(Math.ceil(data.total / data.pageSize), 1) : 1;
  const selectedMetadata = parseMetadataJson(selectedDocument?.metadata_json);
  const selectedVatTreatment = isEditing ? editForm?.vatTreatment ?? null : resolveVatTreatment(selectedMetadata);
  const selectedDirection = selectedDocument ? resolveDirection(selectedDocument, selectedMetadata) : "Unklar";
  const refreshTxError = refreshTxSuggestionsMutation.error instanceof Error ? refreshTxSuggestionsMutation.error.message : "";
  const linkTxError = linkDocumentMutation.error instanceof Error ? linkDocumentMutation.error.message : "";
  const rescanError = rescanDocumentMutation.error instanceof Error ? rescanDocumentMutation.error.message : "";
  const saveEditError = saveDocumentMutation.error instanceof Error ? saveDocumentMutation.error.message : "";
  const linkedTransactions = linkedTransactionsQuery.data?.items ?? [];

  function submitDocumentEdits() {
    if (!editForm) {
      setEditError("Keine Bearbeitungsdaten vorhanden.");
      return;
    }

    try {
      const payload = buildPatchPayload(editForm);
      setEditError("");
      saveDocumentMutation.mutate({ payload });
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Ungültige Eingaben.");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Belege</h2>
          <p className="text-sm text-muted-foreground">
            Importierte Scan-Belege aus `documents` (`source_type = scan`) mit Volltextsuche.
          </p>
        </div>
        <div className="grid gap-3 lg:grid-cols-4">
          <Input
            placeholder="Volltext: Dateiname, Aussteller, Rechnungsnr, Betreff, OCR, Metadata ..."
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
              setPage(1);
            }}
          />
          <Input
            placeholder="Jahr (z.B. 2023)"
            value={yearInput}
            onChange={(event) => {
              setYearInput(event.target.value.replace(/[^\d]/g, "").slice(0, 4));
              setPage(1);
            }}
          />
          <Select
            value={lifecycleStatus}
            onValueChange={(value) => {
              setLifecycleStatus(value);
              setPage(1);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Lifecycle" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="archiviert">Archiviert</SelectItem>
              <SelectItem value="inbox">Inbox</SelectItem>
              <SelectItem value="verworfen">Verworfen</SelectItem>
              <SelectItem value="all">Alle</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={mappedStatus}
            onValueChange={(value) => {
              setMappedStatus(value);
              setPage(1);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Zuordnung" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle</SelectItem>
              <SelectItem value="mapped">Nur zugeordnet</SelectItem>
              <SelectItem value="unmapped">Nur nicht zugeordnet</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Treffer: {formatInt(data?.total ?? 0)}</CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => Math.max(value - 1, 1))}>
              Zurück
            </Button>
            <Badge variant="secondary">
              Seite {page} / {totalPages}
            </Badge>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(value + 1, totalPages))}>
              Weiter
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table className="table-fixed text-xs">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[52px] px-2">ID</TableHead>
                <TableHead className="w-[104px] px-2">Belegdatum</TableHead>
                <TableHead className="w-[220px] px-2">Beleg</TableHead>
                <TableHead className="w-[180px] px-2">Aussteller / Nr</TableHead>
                <TableHead className="w-[170px] px-2">Betreff</TableHead>
                <TableHead className="w-[96px] px-2">Richtung</TableHead>
                <TableHead className="w-[126px] px-2">MwSt</TableHead>
                <TableHead className="w-[96px] px-2 text-right">Netto</TableHead>
                <TableHead className="w-[96px] px-2 text-right">Brutto</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.items ?? []).map((row) => {
                const metadata = parseMetadataJson(row.metadata_json);
                const vatTreatment = resolveVatTreatment(metadata);
                const direction = resolveDirection(row, metadata);
                const mapped = isMapped(row);
                return (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer"
                    onClick={() => {
                      setSelectedDocument(row);
                      setIsEditing(false);
                      setEditForm(buildEditForm(row));
                      setEditNotice("");
                      setEditError("");
                      setTxSuggestions([]);
                      setTxNotice("");
                      setTxError("");
                      setRescanNotice("");
                      setRescanRawPdfFile(null);
                      setRescanFileInputKey((prev) => prev + 1);
                      refreshTxSuggestionsMutation.reset();
                      linkDocumentMutation.reset();
                      rescanDocumentMutation.reset();
                      saveDocumentMutation.reset();
                    }}
                  >
                    <TableCell className="px-2 py-2 font-mono text-[11px]">{row.id}</TableCell>
                    <TableCell className="px-2 py-2 text-[11px]">{formatDate(row.document_date)}</TableCell>
                    <TableCell className="max-w-[220px] px-2 py-2">
                      <div className="flex items-center gap-1.5">
                        <p className="min-w-0 flex-1 truncate font-medium">
                          <a
                            href={documentFileUrl(row.id)}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(event) => event.stopPropagation()}
                            className="underline decoration-dotted underline-offset-2 hover:no-underline"
                          >
                            {row.original_filename ?? `Dokument ${row.id}`}
                          </a>
                        </p>
                        <Badge variant={mapped ? "secondary" : "outline"} className="px-1.5 py-0 text-[10px]">
                          {mapped ? "Zugeordnet" : "Offen"}
                        </Badge>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{row.storage_rel_path}</p>
                    </TableCell>
                    <TableCell className="max-w-[180px] px-2 py-2">
                      <p className="truncate">{row.issuer_name ?? "-"}</p>
                      <p className="truncate text-xs text-muted-foreground">{row.invoice_number ?? "-"}</p>
                    </TableCell>
                    <TableCell className="max-w-[170px] px-2 py-2">
                      <p className="truncate">{row.subject ?? row.summary_short ?? "-"}</p>
                    </TableCell>
                    <TableCell className="px-2 py-2">
                      <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                        {direction}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-2 py-2">
                      <div className="flex flex-wrap gap-1">
                        {vatTreatment ? (
                          <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                            {vatTreatment}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                        {typeof row.vat_rate_bps === "number" ? (
                          <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                            {(row.vat_rate_bps / 100).toFixed(2)}%
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="px-2 py-2 text-right font-medium">
                      {row.net_amount_cents === null || row.net_amount_cents === undefined ? "-" : formatEuro(row.net_amount_cents)}
                    </TableCell>
                    <TableCell className="px-2 py-2 text-right font-medium">
                      {row.gross_amount_cents === null ? "-" : formatEuro(row.gross_amount_cents)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {belegeQuery.isError ? <p className="mt-3 text-sm text-destructive">Belege konnten nicht geladen werden.</p> : null}
        </CardContent>
      </Card>

      <Sheet
        open={selectedDocument !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedDocument(null);
            setIsEditing(false);
            setEditForm(null);
            setEditNotice("");
            setEditError("");
            setTxSuggestions([]);
            setTxNotice("");
            setTxError("");
            setRescanNotice("");
            setRescanRawPdfFile(null);
            setRescanFileInputKey((prev) => prev + 1);
            refreshTxSuggestionsMutation.reset();
            linkDocumentMutation.reset();
            rescanDocumentMutation.reset();
            saveDocumentMutation.reset();
          }
        }}
      >
        <SheetContent className="flex flex-col overflow-hidden sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>Belegdetails</SheetTitle>
            <SheetDescription>Klicke auf "Auto Find Transaktion", um passende Banktransaktionen vorzuschlagen.</SheetDescription>
          </SheetHeader>

          {selectedDocument ? (
            <div className="mt-6 min-h-0 flex-1 space-y-5 overflow-y-auto pr-2 text-sm">
              <Card>
                <CardHeader>
                  <CardTitle>Beleg</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" size="sm" asChild>
                      <a href={documentFileUrl(selectedDocument.id)} target="_blank" rel="noreferrer">
                        PDF öffnen
                      </a>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={rescanDocumentMutation.isPending || isEditing || saveDocumentMutation.isPending}
                      onClick={() => rescanDocumentMutation.mutate()}
                    >
                      {rescanDocumentMutation.isPending ? "Rescan läuft ..." : "Rescan"}
                    </Button>
                    {!isEditing ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={saveDocumentMutation.isPending}
                        onClick={() => {
                          setIsEditing(true);
                          setEditNotice("");
                          setEditError("");
                        }}
                      >
                        Bearbeiten
                      </Button>
                    ) : (
                      <>
                        <Button size="sm" disabled={saveDocumentMutation.isPending} onClick={submitDocumentEdits}>
                          {saveDocumentMutation.isPending ? "Speichere ..." : "Speichern"}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={saveDocumentMutation.isPending}
                          onClick={() => {
                            setEditForm(buildEditForm(selectedDocument));
                            setIsEditing(false);
                            setEditNotice("");
                            setEditError("");
                            saveDocumentMutation.reset();
                          }}
                        >
                          Abbrechen
                        </Button>
                      </>
                    )}
                    <Badge variant="outline">{selectedDirection}</Badge>
                    <Badge variant="secondary">{selectedDocument.linked_transactions_count} verknüpft</Badge>
                    {selectedVatTreatment ? <Badge variant="outline">{selectedVatTreatment}</Badge> : null}
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Neue Raw-PDF vor Rescan (optional):</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        key={rescanFileInputKey}
                        type="file"
                        accept=".pdf,application/pdf"
                        className="max-w-sm"
                        disabled={isEditing || saveDocumentMutation.isPending}
                        onChange={(event) => {
                          const file = event.target.files?.[0] ?? null;
                          setRescanRawPdfFile(file);
                        }}
                      />
                      {rescanRawPdfFile ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setRescanRawPdfFile(null);
                            setRescanFileInputKey((prev) => prev + 1);
                          }}
                        >
                          Auswahl entfernen
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {editNotice ? <p className="text-xs text-muted-foreground">{editNotice}</p> : null}
                  {editError ? <p className="text-xs text-rose-700">{editError}</p> : null}
                  {saveEditError ? <p className="text-xs text-rose-700">{saveEditError}</p> : null}
                  {rescanNotice ? <p className="text-xs text-muted-foreground">{rescanNotice}</p> : null}
                  {rescanError ? <p className="text-xs text-rose-700">{rescanError}</p> : null}

                  {!isEditing || !editForm ? (
                    <div className="grid gap-2 md:grid-cols-2">
                      <p>
                        <span className="text-muted-foreground">ID:</span> {selectedDocument.id}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Belegdatum:</span> {formatDate(selectedDocument.document_date)}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Aussteller:</span> {selectedDocument.issuer_name ?? "-"}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Rechnungsnr:</span> {selectedDocument.invoice_number ?? "-"}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Netto:</span>{" "}
                        {selectedDocument.net_amount_cents === null || selectedDocument.net_amount_cents === undefined
                          ? "-"
                          : formatEuro(selectedDocument.net_amount_cents)}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Brutto:</span>{" "}
                        {selectedDocument.gross_amount_cents === null ? "-" : formatEuro(selectedDocument.gross_amount_cents)}
                      </p>
                      <p className="md:col-span-2">
                        <span className="text-muted-foreground">Betreff:</span> {selectedDocument.subject ?? selectedDocument.summary_short ?? "-"}
                      </p>
                      <p className="md:col-span-2 break-all text-muted-foreground">{selectedDocument.storage_rel_path}</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="grid gap-2 md:grid-cols-2">
                        <div className="space-y-1">
                          <p className="text-muted-foreground">Belegdatum (YYYY-MM-DD)</p>
                          <Input
                            value={editForm.documentDate}
                            onChange={(event) => setEditForm({ ...editForm, documentDate: event.target.value.trim() })}
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-muted-foreground">Aussteller</p>
                          <Input value={editForm.issuerName} onChange={(event) => setEditForm({ ...editForm, issuerName: event.target.value })} />
                        </div>
                        <div className="space-y-1">
                          <p className="text-muted-foreground">Rechnungsnummer</p>
                          <Input
                            value={editForm.invoiceNumber}
                            onChange={(event) => setEditForm({ ...editForm, invoiceNumber: event.target.value })}
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-muted-foreground">Belegtyp (Metadata)</p>
                          <Input
                            value={editForm.documentType}
                            onChange={(event) => setEditForm({ ...editForm, documentType: event.target.value })}
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-muted-foreground">Betreff</p>
                          <Input value={editForm.subject} onChange={(event) => setEditForm({ ...editForm, subject: event.target.value })} />
                        </div>
                        <div className="space-y-1">
                          <p className="text-muted-foreground">Kurzbeschreibung</p>
                          <Input
                            value={editForm.summaryShort}
                            onChange={(event) => setEditForm({ ...editForm, summaryShort: event.target.value })}
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-muted-foreground">Brutto (Cent)</p>
                          <Input
                            value={editForm.grossAmountCents}
                            onChange={(event) => setEditForm({ ...editForm, grossAmountCents: event.target.value })}
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-muted-foreground">Netto (Cent)</p>
                          <Input value={editForm.netAmountCents} onChange={(event) => setEditForm({ ...editForm, netAmountCents: event.target.value })} />
                        </div>
                        <div className="space-y-1">
                          <p className="text-muted-foreground">MwSt (Cent)</p>
                          <Input value={editForm.vatAmountCents} onChange={(event) => setEditForm({ ...editForm, vatAmountCents: event.target.value })} />
                        </div>
                        <div className="space-y-1">
                          <p className="text-muted-foreground">MwSt-Satz (bps)</p>
                          <Input value={editForm.vatRateBps} onChange={(event) => setEditForm({ ...editForm, vatRateBps: event.target.value })} />
                        </div>
                        <div className="space-y-1">
                          <p className="text-muted-foreground">VAT Treatment</p>
                          <Select
                            value={editForm.vatTreatment}
                            onValueChange={(value) => setEditForm({ ...editForm, vatTreatment: value as VatTreatment })}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {vatTreatmentOptions.map((item) => (
                                <SelectItem key={item.value} value={item.value}>
                                  {item.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <p className="text-muted-foreground">Land (ISO-2)</p>
                          <Input value={editForm.countryCode} onChange={(event) => setEditForm({ ...editForm, countryCode: event.target.value })} />
                        </div>
                        <div className="space-y-1">
                          <p className="text-muted-foreground">AI Confidence (0..1)</p>
                          <Input value={editForm.aiConfidence} onChange={(event) => setEditForm({ ...editForm, aiConfidence: event.target.value })} />
                        </div>
                        <div className="space-y-1">
                          <p className="text-muted-foreground">OCR Confidence (0..1)</p>
                          <Input value={editForm.ocrConfidence} onChange={(event) => setEditForm({ ...editForm, ocrConfidence: event.target.value })} />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <p className="text-muted-foreground">Notes (eine Zeile pro Note)</p>
                        <textarea
                          className="min-h-[84px] w-full rounded-md border border-input bg-background px-3 py-2 text-xs"
                          value={editForm.notesText}
                          onChange={(event) => setEditForm({ ...editForm, notesText: event.target.value })}
                        />
                      </div>
                      <div className="space-y-1">
                        <p className="text-muted-foreground">OCR Text</p>
                        <textarea
                          className="min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-xs"
                          value={editForm.ocrText}
                          onChange={(event) => setEditForm({ ...editForm, ocrText: event.target.value })}
                        />
                      </div>
                      <div className="space-y-1">
                        <p className="text-muted-foreground">Änderungsgrund (optional)</p>
                        <Input
                          value={editForm.changeReason}
                          onChange={(event) => setEditForm({ ...editForm, changeReason: event.target.value })}
                        />
                      </div>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={editForm.reviewRequired}
                          onChange={(event) => setEditForm({ ...editForm, reviewRequired: event.target.checked })}
                        />
                        <span>Review erforderlich</span>
                      </label>
                      <p className="break-all text-muted-foreground">{selectedDocument.storage_rel_path}</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Zugeordnete Transaktionen ({linkedTransactionsQuery.data?.total ?? 0})</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  {linkedTransactionsQuery.isLoading ? <p className="text-muted-foreground">Lade Transaktionen ...</p> : null}
                  {linkedTransactionsQuery.isError ? (
                    <p className="text-rose-700">Zugeordnete Transaktionen konnten nicht geladen werden.</p>
                  ) : null}
                  {!linkedTransactionsQuery.isLoading && !linkedTransactionsQuery.isError && linkedTransactions.length === 0 ? (
                    <p className="text-muted-foreground">Keine aktiven Transaktionen zugeordnet.</p>
                  ) : null}
                  {linkedTransactions.map((tx) => (
                    <div key={tx.link_id} className="space-y-1 rounded-md border p-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="space-y-0.5">
                          <p className="font-medium">Transaktion #{tx.transaction_id}</p>
                          <p className="text-muted-foreground">{tx.counterparty_name ?? tx.purpose ?? "-"}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge variant="secondary">{statusLabel(tx.document_status)}</Badge>
                          <Badge variant="outline">{tx.link_role}</Badge>
                        </div>
                      </div>
                      <div className="grid gap-1 md:grid-cols-2">
                        <p>
                          <span className="text-muted-foreground">Buchungstag:</span> {formatDate(tx.booking_date)}
                        </p>
                        <p>
                          <span className="text-muted-foreground">Betrag:</span> {formatEuro(tx.amount_cents)}
                        </p>
                      </div>
                      <div>
                        <Button variant="outline" size="sm" asChild>
                          <a href={transactionPageUrl(tx.transaction_id)} target="_blank" rel="noreferrer">
                            Transaktion öffnen
                          </a>
                        </Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>Auto Find Transaktion ({txSuggestions.length})</CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={refreshTxSuggestionsMutation.isPending}
                    onClick={() => refreshTxSuggestionsMutation.mutate()}
                  >
                    {refreshTxSuggestionsMutation.isPending ? "Suche ..." : "Auto Find Transaktion"}
                  </Button>
                </CardHeader>
                <CardContent className="space-y-3">
                  {txNotice ? <p className="text-xs text-muted-foreground">{txNotice}</p> : null}
                  {txError ? <p className="text-xs text-rose-700">{txError}</p> : null}
                  {refreshTxError ? <p className="text-xs text-rose-700">{refreshTxError}</p> : null}
                  {linkTxError ? <p className="text-xs text-rose-700">{linkTxError}</p> : null}

                  {txSuggestions.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Keine Vorschläge geladen. Mit "Auto Find Transaktion" wird für diesen Beleg gesucht.
                    </p>
                  ) : null}

                  {txSuggestions.map((suggestion) => {
                    const reasonCodes = parseReasonCodes(suggestion.reason_codes_json);
                    return (
                      <div key={suggestion.transaction_id} className="space-y-2 rounded-md border p-2 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="space-y-0.5">
                            <p className="font-medium">Transaktion #{suggestion.transaction_id}</p>
                            <p className="text-muted-foreground">{suggestion.counterparty_name ?? suggestion.purpose ?? "-"}</p>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            <Badge variant="outline">Score {(suggestion.score ?? 0).toFixed(2)}</Badge>
                            <Badge variant="secondary">{statusLabel(suggestion.document_status)}</Badge>
                          </div>
                        </div>

                        <div className="grid gap-2 md:grid-cols-2">
                          <p>
                            <span className="text-muted-foreground">Buchungstag:</span> {formatDate(suggestion.booking_date)}
                          </p>
                          <p>
                            <span className="text-muted-foreground">Betrag:</span> {formatEuro(suggestion.amount_cents)}
                          </p>
                          <p>
                            <span className="text-muted-foreground">Typ:</span> {suggestion.tx_type ?? "-"}
                          </p>
                          <p>
                            <span className="text-muted-foreground">Bereits verknüpft:</span> {suggestion.linked_documents_count}
                          </p>
                        </div>

                        {reasonCodes.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {reasonCodes.map((code) => (
                              <Badge key={`${suggestion.transaction_id}-${code}`} variant="secondary">
                                {code}
                              </Badge>
                            ))}
                          </div>
                        ) : null}

                        <div>
                          <Button
                            size="sm"
                            disabled={linkDocumentMutation.isPending}
                            onClick={() => linkDocumentMutation.mutate({ transactionId: suggestion.transaction_id })}
                          >
                            {linkDocumentMutation.isPending ? "Verknüpfe ..." : "Mit dieser Transaktion verknüpfen"}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
