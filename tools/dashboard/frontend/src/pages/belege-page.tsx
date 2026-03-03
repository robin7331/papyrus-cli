import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiGet } from "@/lib/api";
import type { DocumentListItem, DocumentsResponse } from "@/lib/types";
import { formatEuro, formatInt } from "@/lib/utils";

type DocumentDirection = "Eingehend" | "Ausgehend" | "Gemischt" | "Unklar";

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

function resolveVatTreatment(metadata: Record<string, unknown> | null): string | null {
  const value = metadata?.["vat_treatment"];
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return null;
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

function documentFileUrl(documentId: number): string {
  return `/api/documents/${documentId}/file`;
}

export function BelegePage() {
  const [q, setQ] = useState("");
  const [yearInput, setYearInput] = useState("");
  const [lifecycleStatus, setLifecycleStatus] = useState("archiviert");
  const [page, setPage] = useState(1);

  const params = useMemo(
    () => ({
      sourceType: "scan",
      lifecycleStatus: lifecycleStatus === "all" ? undefined : lifecycleStatus,
      year: yearInput.trim().length === 4 ? Number.parseInt(yearInput, 10) : undefined,
      q,
      page,
      pageSize: 50,
    }),
    [lifecycleStatus, yearInput, q, page],
  );

  const belegeQuery = useQuery({
    queryKey: ["belege", params],
    queryFn: () => apiGet<DocumentsResponse>("/documents", params),
  });

  const data = belegeQuery.data;
  const totalPages = data ? Math.max(Math.ceil(data.total / data.pageSize), 1) : 1;

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
                <TableHead>ID</TableHead>
                <TableHead>Belegdatum</TableHead>
                <TableHead>Beleg</TableHead>
                <TableHead>Aussteller / Rechnungsnr</TableHead>
                <TableHead>Betreff</TableHead>
                <TableHead>Richtung</TableHead>
                <TableHead>MwSt</TableHead>
                <TableHead className="text-right">Netto</TableHead>
                <TableHead className="text-right">Brutto</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.items ?? []).map((row) => {
                const metadata = parseMetadataJson(row.metadata_json);
                const vatTreatment = resolveVatTreatment(metadata);
                const direction = resolveDirection(row, metadata);
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs">{row.id}</TableCell>
                    <TableCell className="text-xs">{formatDate(row.document_date)}</TableCell>
                    <TableCell className="max-w-[360px]">
                      <p className="truncate font-medium">
                        <a
                          href={documentFileUrl(row.id)}
                          target="_blank"
                          rel="noreferrer"
                          className="underline decoration-dotted underline-offset-2 hover:no-underline"
                        >
                          {row.original_filename ?? `Dokument ${row.id}`}
                        </a>
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{row.storage_rel_path}</p>
                    </TableCell>
                    <TableCell className="max-w-[260px]">
                      <p className="truncate">{row.issuer_name ?? "-"}</p>
                      <p className="truncate text-xs text-muted-foreground">{row.invoice_number ?? "-"}</p>
                    </TableCell>
                    <TableCell className="max-w-[320px]">
                      <p className="truncate">{row.subject ?? row.summary_short ?? "-"}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{direction}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {vatTreatment ? <Badge variant="outline">{vatTreatment}</Badge> : <span className="text-xs text-muted-foreground">-</span>}
                        {typeof row.vat_rate_bps === "number" ? <Badge variant="secondary">{(row.vat_rate_bps / 100).toFixed(2)}%</Badge> : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {row.net_amount_cents === null || row.net_amount_cents === undefined ? "-" : formatEuro(row.net_amount_cents)}
                    </TableCell>
                    <TableCell className="text-right font-medium">
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
    </div>
  );
}
