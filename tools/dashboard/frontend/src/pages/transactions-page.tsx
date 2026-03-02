import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DateRangeFilters } from "@/components/layout/date-range-filters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiGet } from "@/lib/api";
import type { TransactionDetailResponse, TransactionsResponse } from "@/lib/types";
import { formatEuro, formatInt } from "@/lib/utils";

export function TransactionsPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [txType, setTxType] = useState("all");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const params = useMemo(
    () => ({
      from,
      to,
      q,
      txType: txType === "all" ? undefined : txType,
      page,
      pageSize: 25,
    }),
    [from, to, q, txType, page],
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

  const data = transactionsQuery.data;
  const totalPages = data ? Math.max(Math.ceil(data.total / data.pageSize), 1) : 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Transaktionen</h2>
          <p className="text-sm text-muted-foreground">Filterbare Sicht auf `bank_transactions` mit Drilldown.</p>
        </div>
        <div className="grid gap-3 lg:grid-cols-4">
          <DateRangeFilters from={from} to={to} onFromChange={(value) => { setFrom(value); setPage(1); }} onToChange={(value) => { setTo(value); setPage(1); }} />
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
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Treffer: {formatInt(data?.total ?? 0)}</CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => Math.max(value - 1, 1))}>
              Zurück
            </Button>
            <Badge variant="secondary">Seite {page} / {totalPages}</Badge>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((value) => Math.min(value + 1, totalPages))}
            >
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
                  <TableCell className="max-w-[220px] truncate">{row.counterparty_name ?? "-"}</TableCell>
                  <TableCell className="max-w-[420px] truncate">{row.purpose ?? "-"}</TableCell>
                  <TableCell className="text-right font-medium">{formatEuro(row.amount_cents)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Sheet open={selectedId !== null} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Transaktionsdetails</SheetTitle>
            <SheetDescription>Mit verknüpften Statement-, Raw- und Audit-Daten.</SheetDescription>
          </SheetHeader>

          {detailQuery.data ? (
            <div className="mt-6 space-y-5 overflow-y-auto pr-2 text-sm">
              <Card>
                <CardHeader>
                  <CardTitle>Stammdaten</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  {Object.entries(detailQuery.data.transaction).map(([key, value]) => (
                    <div key={key} className="grid grid-cols-2 gap-2 border-b py-1">
                      <span className="font-medium text-muted-foreground">{key}</span>
                      <span className="break-all">{String(value ?? "")}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Raw-Zeilen ({detailQuery.data.raw_rows.length})</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  {detailQuery.data.raw_rows.map((row, index) => (
                    <pre key={index} className="overflow-x-auto rounded-md bg-secondary p-2">
                      {JSON.stringify(row, null, 2)}
                    </pre>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Audit-Zeilen ({detailQuery.data.audit_rows.length})</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  {detailQuery.data.audit_rows.map((row, index) => (
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
