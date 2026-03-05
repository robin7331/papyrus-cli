import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DocumentPreviewPane } from "@/components/document-preview-pane";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import type {
  DocumentStatus,
  MatchSelectionResponse,
  MatchSuggestionsRefreshResponse,
  NextOpenTransactionResponse,
  TaxRecomputeFromLinksResponse,
  TransactionDetailResponse,
} from "@/lib/types";
import { formatEuro } from "@/lib/utils";

type LinkToDocument = {
  id: number;
  source_type: string;
  original_filename: string | null;
  storage_rel_path: string;
  link_role: string;
  document_id: number;
};

const taxCodeOptions = [
  { value: "DE_OUTPUT_19", label: "Inland Umsatzsteuer 19%" },
  { value: "DE_OUTPUT_7", label: "Inland Umsatzsteuer 7%" },
  { value: "DE_INPUT_19", label: "Vorsteuer 19%" },
  { value: "DE_INPUT_7", label: "Vorsteuer 7%" },
  { value: "EU_B2C_OSS_STD", label: "EU B2C OSS" },
  { value: "THIRD_COUNTRY_EXPORT_0", label: "Drittlandexport 0%" },
  { value: "NON_TAXABLE", label: "Nicht steuerbar" },
] as const;

const taxRateDefaults: Record<string, number> = {
  DE_OUTPUT_19: 1900,
  DE_OUTPUT_7: 700,
  DE_INPUT_19: 1900,
  DE_INPUT_7: 700,
  EU_B2C_OSS_STD: 0,
  THIRD_COUNTRY_EXPORT_0: 0,
  NON_TAXABLE: 0,
};

function parseReasonCodes(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter((item) => item.length > 0);
  } catch {
    return [];
  }
}

function statusBadgeClass(status: DocumentStatus): string {
  switch (status) {
    case "zugeordnet":
      return "bg-emerald-100 text-emerald-800 border-emerald-300";
    case "in_klaerung":
      return "bg-amber-100 text-amber-800 border-amber-300";
    case "nicht_erforderlich":
      return "bg-slate-100 text-slate-800 border-slate-300";
    case "offen":
    default:
      return "bg-rose-100 text-rose-800 border-rose-300";
  }
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

function formatMetaDate(value: string | null): string {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" }).format(parsed);
}

export function TransactionDetailPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { transactionId: txIdParam } = useParams<{ transactionId: string }>();
  const transactionId = Number(txIdParam);
  const hasTransactionId = Number.isInteger(transactionId) && transactionId > 0;

  const [vatMode, setVatMode] = useState<"auto" | "manual">("auto");
  const [vatStatus, setVatStatus] = useState<"draft" | "final" | "review_required">("final");
  const [vatTaxCode, setVatTaxCode] = useState("DE_OUTPUT_19");
  const [vatRateBps, setVatRateBps] = useState("1900");
  const [vatNetCents, setVatNetCents] = useState("");
  const [vatTaxCents, setVatTaxCents] = useState("");
  const [vatCountryCode, setVatCountryCode] = useState("DE");
  const [vatError, setVatError] = useState("");

  const [primarySuggestionDocumentId, setPrimarySuggestionDocumentId] = useState<number | null>(null);
  const [supportingSuggestionDocumentIds, setSupportingSuggestionDocumentIds] = useState<number[]>([]);
  const [matchNotice, setMatchNotice] = useState("");
  const [matchError, setMatchError] = useState("");
  const [movingToNext, setMovingToNext] = useState(false);
  const [movingError, setMovingError] = useState("");

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadSourceType, setUploadSourceType] = useState("manuell");
  const [uploadDocumentDate, setUploadDocumentDate] = useState("");
  const [uploadIssuerName, setUploadIssuerName] = useState("");
  const [uploadInvoiceNumber, setUploadInvoiceNumber] = useState("");

  const detailQuery = useQuery({
    queryKey: ["transaction-detail", transactionId],
    queryFn: () => apiGet<TransactionDetailResponse>(`/transactions/${transactionId}`),
    enabled: hasTransactionId,
  });

  const detail = detailQuery.data;
  const tx = detail?.transaction;
  const linkedDocuments = detail?.linked_documents ?? [];
  const documentStatus = tx?.document_status ?? "offen";
  const pendingMatchSuggestions = useMemo(
    () => (detail?.match_suggestions ?? []).filter((row) => row.status === "pending"),
    [detail?.match_suggestions],
  );
  const transactionAmountAbs = Math.abs(tx?.amount_cents ?? 0);
  const autoComputed = useMemo(() => {
    const parsedRateBps = Number.parseInt(vatRateBps, 10);
    if (!Number.isInteger(parsedRateBps) || parsedRateBps < 0) {
      return { netCents: null, taxCents: null };
    }
    if (parsedRateBps === 0) {
      return { netCents: transactionAmountAbs, taxCents: 0 };
    }
    const taxCents = Math.round((transactionAmountAbs * parsedRateBps) / (10_000 + parsedRateBps));
    return { netCents: transactionAmountAbs - taxCents, taxCents };
  }, [vatRateBps, transactionAmountAbs]);

  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  const q = searchParams.get("q") ?? "";
  const txType = searchParams.get("txType") ?? "all";
  const detailBack = searchParams.toString() ? `/transactions?${searchParams.toString()}` : "/transactions";

  const toggleMissingInvoiceMutation = useMutation({
    mutationFn: (nextFlag: boolean) => {
      if (!hasTransactionId) {
        throw new Error("Keine Transaktion ausgewählt");
      }
      return apiPatch(`/transactions/${transactionId}/missing-invoice-flag`, {
        missingInvoiceFlag: nextFlag,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["transaction-detail", transactionId] });
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
  });

  const setStatusMutation = useMutation({
    mutationFn: (nextStatus: DocumentStatus) => {
      if (!hasTransactionId) {
        throw new Error("Keine Transaktion ausgewählt");
      }
      return apiPatch<{ ok: boolean; transaction_id: number; new_status: DocumentStatus }>(`/transactions/${transactionId}/document-status`, {
        status: nextStatus,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["transaction-detail", transactionId] });
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
  });

  const updateTaxMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => {
      if (!hasTransactionId) {
        throw new Error("Keine Transaktion ausgewählt");
      }
      return apiPatch(`/tax/transactions/${transactionId}/determination`, payload);
    },
    onSuccess: async () => {
      setVatError("");
      await queryClient.invalidateQueries({ queryKey: ["transaction-detail", transactionId] });
      await queryClient.invalidateQueries({ queryKey: ["tax-reviews-queue"] });
    },
  });

  const refreshSuggestionsMutation = useMutation({
    mutationFn: () => {
      if (!hasTransactionId) {
        throw new Error("Keine Transaktion ausgewählt");
      }
      return apiPost<MatchSuggestionsRefreshResponse>(`/transactions/${transactionId}/match-suggestions/refresh`, { limit: 8 });
    },
    onSuccess: async (result) => {
      setMatchError("");
      setPrimarySuggestionDocumentId(null);
      setSupportingSuggestionDocumentIds([]);
      setMatchNotice(result.candidate_count > 0 ? `${result.candidate_count} Kandidat(en) gefunden.` : "Keine passenden Beleg-Kandidaten gefunden.");
      await queryClient.invalidateQueries({ queryKey: ["transaction-detail", transactionId] });
    },
  });

  const applyMatchSelectionMutation = useMutation({
    mutationFn: async () => {
      if (!hasTransactionId) {
        throw new Error("Keine Transaktion ausgewählt");
      }
      if (!primarySuggestionDocumentId) {
        throw new Error("Bitte Hauptbeleg auswählen.");
      }
      const response = await apiPost<MatchSelectionResponse>(`/transactions/${transactionId}/match-selection`, {
        primaryDocumentId: primarySuggestionDocumentId,
        supportingDocumentIds: supportingSuggestionDocumentIds,
      });
      let taxErrorMessage: string | null = null;
      let taxResult: TaxRecomputeFromLinksResponse | null = null;
      try {
        taxResult = await apiPost<TaxRecomputeFromLinksResponse>(`/tax/transactions/${transactionId}/recompute-from-links`, {});
      } catch (error) {
        taxErrorMessage = error instanceof Error ? error.message : "MwSt-Update fehlgeschlagen.";
      }
      return { response, taxResult, taxErrorMessage };
    },
    onSuccess: async ({ response, taxResult, taxErrorMessage }) => {
      setMatchError("");
      if (taxErrorMessage) {
        setMatchError(`Beleg übernommen, MwSt-Update fehlgeschlagen: ${taxErrorMessage}`);
      } else if (taxResult?.skipped_manual_final) {
        setMatchNotice(`${response.linked_document_ids.length} Beleg(e) übernommen. MwSt blieb unverändert (manuell final).`);
      } else {
        setMatchNotice(`${response.linked_document_ids.length} Beleg(e) übernommen und MwSt aktualisiert.`);
      }
      setPrimarySuggestionDocumentId(null);
      setSupportingSuggestionDocumentIds([]);
      await queryClient.invalidateQueries({ queryKey: ["transaction-detail", transactionId] });
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: ({ linkId }: { linkId: number }) => {
      if (!hasTransactionId) {
        throw new Error("Keine Transaktion ausgewählt");
      }
      return apiDelete<{ ok: boolean }>(`/transactions/${transactionId}/document-links/${linkId}`);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["transaction-detail", transactionId] });
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
  });

  const uploadMutation = useMutation({
    mutationFn: () => {
      if (!hasTransactionId) {
        throw new Error("Keine Transaktion ausgewählt");
      }
      if (!uploadFile) {
        throw new Error("Bitte Datei auswählen");
      }
      const formData = new FormData();
      formData.append("file", uploadFile);
      formData.append("sourceType", uploadSourceType);
      if (uploadDocumentDate) {
        formData.append("documentDate", uploadDocumentDate);
      }
      if (uploadIssuerName) {
        formData.append("issuerName", uploadIssuerName);
      }
      if (uploadInvoiceNumber) {
        formData.append("invoiceNumber", uploadInvoiceNumber);
      }
      return apiPost(`/transactions/${transactionId}/documents/upload`, formData);
    },
    onSuccess: async () => {
      setUploadFile(null);
      setUploadDocumentDate("");
      setUploadIssuerName("");
      setUploadInvoiceNumber("");
      await queryClient.invalidateQueries({ queryKey: ["transaction-detail", transactionId] });
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
  });

  useEffect(() => {
    if (!detail) {
      return;
    }
    const determination = detail.tax_determination;
    const defaultTaxCode = tx ? (tx.amount_cents >= 0 ? "DE_OUTPUT_19" : "DE_INPUT_19") : "DE_OUTPUT_19";
    setVatMode(determination?.calculation_mode ?? "auto");
    setVatStatus(determination?.status ?? "final");
    setVatTaxCode(determination?.tax_code ?? defaultTaxCode);
    setVatRateBps(String(determination?.tax_rate_bps ?? taxRateDefaults[determination?.tax_code ?? defaultTaxCode] ?? 1900));
    setVatNetCents(determination?.net_amount_cents !== null && determination?.net_amount_cents !== undefined ? String(determination.net_amount_cents) : "");
    setVatTaxCents(determination?.tax_amount_cents !== null && determination?.tax_amount_cents !== undefined ? String(determination.tax_amount_cents) : "");
    setVatCountryCode(determination?.country_code ?? "DE");
    setVatError("");
  }, [detail]);

  useEffect(() => {
    if (!detail) {
      setPrimarySuggestionDocumentId(null);
      setSupportingSuggestionDocumentIds([]);
      return;
    }
    const pendingDocumentIds = detail.match_suggestions
      .filter((row) => row.status === "pending")
      .map((row) => row.document_id);
    if (pendingDocumentIds.length === 0) {
      setPrimarySuggestionDocumentId(null);
      setSupportingSuggestionDocumentIds([]);
      return;
    }
    const nextPrimary =
      primarySuggestionDocumentId && pendingDocumentIds.includes(primarySuggestionDocumentId) ? primarySuggestionDocumentId : pendingDocumentIds[0];
    setPrimarySuggestionDocumentId(nextPrimary);
    setSupportingSuggestionDocumentIds((prev) => prev.filter((docId) => pendingDocumentIds.includes(docId) && docId !== nextPrimary));
  }, [detail?.match_suggestions, primarySuggestionDocumentId]);

  useEffect(() => {
    setMatchError("");
    setMatchNotice("");
  }, [transactionId]);

  async function goToNextOpenTransaction() {
    if (!hasTransactionId || !tx) {
      return;
    }
    setMovingToNext(true);
    setMovingError("");
    try {
      const response = await apiGet<NextOpenTransactionResponse>(`/transactions/${tx.id}/next-open`, {
        from: from || undefined,
        to: to || undefined,
        q: q || undefined,
        txType: txType === "all" ? undefined : txType,
      });
      if (typeof response.nextTransactionId === "number") {
        setMatchNotice("");
        navigate({ pathname: `/transactions/${response.nextTransactionId}`, search: searchParams.toString() ? `?${searchParams.toString()}` : "" });
      } else {
        setMatchNotice("Keine weitere offene Transaktion im aktuellen Filter.");
      }
    } catch (error) {
      setMovingError(error instanceof Error ? error.message : "Nächste Transaktion konnte nicht geladen werden.");
    } finally {
      setMovingToNext(false);
    }
  }

  function submitVatFinal() {
    if (!detail?.transaction) {
      return;
    }
    const payload: Record<string, unknown> = {
      status: vatStatus,
      calculationMode: vatMode,
      taxCode: vatTaxCode,
      countryCode: vatCountryCode || null,
      confidence: 0.8,
      evidenceLevel: detail.linked_documents.length > 0 ? "high" : "medium",
      reasonCodes: ["manual_transaction_detail"],
    };

    if (vatMode === "auto") {
      const parsedRate = Number.parseInt(vatRateBps, 10);
      if (!Number.isInteger(parsedRate) || parsedRate < 0) {
        setVatError("Bitte gültigen Steuersatz in Basispunkten eingeben.");
        return;
      }
      payload.taxRateBps = parsedRate;
    } else {
      const net = Number.parseInt(vatNetCents, 10);
      const tax = Number.parseInt(vatTaxCents, 10);
      if (!Number.isInteger(net) || !Number.isInteger(tax) || net < 0 || tax < 0) {
        setVatError("Bitte gültige Netto- und MwSt-Beträge (Cent) eingeben.");
        return;
      }
      payload.netAmountCents = net;
      payload.taxAmountCents = tax;
      const parsedRate = Number.parseInt(vatRateBps, 10);
      if (!Number.isInteger(parsedRate) || parsedRate < 0) {
        setVatError("Bitte gültigen Steuersatz in Basispunkten eingeben.");
        return;
      }
      payload.taxRateBps = parsedRate;
      const diff = Math.abs(net + tax - transactionAmountAbs);
      if (diff > 1) {
        setVatError("Netto + MwSt passt nicht zum Transaktionsbetrag (Toleranz 1 Cent).");
        return;
      }
    }

    setVatError("");
    updateTaxMutation.mutate(payload);
  }

  function toggleSupportingSelection(documentId: number) {
    if (documentId === primarySuggestionDocumentId) {
      return;
    }
    setSupportingSuggestionDocumentIds((prev) =>
      prev.includes(documentId) ? prev.filter((id) => id !== documentId) : [...prev, documentId],
    );
  }

  if (!hasTransactionId) {
    return (
      <div className="space-y-4">
        <Button variant="outline" asChild>
          <Link to={detailBack}>Zurück zu Transaktionen</Link>
        </Button>
        <p className="text-sm text-destructive">Ungültige Transaktions-ID.</p>
      </div>
    );
  }

  if (detailQuery.isLoading && !detail) {
    return <p className="text-sm text-muted-foreground">Lade Transaktion ...</p>;
  }

  if (detailQuery.isError || !detail || !tx) {
    return (
      <div className="space-y-4">
        <Button variant="outline" asChild>
          <Link to={detailBack}>Zurück zu Transaktionen</Link>
        </Button>
        <p className="text-sm text-destructive">Transaktion konnte nicht geladen werden.</p>
      </div>
    );
  }

  const primaryDocument = linkedDocuments.find((doc) => doc.link_role === "primary");
  const fallbackDocument = linkedDocuments[0] ?? null;
  const previewDocument = primaryDocument ?? fallbackDocument;
  const previewUrl = previewDocument ? documentFileUrl(previewDocument.document_id) : tx.statement_file_url;
  const previewMimeType = previewDocument?.mime_type ?? (previewUrl ? "application/pdf" : null);
  const previewFileName = previewDocument?.original_filename ?? "Kontoauszug";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Transaktionsdetails #{tx.id}</h2>
          <p className="text-sm text-muted-foreground">Vollbildansicht mit Kernaktionen und Vorschau.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link to={detailBack}>Zurück</Link>
          </Button>
          {tx.statement_doc_id ? (
            <Button variant="outline" asChild>
              <Link to={`/kontoauszuege/${tx.statement_doc_id}`}>Kontoauszug öffnen</Link>
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Belegstatus</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={statusBadgeClass(tx.document_status)}>
                  {statusLabel(tx.document_status)}
                </Badge>
                <Badge variant="secondary">{linkedDocuments.length} verknüpft</Badge>
                {tx.statement_file_url ? (
                  <Button variant="outline" size="sm" asChild>
                    <a href={tx.statement_file_url} target="_blank" rel="noreferrer">
                      Kontoauszug direkt öffnen
                    </a>
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled>
                    Kontoauszug nicht verfügbar
                  </Button>
                )}
                {primaryDocument ? (
                  <Button variant="outline" size="sm" asChild>
                    <Link to={`/belege/${primaryDocument.document_id}`}>Primär-Beleg öffnen</Link>
                  </Button>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={toggleMissingInvoiceMutation.isPending}
                  onClick={() => toggleMissingInvoiceMutation.mutate(tx.missing_invoice_flag === 0)}
                >
                  Fehlende Rechnung: {tx.missing_invoice_flag === 1 ? "Ja" : "Nein"}
                </Button>
                <Select value={tx.document_status} onValueChange={(value) => setStatusMutation.mutate(value as DocumentStatus)}>
                  <SelectTrigger className="w-[220px]">
                    <SelectValue placeholder="Belegstatus setzen" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="offen">Offen</SelectItem>
                    <SelectItem value="zugeordnet">Zugeordnet</SelectItem>
                    <SelectItem value="in_klaerung">In Klärung</SelectItem>
                    <SelectItem value="nicht_erforderlich">Nicht erforderlich</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Belege ({linkedDocuments.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {linkedDocuments.length === 0 ? <p className="text-xs text-muted-foreground">Keine Belege verknüpft.</p> : null}
              {linkedDocuments.map((doc) => (
                <div key={doc.id} className="rounded-md border p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs">
                      <p className="font-medium">
                        <Link to={`/belege/${doc.document_id}`} className="underline underline-offset-2 hover:no-underline">
                          {doc.original_filename ?? `Dokument ${doc.document_id}`}
                        </Link>
                      </p>
                      <p className="text-muted-foreground">{doc.storage_rel_path}</p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Button variant="outline" size="sm" asChild>
                        <Link to={`/belege/${doc.document_id}`}>Öffnen</Link>
                      </Button>
                      <Button variant="outline" size="sm" disabled={unlinkMutation.isPending} onClick={() => unlinkMutation.mutate({ linkId: doc.id })}>
                        Verknüpfung lösen
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Auto Find Beleg ({pendingMatchSuggestions.length})</CardTitle>
              <Button variant="outline" size="sm" disabled={refreshSuggestionsMutation.isPending} onClick={() => refreshSuggestionsMutation.mutate()}>
                {refreshSuggestionsMutation.isPending ? "Suche ..." : "Auto Find Beleg"}
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  disabled={applyMatchSelectionMutation.isPending || movingToNext || !primarySuggestionDocumentId || pendingMatchSuggestions.length === 0}
                  onClick={() => applyMatchSelectionMutation.mutate()}
                >
                  {applyMatchSelectionMutation.isPending ? "Übernehme ..." : "Übernehmen"}
                </Button>
                <Button variant="outline" size="sm" disabled={movingToNext || applyMatchSelectionMutation.isPending} onClick={() => void goToNextOpenTransaction()}>
                  {movingToNext ? "Lade ..." : "Nächste"}
                </Button>
              </div>
              {matchNotice ? <p className="text-xs text-muted-foreground">{matchNotice}</p> : null}
              {matchError ? <p className="text-xs text-rose-700">{matchError}</p> : null}
              {movingError ? <p className="text-xs text-rose-700">{movingError}</p> : null}
              {refreshSuggestionsMutation.error instanceof Error ? (
                <p className="text-xs text-rose-700">{refreshSuggestionsMutation.error.message}</p>
              ) : null}

              {pendingMatchSuggestions.length === 0 ? (
                <p className="text-xs text-muted-foreground">Keine offenen Kandidaten. Mit "Auto Find Beleg" wird gesucht.</p>
              ) : null}
              {pendingMatchSuggestions.map((suggestion) => {
                const reasonCodes = parseReasonCodes(suggestion.reason_codes_json);
                return (
                  <div key={suggestion.id} className="space-y-2 rounded-md border p-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs">
                        <p className="font-medium">
                          <Link to={`/belege/${suggestion.document_id}`} className="underline underline-offset-2 hover:no-underline">
                            {suggestion.original_filename ?? `Dokument ${suggestion.document_id}`}
                          </Link>
                        </p>
                        <p className="text-muted-foreground">{suggestion.storage_rel_path}</p>
                      </div>
                      <Badge variant="outline">Score {(suggestion.score ?? 0).toFixed(2)}</Badge>
                    </div>
                    <div className="grid gap-2 text-xs md:grid-cols-2">
                      <p>
                        <span className="text-muted-foreground">Aussteller:</span> {suggestion.issuer_name ?? "-"}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Rechnungsnr:</span> {suggestion.invoice_number ?? "-"}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Belegdatum:</span> {suggestion.document_date ?? "-"}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Brutto:</span>{" "}
                        {typeof suggestion.gross_amount_cents === "number" ? formatEuro(suggestion.gross_amount_cents) : "-"}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-4 text-xs">
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="primary-suggestion"
                          checked={primarySuggestionDocumentId === suggestion.document_id}
                          onChange={() => {
                            setPrimarySuggestionDocumentId(suggestion.document_id);
                            setSupportingSuggestionDocumentIds((prev) => prev.filter((docId) => docId !== suggestion.document_id));
                          }}
                        />
                        <span>Primary</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={supportingSuggestionDocumentIds.includes(suggestion.document_id)}
                          disabled={primarySuggestionDocumentId === suggestion.document_id}
                          onChange={() => toggleSupportingSelection(suggestion.document_id)}
                        />
                        <span>Supporting</span>
                      </label>
                    </div>
                    {reasonCodes.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {reasonCodes.map((code) => (
                          <Badge key={`${suggestion.id}-${code}`} variant="secondary">
                            {code}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>MwSt festlegen</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2 md:grid-cols-2">
                <Select value={vatMode} onValueChange={(value) => setVatMode(value as "auto" | "manual")}>
                  <SelectTrigger>
                    <SelectValue placeholder="Berechnungsmodus" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Automatisch (Brutto + Satz)</SelectItem>
                    <SelectItem value="manual">Manuell (Netto + MwSt)</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={vatStatus} onValueChange={(value) => setVatStatus(value as "draft" | "final" | "review_required")}>
                  <SelectTrigger>
                    <SelectValue placeholder="Tax-Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">draft</SelectItem>
                    <SelectItem value="final">final</SelectItem>
                    <SelectItem value="review_required">review_required</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <Select value={vatTaxCode} onValueChange={(value) => setVatTaxCode(value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Tax-Code" />
                  </SelectTrigger>
                  <SelectContent>
                    {taxCodeOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input value={vatCountryCode} onChange={(event) => setVatCountryCode(event.target.value.toUpperCase())} />
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                <Input type="number" placeholder="Steuersatz bps (1900=19%)" value={vatRateBps} onChange={(event) => setVatRateBps(event.target.value)} />
                {vatMode === "manual" ? (
                  <>
                    <Input type="number" placeholder="Netto in Cent" value={vatNetCents} onChange={(event) => setVatNetCents(event.target.value)} />
                    <Input type="number" placeholder="MwSt in Cent" value={vatTaxCents} onChange={(event) => setVatTaxCents(event.target.value)} />
                  </>
                ) : (
                  <>
                    <Input readOnly value={autoComputed.netCents !== null ? String(autoComputed.netCents) : ""} />
                    <Input readOnly value={autoComputed.taxCents !== null ? String(autoComputed.taxCents) : ""} />
                  </>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                <p>Transaktionsbetrag (brutto): {formatEuro(tx.amount_cents)}</p>
                <p>
                  {vatMode === "auto"
                    ? `Auto-Vorschau: Netto ${autoComputed.netCents !== null ? formatEuro(autoComputed.netCents) : "-"}, MwSt ${autoComputed.taxCents !== null ? formatEuro(autoComputed.taxCents) : "-"}`
                    : "Manuelle Werte werden direkt übernommen."}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button disabled={updateTaxMutation.isPending} onClick={submitVatFinal}>
                  {updateTaxMutation.isPending ? "Speichere ..." : "Steuer speichern"}
                </Button>
                <Button
                  variant="outline"
                  disabled={updateTaxMutation.isPending}
                  onClick={() =>
                    updateTaxMutation.mutate({
                      status: "review_required",
                      calculationMode: vatMode,
                      taxCode: vatTaxCode,
                      countryCode: vatCountryCode || null,
                      confidence: 0.2,
                    })
                  }
                >
                  Auf Review setzen
                </Button>
                {vatError ? <p className="text-xs text-rose-700">{vatError}</p> : null}
                {updateTaxMutation.error instanceof Error ? <p className="text-xs text-rose-700">{updateTaxMutation.error.message}</p> : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Beleg hochladen</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp,.tif,.tiff,application/pdf,image/*"
                onChange={(event) => {
                  const nextFile = event.target.files?.[0] ?? null;
                  setUploadFile(nextFile);
                }}
              />
              <div className="grid gap-2 md:grid-cols-2">
                <Select value={uploadSourceType} onValueChange={setUploadSourceType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Quelle" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manuell">Manuell</SelectItem>
                    <SelectItem value="scan">Scan</SelectItem>
                    <SelectItem value="portal">Portal</SelectItem>
                    <SelectItem value="email">E-Mail</SelectItem>
                    <SelectItem value="sonstiges">Sonstiges</SelectItem>
                  </SelectContent>
                </Select>
                <Input type="date" value={uploadDocumentDate} onChange={(event) => setUploadDocumentDate(event.target.value)} />
              </div>
              <Input placeholder="Aussteller (optional)" value={uploadIssuerName} onChange={(event) => setUploadIssuerName(event.target.value)} />
              <Input placeholder="Rechnungsnummer (optional)" value={uploadInvoiceNumber} onChange={(event) => setUploadInvoiceNumber(event.target.value)} />
              <div className="flex items-center gap-2">
                <Button disabled={uploadMutation.isPending || !uploadFile} onClick={() => uploadMutation.mutate()}>
                  {uploadMutation.isPending ? "Lade hoch ..." : "Beleg hochladen"}
                </Button>
                {uploadMutation.error instanceof Error ? <p className="text-xs text-rose-700">{uploadMutation.error.message}</p> : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Statushistorie ({detail.document_status_history.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              {detail.document_status_history.map((row) => (
                <div key={row.id} className="grid grid-cols-4 gap-2 border-b py-1">
                  <span>{row.changed_at}</span>
                  <span>{row.old_status ?? "-"}</span>
                  <span>{row.new_status}</span>
                  <span>{row.reason ?? ""}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Stammdaten</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              {Object.entries(tx).map(([key, value]) => (
                <div key={key} className="grid grid-cols-2 gap-2 border-b py-1">
                  <span className="font-medium text-muted-foreground">{key}</span>
                  <span className="break-all">{String(value ?? "")}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Raw-Zeilen ({detail.raw_rows.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              {detail.raw_rows.map((row, index) => (
                <pre key={index} className="overflow-x-auto rounded-md bg-secondary p-2">
                  {JSON.stringify(row, null, 2)}
                </pre>
              ))}
            </CardContent>
          </Card>
        </div>

        <DocumentPreviewPane
          title={previewDocument ? `Beleg ${previewDocument.document_id}` : "Kontoauszug"}
          url={previewUrl ?? null}
          mimeType={previewMimeType}
          fileName={previewFileName}
          fallbackText="Kein Dokument oder Kontoauszug gefunden."
        />
      </div>
    </div>
  );
}
