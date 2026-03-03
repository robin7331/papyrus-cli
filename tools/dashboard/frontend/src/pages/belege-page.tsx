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

function formatDateTime(value: string | null): string {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function resolveVatTreatment(row: DocumentListItem): string | null {
  const fromMeta = row.metadata_json;
  if (!fromMeta) {
    return null;
  }
  try {
    const parsed = JSON.parse(fromMeta) as Record<string, unknown>;
    const value = parsed.vat_treatment;
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  } catch {
    return null;
  }
  return null;
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
                <TableHead>Erstellt</TableHead>
                <TableHead>Beleg</TableHead>
                <TableHead>Aussteller / Rechnungsnr</TableHead>
                <TableHead>Betreff</TableHead>
                <TableHead>MwSt</TableHead>
                <TableHead className="text-right">Brutto</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.items ?? []).map((row) => {
                const vatTreatment = resolveVatTreatment(row);
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs">{row.id}</TableCell>
                    <TableCell className="text-xs">{formatDateTime(row.created_at)}</TableCell>
                    <TableCell className="max-w-[360px]">
                      <p className="truncate font-medium">{row.original_filename ?? `Dokument ${row.id}`}</p>
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
                      <div className="flex flex-wrap gap-1">
                        {vatTreatment ? <Badge variant="outline">{vatTreatment}</Badge> : <span className="text-xs text-muted-foreground">-</span>}
                        {typeof row.vat_rate_bps === "number" ? <Badge variant="secondary">{(row.vat_rate_bps / 100).toFixed(2)}%</Badge> : null}
                      </div>
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
