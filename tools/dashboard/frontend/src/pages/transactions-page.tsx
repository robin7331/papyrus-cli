import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { DateRangeFilters } from "@/components/layout/date-range-filters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiGet } from "@/lib/api";
import type { DocumentStatus, TransactionsResponse } from "@/lib/types";
import { formatEuro } from "@/lib/utils";

const TRANSACTIONS_FILTERS_STORAGE_KEY = "dashboard.transactions.filters";

type TransactionsFiltersState = {
  from: string;
  to: string;
  q: string;
  txType: string;
  documentStatus: string;
  page: number;
};

function parseStoredTransactionsFilters(): Partial<TransactionsFiltersState> {
  try {
    const raw = globalThis.localStorage.getItem(TRANSACTIONS_FILTERS_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed as Partial<TransactionsFiltersState>;
  } catch {
    return {};
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

function buildListSearch(params: {
  from: string;
  to: string;
  q: string;
  txType: string;
  documentStatus: string;
  page: number;
}) {
  const search = new URLSearchParams();
  if (params.from) search.set("from", params.from);
  if (params.to) search.set("to", params.to);
  if (params.q) search.set("q", params.q);
  if (params.txType !== "all") search.set("txType", params.txType);
  if (params.documentStatus !== "all") search.set("documentStatus", params.documentStatus);
  if (params.page > 1) search.set("page", String(params.page));
  return search;
}

export function TransactionsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [txType, setTxType] = useState("all");
  const [documentStatus, setDocumentStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [filtersHydrated, setFiltersHydrated] = useState(false);

  useEffect(() => {
    const stored = parseStoredTransactionsFilters();
    const nextFrom = searchParams.get("from") ?? (typeof stored.from === "string" ? stored.from : "");
    const nextTo = searchParams.get("to") ?? (typeof stored.to === "string" ? stored.to : "");
    const nextQ = searchParams.get("q") ?? (typeof stored.q === "string" ? stored.q : "");
    const nextTxType = searchParams.get("txType") ?? (typeof stored.txType === "string" ? stored.txType : "all");
    const nextStatus = searchParams.get("documentStatus") ?? (typeof stored.documentStatus === "string" ? stored.documentStatus : "all");
    const nextPageFromQuery = Number(searchParams.get("page"));
    const nextPageFromStorage = typeof stored.page === "number" ? stored.page : Number.NaN;
    const nextPage = Number.isInteger(nextPageFromQuery) && nextPageFromQuery > 0
      ? nextPageFromQuery
      : Number.isInteger(nextPageFromStorage) && nextPageFromStorage > 0
        ? nextPageFromStorage
        : 1;

    setFrom(nextFrom);
    setTo(nextTo);
    setQ(nextQ);
    setTxType(
      nextTxType === "Lastschrift" || nextTxType === "Gutschrift/Überweisung" || nextTxType === "Unbekannt" ? nextTxType : "all",
    );
    setDocumentStatus(
      nextStatus === "offen" || nextStatus === "zugeordnet" || nextStatus === "in_klaerung" || nextStatus === "nicht_erforderlich"
        ? nextStatus
        : "all",
    );
    setPage(nextPage);
    setFiltersHydrated(true);
  }, [searchParams]);

  useEffect(() => {
    if (!filtersHydrated) {
      return;
    }
    const value: TransactionsFiltersState = {
      from,
      to,
      q,
      txType,
      documentStatus,
      page,
    };
    globalThis.localStorage.setItem(TRANSACTIONS_FILTERS_STORAGE_KEY, JSON.stringify(value));
  }, [filtersHydrated, from, to, q, txType, documentStatus, page]);

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

  const data = transactionsQuery.data;
  const totalPages = data ? Math.max(Math.ceil(data.total / data.pageSize), 1) : 1;
  const listSearch = buildListSearch({ from, to, q, txType, documentStatus, page });

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
          <CardTitle>Treffer: {data?.total ?? 0}</CardTitle>
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
                <TableHead className="w-[96px]">Buchung</TableHead>
                <TableHead className="w-[110px]">Typ</TableHead>
                <TableHead className="w-[210px]">Belegstatus</TableHead>
                <TableHead className="w-[190px]">Gegenpartei</TableHead>
                <TableHead>Verwendungszweck</TableHead>
                <TableHead className="w-[110px] text-right">Betrag</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.items ?? []).map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() =>
                    navigate({
                      pathname: `/transactions/${row.id}`,
                      search: listSearch.toString() ? `?${listSearch.toString()}` : "",
                    })
                  }
                >
                  <TableCell className="px-2 py-2">{row.booking_date}</TableCell>
                  <TableCell className="px-2 py-2">
                    <Badge variant="outline">{row.tx_type}</Badge>
                  </TableCell>
                  <TableCell className="px-2 py-2">
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
                  <TableCell className="max-w-[190px] truncate px-2 py-2">{row.counterparty_name ?? "-"}</TableCell>
                  <TableCell className="max-w-[320px] truncate px-2 py-2">{row.purpose ?? "-"}</TableCell>
                  <TableCell className="px-2 py-2 text-right font-medium">{formatEuro(row.amount_cents)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {transactionsQuery.isError ? <p className="mt-3 text-sm text-destructive">Transaktionen konnten nicht geladen werden.</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
