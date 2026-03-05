import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DocumentPreviewPane } from "@/components/document-preview-pane";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type {
  DocumentLinkedTransaction,
  DocumentLinkedTransactionsResponse,
  DocumentListItem,
  DocumentMatchTransactionSuggestion,
  DocumentMatchTransactionsResponse,
  DocumentPatchPayload,
  DocumentPatchResponse,
  DocumentRescanResponse,
  DocumentStatus,
  DocumentDetailResponse,
} from "@/lib/types";
import { apiDelete, apiGet, apiPatch, apiPost, apiPostFormData } from "@/lib/api";
import { formatEuro } from "@/lib/utils";

type DocumentDirection = "Eingehend" | "Ausgehend" | "Gemischt" | "Unklar";

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

function formatMetaList(row: DocumentLinkedTransaction): string[] {
  return [row.counterparty_name, row.purpose, row.reference].filter((value) => typeof value === "string" && value.length > 0) as string[];
}

export function BelegDetailPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { documentId: documentIdParam } = useParams<{ documentId: string }>();

  const documentId = Number(documentIdParam);
  const hasDocumentId = Number.isInteger(documentId) && documentId > 0;

  const [selectedTransactionLinks, setSelectedTransactionLinks] = useState<DocumentMatchTransactionSuggestion[]>([]);
  const [txNotice, setTxNotice] = useState("");
  const [txError, setTxError] = useState("");
  const [rescanNotice, setRescanNotice] = useState("");
  const [rescanRawPdfFile, setRescanRawPdfFile] = useState<File | null>(null);
  const [rescanFileInputKey, setRescanFileInputKey] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<DocumentEditForm | null>(null);
  const [editNotice, setEditNotice] = useState("");
  const [editError, setEditError] = useState("");
  const [deleteError, setDeleteError] = useState("");

  const detailQuery = useQuery({
    queryKey: ["document-detail", documentId],
    queryFn: () => apiGet<DocumentDetailResponse>(`/documents/${documentId}`),
    enabled: hasDocumentId,
  });

  const linkedTransactionsQuery = useQuery({
    queryKey: ["document-linked-transactions", hasDocumentId ? documentId : null],
    queryFn: () => apiGet<DocumentLinkedTransactionsResponse>(`/documents/${documentId}/linked-transactions`),
    enabled: hasDocumentId,
  });

  const documentQuery = detailQuery.data;
  const document = documentQuery?.document;

  const linkedTransactions = linkedTransactionsQuery.data?.items ?? [];
  const selectedMetadata = parseMetadataJson(document?.metadata_json);
  const selectedDirection = document ? resolveDirection(document, selectedMetadata) : "Unklar";
  const selectedVatTreatment = isEditing ? editForm?.vatTreatment ?? null : resolveVatTreatment(selectedMetadata);
  const detailSearch = useMemo(() => {
    const values = searchParams.toString();
    return values ? `?${values}` : "";
  }, [searchParams]);
  const backUrl = detailSearch ? `/belege${detailSearch}` : "/belege";
  const fallbackTo = detailSearch ? detailSearch : "";

  const refreshTxSuggestionsMutation = useMutation({
    mutationFn: () => {
      if (!document) {
        throw new Error("Kein Beleg geladen");
      }
      return apiPost<DocumentMatchTransactionsResponse>(`/documents/${document.id}/match-transactions/refresh`, { limit: 8 });
    },
    onSuccess: (result) => {
      setTxError("");
      setSelectedTransactionLinks(result.suggestions);
      setTxNotice(result.candidate_count > 0 ? `${result.candidate_count} Transaktions-Kandidat(en) gefunden.` : "Keine passenden Transaktions-Kandidaten gefunden.");
    },
  });

  const deleteDocumentMutation = useMutation({
    mutationFn: () => {
      if (!document) {
        throw new Error("Kein Beleg geladen");
      }
      return apiDelete<{ ok: boolean; document_id: number }>(`/documents/${document.id}`);
    },
    onMutate: () => {
      setDeleteError("");
    },
    onSuccess: async () => {
      await queryClient.removeQueries({ queryKey: ["document-detail", documentId] });
      await queryClient.removeQueries({ queryKey: ["document-linked-transactions", documentId] });
      await queryClient.invalidateQueries({ queryKey: ["documents"] });
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      navigate(backUrl);
    },
    onError: (error) => {
      setDeleteError(error instanceof Error ? error.message : "Löschen fehlgeschlagen.");
    },
  });

  const linkDocumentMutation = useMutation({
    mutationFn: ({ transactionId }: { transactionId: number }) => {
      if (!document) {
        throw new Error("Kein Beleg geladen");
      }
      return apiPost<{ ok: boolean; transaction_id: number; document_id: number }>(`/transactions/${transactionId}/document-links`, {
        documentId: document.id,
        linkRole: "primary",
      });
    },
    onSuccess: async (_result, variables) => {
      setTxError("");
      setTxNotice(`Beleg mit Transaktion #${variables.transactionId} verknüpft.`);
      setSelectedTransactionLinks((prev) => prev.filter((row) => row.transaction_id !== variables.transactionId));
      await queryClient.invalidateQueries({ queryKey: ["document-detail", documentId] });
      await queryClient.invalidateQueries({ queryKey: ["document-linked-transactions", documentId] });
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
  });

  const rescanDocumentMutation = useMutation({
    mutationFn: () => {
      if (!document) {
        throw new Error("Kein Beleg geladen");
      }
      const formData = new FormData();
      if (rescanRawPdfFile) {
        formData.append("rawPdf", rescanRawPdfFile);
      }
      return apiPostFormData<DocumentRescanResponse>(`/documents/${document.id}/rescan`, formData);
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
      setRescanRawPdfFile(null);
      setRescanFileInputKey((prev) => prev + 1);
      await queryClient.invalidateQueries({ queryKey: ["document-detail", documentId] });
      await queryClient.invalidateQueries({ queryKey: ["document-linked-transactions", documentId] });
      await queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
  });

  const saveDocumentMutation = useMutation({
    mutationFn: ({ payload }: { payload: DocumentPatchPayload }) => {
      if (!document) {
        throw new Error("Kein Beleg geladen");
      }
      return apiPatch<DocumentPatchResponse>(`/documents/${document.id}`, payload);
    },
    onMutate: () => {
      setEditNotice("");
      setEditError("");
    },
    onSuccess: async (result) => {
      setEditNotice(`Beleg gespeichert (${result.changed_fields.length} Feld(er) geändert).`);
      await queryClient.invalidateQueries({ queryKey: ["document-detail", documentId] });
      await queryClient.invalidateQueries({ queryKey: ["document-linked-transactions", documentId] });
      await queryClient.invalidateQueries({ queryKey: ["documents"] });
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      setIsEditing(false);
    },
  });

  useEffect(() => {
    if (!document) {
      setEditForm(null);
      return;
    }
    if (!isEditing) {
      setEditForm(buildEditForm(document));
    }
  }, [document, isEditing]);

  const refreshTxError = refreshTxSuggestionsMutation.error instanceof Error ? refreshTxSuggestionsMutation.error.message : "";
  const linkTxError = linkDocumentMutation.error instanceof Error ? linkDocumentMutation.error.message : "";
  const rescanError = rescanDocumentMutation.error instanceof Error ? rescanDocumentMutation.error.message : "";
  const saveEditError = saveDocumentMutation.error instanceof Error ? saveDocumentMutation.error.message : "";
  const linkedCountLabel = document?.linked_transactions_count ?? 0;

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

  function handleDeleteDocument() {
    if (!document) {
      return;
    }
    if (
      !window.confirm(
        `Möchtest du den Beleg #${document.id} wirklich löschen? Alle Verknüpfungen werden entfernt und die Datei wird gelöscht. Diese Aktion kann nicht rückgängig gemacht werden.`,
      )
    ) {
      return;
    }
    deleteDocumentMutation.mutate();
  }

  if (!hasDocumentId) {
    return (
      <div className="space-y-4">
        <Button variant="outline" asChild>
          <Link to={backUrl}>Zurück zur Belegliste</Link>
        </Button>
        <p className="text-sm text-destructive">Ungültige Beleg-ID.</p>
      </div>
    );
  }

  if (detailQuery.isLoading && !document) {
    return <p className="text-sm text-muted-foreground">Lade Beleg ...</p>;
  }

  if (detailQuery.isError || !document) {
    return (
      <div className="space-y-4">
        <Button variant="outline" asChild>
          <Link to={backUrl}>Zurück zur Belegliste</Link>
        </Button>
        <p className="text-sm text-destructive">Beleg konnte nicht geladen werden.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Belegdetails #{document.id}</h2>
          <p className="text-sm text-muted-foreground">Detailansicht mit Metadaten und Dokumentvorschau.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="destructive" size="sm" disabled={deleteDocumentMutation.isPending} onClick={handleDeleteDocument}>
            {deleteDocumentMutation.isPending ? "Lösche ..." : "Beleg löschen"}
          </Button>
          <Button variant="outline" asChild>
            <Link to={backUrl}>Zurück</Link>
          </Button>
          <Button variant="outline" asChild>
            <a href={documentFileUrl(document.id)} target="_blank" rel="noreferrer">
              PDF öffnen
            </a>
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Beleg</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                {!isEditing ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isEditing || saveDocumentMutation.isPending}
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
                        setIsEditing(false);
                        setEditNotice("");
                        setEditError("");
                      }}
                    >
                      Abbrechen
                    </Button>
                  </>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  disabled={rescanDocumentMutation.isPending}
                  onClick={() => rescanDocumentMutation.mutate()}
                >
                  {rescanDocumentMutation.isPending ? "Rescan läuft ..." : "Rescan"}
                </Button>
                <Badge variant="outline">{selectedDirection}</Badge>
                <Badge variant="secondary">{linkedCountLabel} verknüpft</Badge>
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
              {deleteError ? <p className="text-xs text-rose-700">{deleteError}</p> : null}
              {rescanNotice ? <p className="text-xs text-muted-foreground">{rescanNotice}</p> : null}
              {rescanError ? <p className="text-xs text-rose-700">{rescanError}</p> : null}

              {!isEditing || !editForm ? (
                <div className="grid gap-2 md:grid-cols-2">
                  <p>
                    <span className="text-muted-foreground">ID:</span> {document.id}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Belegdatum:</span> {formatDate(document.document_date)}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Aussteller:</span> {document.issuer_name ?? "-"}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Rechnungsnr:</span> {document.invoice_number ?? "-"}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Netto:</span>{" "}
                    {document.net_amount_cents === null || document.net_amount_cents === undefined ? "-" : formatEuro(document.net_amount_cents)}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Brutto:</span>{" "}
                    {document.gross_amount_cents === null ? "-" : formatEuro(document.gross_amount_cents)}
                  </p>
                  <p className="md:col-span-2">
                    <span className="text-muted-foreground">Betreff:</span> {document.subject ?? document.summary_short ?? "-"}
                  </p>
                  <p className="md:col-span-2 break-all text-muted-foreground">{document.storage_rel_path}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid gap-2 md:grid-cols-2">
                    <div className="space-y-1">
                      <p className="text-muted-foreground">Belegdatum (YYYY-MM-DD)</p>
                      <Input value={editForm.documentDate} onChange={(event) => setEditForm({ ...editForm, documentDate: event.target.value.trim() })} />
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
                      <Input value={editForm.documentType} onChange={(event) => setEditForm({ ...editForm, documentType: event.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <p className="text-muted-foreground">Betreff</p>
                      <Input value={editForm.subject} onChange={(event) => setEditForm({ ...editForm, subject: event.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <p className="text-muted-foreground">Kurzbeschreibung</p>
                      <Input value={editForm.summaryShort} onChange={(event) => setEditForm({ ...editForm, summaryShort: event.target.value })} />
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
                    <Input value={editForm.changeReason} onChange={(event) => setEditForm({ ...editForm, changeReason: event.target.value })} />
                  </div>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={editForm.reviewRequired}
                      onChange={(event) => setEditForm({ ...editForm, reviewRequired: event.target.checked })}
                    />
                    <span>Review erforderlich</span>
                  </label>
                  <p className="break-all text-muted-foreground">{document.storage_rel_path}</p>
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
              {linkedTransactionsQuery.isError ? <p className="text-rose-700">Zugeordnete Transaktionen konnten nicht geladen werden.</p> : null}
              {!linkedTransactionsQuery.isLoading && !linkedTransactionsQuery.isError && linkedTransactions.length === 0 ? (
                <p className="text-muted-foreground">Keine aktiven Transaktionen zugeordnet.</p>
              ) : null}
              {linkedTransactions.map((tx) => (
                <div key={tx.link_id} className="space-y-1 rounded-md border p-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="space-y-0.5">
                      <p className="font-medium">Transaktion #{tx.transaction_id}</p>
                      <p className="text-muted-foreground">{formatMetaList(tx).join(" · ") || "-"}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge variant="secondary">{statusLabel(tx.document_status)}</Badge>
                      <Badge variant="outline">{tx.link_role}</Badge>
                      {tx.statement_doc_id ? <Badge variant="outline">{`Auszug #${tx.statement_doc_id}`}</Badge> : null}
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
                  <div className="flex flex-wrap items-center gap-1">
                    <Button variant="outline" size="sm" asChild>
                      <Link to={`/transactions/${tx.transaction_id}${fallbackTo}`}>Transaktion öffnen</Link>
                    </Button>
                    {tx.statement_doc_id ? (
                      <Button variant="outline" size="sm" asChild>
                        <Link to={`/kontoauszuege/${tx.statement_doc_id}${fallbackTo}`}>Kontoauszug öffnen</Link>
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Auto Find Transaktion ({selectedTransactionLinks.length})</CardTitle>
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

              {selectedTransactionLinks.length === 0 ? (
                <p className="text-xs text-muted-foreground">Keine Vorschläge geladen. Mit "Auto Find Transaktion" wird gesucht.</p>
              ) : null}
              {selectedTransactionLinks.map((suggestion) => {
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

        <DocumentPreviewPane
          title={`Beleg ${document.id}`}
          url={documentFileUrl(document.id)}
          mimeType={document.mime_type}
          fileName={document.original_filename}
          fallbackText="Dokumentvorschau nicht verfügbar."
        />
      </div>
    </div>
  );
}
