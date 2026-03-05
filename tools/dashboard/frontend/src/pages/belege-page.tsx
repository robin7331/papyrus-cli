import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiGet } from "@/lib/api";
import type { DocumentListItem, DocumentStatus, DocumentsResponse } from "@/lib/types";
import { formatEuro, formatInt } from "@/lib/utils";

const BELEGE_FILTERS_STORAGE_KEY = "dashboard.belege.filters";

type BelegeFiltersState = {
  q: string;
  yearInput: string;
  lifecycleStatus: string;
  mappedStatus: string;
  page: number;
};

function parseStoredBelegeFilters(): Partial<BelegeFiltersState> {
  try {
    const raw = globalThis.localStorage.getItem(BELEGE_FILTERS_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed as Partial<BelegeFiltersState>;
  } catch {
    return {};
  }
}

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

function isMapped(row: DocumentListItem): boolean {
  return row.linked_transactions_count > 0;
}

export function BelegePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [q, setQ] = useState("");
  const [yearInput, setYearInput] = useState("");
  const [lifecycleStatus, setLifecycleStatus] = useState("archiviert");
  const [mappedStatus, setMappedStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [filtersHydrated, setFiltersHydrated] = useState(false);

  useEffect(() => {
    const stored = parseStoredBelegeFilters();
    const nextQ = searchParams.get("q") ?? (typeof stored.q === "string" ? stored.q : "");
    const nextYear = searchParams.get("year") ?? (typeof stored.yearInput === "string" ? stored.yearInput : "");
    const nextLifecycle = searchParams.get("lifecycleStatus") ?? (typeof stored.lifecycleStatus === "string" ? stored.lifecycleStatus : "archiviert");
    const nextMapped = searchParams.get("mappedStatus") ?? (typeof stored.mappedStatus === "string" ? stored.mappedStatus : "all");
    const nextPageFromQuery = Number(searchParams.get("page"));
    const nextPageFromStorage = typeof stored.page === "number" ? stored.page : Number.NaN;
    const nextPage = Number.isInteger(nextPageFromQuery) && nextPageFromQuery > 0
      ? nextPageFromQuery
      : Number.isInteger(nextPageFromStorage) && nextPageFromStorage > 0
        ? nextPageFromStorage
        : 1;

    setQ(nextQ);
    setYearInput(nextYear);
    setLifecycleStatus(
      nextLifecycle === "inbox" || nextLifecycle === "archiviert" || nextLifecycle === "verworfen" ? nextLifecycle : "archiviert",
    );
    setMappedStatus(nextMapped === "mapped" || nextMapped === "unmapped" ? nextMapped : "all");
    setPage(nextPage);
    setFiltersHydrated(true);
  }, [searchParams]);

  useEffect(() => {
    if (!filtersHydrated) {
      return;
    }
    const value: BelegeFiltersState = {
      q,
      yearInput,
      lifecycleStatus,
      mappedStatus,
      page,
    };
    globalThis.localStorage.setItem(BELEGE_FILTERS_STORAGE_KEY, JSON.stringify(value));
  }, [filtersHydrated, q, yearInput, lifecycleStatus, mappedStatus, page]);

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

  const data = belegeQuery.data;
  const totalPages = data ? Math.max(Math.ceil(data.total / data.pageSize), 1) : 1;

  const listQuery = useMemo(() => {
    const search = new URLSearchParams();
    if (q) {
      search.set("q", q);
    }
    if (yearInput.trim()) {
      search.set("year", yearInput);
    }
    if (lifecycleStatus !== "all") {
      search.set("lifecycleStatus", lifecycleStatus);
    }
    if (mappedStatus !== "all") {
      search.set("mappedStatus", mappedStatus);
    }
    if (page !== 1) {
      search.set("page", String(page));
    }
    return search;
  }, [q, yearInput, lifecycleStatus, mappedStatus, page]);

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
                    onClick={() => navigate({
                      pathname: `/belege/${row.id}`,
                      search: listQuery.toString() ? `?${listQuery.toString()}` : "",
                    })}
                  >
                    <TableCell className="px-2 py-2 font-mono text-[11px]">{row.id}</TableCell>
                    <TableCell className="px-2 py-2 text-[11px]">{formatDate(row.document_date)}</TableCell>
                    <TableCell className="max-w-[220px] px-2 py-2">
                      <p className="truncate font-medium">{row.original_filename ?? `Dokument ${row.id}`}</p>
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
    </div>
  );
}
