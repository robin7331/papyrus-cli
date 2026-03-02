import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DateRangeFilters } from "@/components/layout/date-range-filters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiDelete, apiGet, apiPatch, apiPostFormData } from "@/lib/api";
import type {
  DocumentStatus,
  TransactionDetailResponse,
  TransactionsResponse,
  UploadDocumentResponse,
} from "@/lib/types";
import { formatEuro, formatInt } from "@/lib/utils";

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

export function TransactionsPage() {
  const queryClient = useQueryClient();

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [txType, setTxType] = useState("all");
  const [documentStatus, setDocumentStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadSourceType, setUploadSourceType] = useState("manuell");
  const [uploadDocumentDate, setUploadDocumentDate] = useState("");
  const [uploadIssuerName, setUploadIssuerName] = useState("");
  const [uploadInvoiceNumber, setUploadInvoiceNumber] = useState("");
  const [vatMode, setVatMode] = useState<"auto" | "manual">("auto");
  const [vatStatus, setVatStatus] = useState<"draft" | "final" | "review_required">("final");
  const [vatTaxCode, setVatTaxCode] = useState("DE_OUTPUT_19");
  const [vatRateBps, setVatRateBps] = useState("1900");
  const [vatNetCents, setVatNetCents] = useState("");
  const [vatTaxCents, setVatTaxCents] = useState("");
  const [vatCountryCode, setVatCountryCode] = useState("DE");
  const [vatError, setVatError] = useState("");

  const params = useMemo(
    () => ({
      from,
      to,
      q,
      txType: txType === "all" ? undefined : txType,
      documentStatus: documentStatus === "all" ? undefined : documentStatus,
      page,
      pageSize: 25,
    }),
    [from, to, q, txType, documentStatus, page],
  );

  const transactionsQuery = useQuery({
    queryKey: ["transactions", params],
    queryFn: () => apiGet<TransactionsResponse>("/transactions", params),
  });

  const detailQuery = useQuery({
    queryKey: ["transaction-detail", selectedId],
    queryFn: () => apiGet<TransactionDetailResponse>(`/transactions/${selectedId}`),
    enabled: selectedId !== null,
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!selectedId) {
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

      return apiPostFormData<UploadDocumentResponse>(`/transactions/${selectedId}/documents/upload`, formData);
    },
    onSuccess: async () => {
      setUploadFile(null);
      setUploadDocumentDate("");
      setUploadIssuerName("");
      setUploadInvoiceNumber("");
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["transaction-detail", selectedId] });
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: ({ linkId }: { linkId: number }) => {
      if (!selectedId) {
        throw new Error("Keine Transaktion ausgewählt");
      }
      return apiDelete<{ ok: boolean }>(`/transactions/${selectedId}/document-links/${linkId}`);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["transaction-detail", selectedId] });
    },
  });

  const toggleMissingInvoiceMutation = useMutation({
    mutationFn: (nextFlag: boolean) => {
      if (!selectedId) {
        throw new Error("Keine Transaktion ausgewählt");
      }
      return apiPatch(`/transactions/${selectedId}/missing-invoice-flag`, {
        missingInvoiceFlag: nextFlag,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["transaction-detail", selectedId] });
    },
  });

  const setStatusMutation = useMutation({
    mutationFn: (nextStatus: DocumentStatus) => {
      if (!selectedId) {
        throw new Error("Keine Transaktion ausgewählt");
      }
      return apiPatch(`/transactions/${selectedId}/document-status`, {
        status: nextStatus,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["transaction-detail", selectedId] });
    },
  });

  const updateTaxMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => {
      if (!selectedId) {
        throw new Error("Keine Transaktion ausgewählt");
      }
      return apiPatch(`/tax/transactions/${selectedId}/determination`, payload);
    },
    onSuccess: async () => {
      setVatError("");
      await queryClient.invalidateQueries({ queryKey: ["transaction-detail", selectedId] });
      await queryClient.invalidateQueries({ queryKey: ["tax-reports-monthly"] });
      await queryClient.invalidateQueries({ queryKey: ["tax-review-queue"] });
    },
  });

  const data = transactionsQuery.data;
  const detail = detailQuery.data;
  const totalPages = data ? Math.max(Math.ceil(data.total / data.pageSize), 1) : 1;
  const uploadError = uploadMutation.error instanceof Error ? uploadMutation.error.message : "";
  const transactionAmountAbs = Math.abs(detail?.transaction.amount_cents ?? 0);
  const parsedRateBps = Number.parseInt(vatRateBps, 10);
  const autoComputed = useMemo(() => {
    if (!Number.isInteger(parsedRateBps) || parsedRateBps < 0) {
      return { netCents: null, taxCents: null };
    }
    if (parsedRateBps === 0) {
      return { netCents: transactionAmountAbs, taxCents: 0 };
    }
    const taxCents = Math.round((transactionAmountAbs * parsedRateBps) / (10_000 + parsedRateBps));
    return { netCents: transactionAmountAbs - taxCents, taxCents };
  }, [parsedRateBps, transactionAmountAbs]);

  useEffect(() => {
    if (!detail) {
      return;
    }
    const determination = detail.tax_determination;
    const defaultTaxCode = detail.transaction.amount_cents >= 0 ? "DE_OUTPUT_19" : "DE_INPUT_19";

    setVatMode(determination?.calculation_mode ?? "auto");
    setVatStatus(determination?.status ?? "final");
    setVatTaxCode(determination?.tax_code ?? defaultTaxCode);
    setVatRateBps(String(determination?.tax_rate_bps ?? taxRateDefaults[determination?.tax_code ?? defaultTaxCode] ?? 1900));
    setVatNetCents(determination?.net_amount_cents !== null && determination?.net_amount_cents !== undefined ? String(determination.net_amount_cents) : "");
    setVatTaxCents(determination?.tax_amount_cents !== null && determination?.tax_amount_cents !== undefined ? String(determination.tax_amount_cents) : "");
    setVatCountryCode(determination?.country_code ?? "DE");
    setVatError("");
  }, [detail]);

  function submitVatFinal() {
    if (!detail) {
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
      if (!Number.isInteger(parsedRateBps) || parsedRateBps < 0) {
        setVatError("Bitte gültigen Steuersatz in Basispunkten eingeben.");
        return;
      }
      payload.taxRateBps = parsedRateBps;
    } else {
      const net = Number.parseInt(vatNetCents, 10);
      const tax = Number.parseInt(vatTaxCents, 10);
      if (!Number.isInteger(net) || !Number.isInteger(tax) || net < 0 || tax < 0) {
        setVatError("Bitte gültige Netto- und MwSt-Beträge (Cent) eingeben.");
        return;
      }
      payload.netAmountCents = net;
      payload.taxAmountCents = tax;
      payload.taxRateBps = Number.isInteger(parsedRateBps) && parsedRateBps >= 0 ? parsedRateBps : taxRateDefaults[vatTaxCode] ?? 0;
      const diff = Math.abs(net + tax - transactionAmountAbs);
      if (diff > 1) {
        setVatError("Netto + MwSt passt nicht zum Transaktionsbetrag (Toleranz 1 Cent).");
        return;
      }
    }

    setVatError("");
    updateTaxMutation.mutate(payload);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Transaktionen</h2>
          <p className="text-sm text-muted-foreground">Filterbare Sicht auf `bank_transactions` mit Belegstatus und Upload.</p>
        </div>
        <div className="grid gap-3 lg:grid-cols-5">
          <DateRangeFilters
            from={from}
            to={to}
            onFromChange={(value) => {
              setFrom(value);
              setPage(1);
            }}
            onToChange={(value) => {
              setTo(value);
              setPage(1);
            }}
          />
          <Input
            placeholder="Suche in Verwendungszweck / Gegenpartei / Referenz"
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
              setPage(1);
            }}
          />
          <Select
            value={txType}
            onValueChange={(value) => {
              setTxType(value);
              setPage(1);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Typ" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Typen</SelectItem>
              <SelectItem value="Lastschrift">Lastschrift</SelectItem>
              <SelectItem value="Gutschrift/Überweisung">Gutschrift/Überweisung</SelectItem>
              <SelectItem value="Unbekannt">Unbekannt</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={documentStatus}
            onValueChange={(value) => {
              setDocumentStatus(value);
              setPage(1);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Belegstatus" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Belegstatus</SelectItem>
              <SelectItem value="offen">Offen</SelectItem>
              <SelectItem value="zugeordnet">Zugeordnet</SelectItem>
              <SelectItem value="in_klaerung">In Klärung</SelectItem>
              <SelectItem value="nicht_erforderlich">Nicht erforderlich</SelectItem>
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Buchung</TableHead>
                <TableHead>Typ</TableHead>
                <TableHead>Belegstatus</TableHead>
                <TableHead>Gegenpartei</TableHead>
                <TableHead>Verwendungszweck</TableHead>
                <TableHead className="text-right">Betrag</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.items ?? []).map((row) => (
                <TableRow key={row.id} className="cursor-pointer" onClick={() => setSelectedId(row.id)}>
                  <TableCell>{row.booking_date}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{row.tx_type}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={statusBadgeClass(row.document_status)}>
                        {statusLabel(row.document_status)}
                      </Badge>
                      {row.linked_documents_count > 0 ? <Badge variant="secondary">{row.linked_documents_count} Beleg(e)</Badge> : null}
                      {row.pending_match_suggestions_count > 0 ? (
                        <Badge variant="outline">{row.pending_match_suggestions_count} Vorschlag</Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[220px] truncate">{row.counterparty_name ?? "-"}</TableCell>
                  <TableCell className="max-w-[420px] truncate">{row.purpose ?? "-"}</TableCell>
                  <TableCell className="text-right font-medium">{formatEuro(row.amount_cents)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Sheet
        open={selectedId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedId(null);
            setUploadFile(null);
            setUploadDocumentDate("");
            setUploadIssuerName("");
            setUploadInvoiceNumber("");
            setVatError("");
            uploadMutation.reset();
          }
        }}
      >
        <SheetContent className="sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>Transaktionsdetails</SheetTitle>
            <SheetDescription>Mit Belegen, Status und Import-Auditdaten.</SheetDescription>
          </SheetHeader>

          {detail ? (
            <div className="mt-6 space-y-5 overflow-y-auto pr-2 text-sm">
              <Card>
                <CardHeader>
                  <CardTitle>Belegstatus</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={statusBadgeClass(detail.transaction.document_status)}>
                      {statusLabel(detail.transaction.document_status)}
                    </Badge>
                    <Badge variant="secondary">{detail.linked_documents.length} verknüpft</Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={toggleMissingInvoiceMutation.isPending}
                      onClick={() => toggleMissingInvoiceMutation.mutate(detail.transaction.missing_invoice_flag === 0)}
                    >
                      Fehlende Rechnung: {detail.transaction.missing_invoice_flag === 1 ? "Ja" : "Nein"}
                    </Button>
                    <Select value={detail.transaction.document_status} onValueChange={(value) => setStatusMutation.mutate(value as DocumentStatus)}>
                      <SelectTrigger className="w-[220px]">
                        <SelectValue />
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
                  <CardTitle>Belege ({detail.linked_documents.length})</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {detail.linked_documents.length === 0 ? <p className="text-xs text-muted-foreground">Keine Belege verknüpft.</p> : null}
                  {detail.linked_documents.map((doc) => (
                    <div key={doc.id} className="rounded-md border p-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs">
                          <p className="font-medium">{doc.original_filename ?? `Dokument ${doc.document_id}`}</p>
                          <p className="text-muted-foreground">{doc.storage_rel_path}</p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={unlinkMutation.isPending}
                          onClick={() => unlinkMutation.mutate({ linkId: doc.id })}
                        >
                          Verknüpfung lösen
                        </Button>
                      </div>
                    </div>
                  ))}
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
                    <Select
                      value={vatTaxCode}
                      onValueChange={(value) => {
                        setVatTaxCode(value);
                        setVatRateBps(String(taxRateDefaults[value] ?? 0));
                      }}
                    >
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
                    <Input
                      placeholder="Land (z. B. DE/US)"
                      value={vatCountryCode}
                      maxLength={2}
                      onChange={(event) => setVatCountryCode(event.target.value.toUpperCase())}
                    />
                  </div>

                  <div className="grid gap-2 md:grid-cols-3">
                    <Input
                      type="number"
                      placeholder="Steuersatz bps (1900=19%)"
                      value={vatRateBps}
                      onChange={(event) => setVatRateBps(event.target.value)}
                    />
                    {vatMode === "manual" ? (
                      <>
                        <Input
                          type="number"
                          placeholder="Netto in Cent"
                          value={vatNetCents}
                          onChange={(event) => setVatNetCents(event.target.value)}
                        />
                        <Input
                          type="number"
                          placeholder="MwSt in Cent"
                          value={vatTaxCents}
                          onChange={(event) => setVatTaxCents(event.target.value)}
                        />
                      </>
                    ) : (
                      <>
                        <Input readOnly value={autoComputed.netCents !== null ? String(autoComputed.netCents) : ""} />
                        <Input readOnly value={autoComputed.taxCents !== null ? String(autoComputed.taxCents) : ""} />
                      </>
                    )}
                  </div>

                  <div className="text-xs text-muted-foreground">
                    <p>Transaktionsbetrag (brutto): {formatEuro(detail.transaction.amount_cents)}</p>
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
                          reasonCodes: ["manual_set_review"],
                          confidence: 0.2,
                        })
                      }
                    >
                      Auf Review setzen
                    </Button>
                  </div>
                  {vatError ? <p className="text-xs text-rose-700">{vatError}</p> : null}
                  {updateTaxMutation.error instanceof Error ? (
                    <p className="text-xs text-rose-700">{updateTaxMutation.error.message}</p>
                  ) : null}
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
                    <Input
                      placeholder="Aussteller (optional)"
                      value={uploadIssuerName}
                      onChange={(event) => setUploadIssuerName(event.target.value)}
                    />
                    <Input
                      placeholder="Rechnungsnummer (optional)"
                      value={uploadInvoiceNumber}
                      onChange={(event) => setUploadInvoiceNumber(event.target.value)}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Button disabled={uploadMutation.isPending || !uploadFile} onClick={() => uploadMutation.mutate()}>
                      {uploadMutation.isPending ? "Lade hoch ..." : "Beleg hochladen"}
                    </Button>
                    {uploadMutation.data?.deduplicated ? <Badge variant="secondary">Duplikat erkannt, vorhandenen Beleg genutzt</Badge> : null}
                  </div>
                  {uploadError ? <p className="text-xs text-rose-700">{uploadError}</p> : null}
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
                  {Object.entries(detail.transaction).map(([key, value]) => (
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
          ) : (
            <p className="mt-6 text-sm text-muted-foreground">Lade Details ...</p>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
