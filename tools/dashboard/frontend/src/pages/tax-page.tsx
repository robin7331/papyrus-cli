import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import type {
  OssReportResponse,
  TaxMonthlyReportResponse,
  TaxRecomputeResponse,
  TaxReviewQueueItem,
  TaxReviewQueueResponse,
} from "@/lib/types";
import { formatEuro, formatInt } from "@/lib/utils";

function confidenceLabel(confidence: number): string {
  if (confidence >= 0.85) {
    return "hoch";
  }
  if (confidence >= 0.5) {
    return "mittel";
  }
  return "niedrig";
}

export function TaxPage() {
  const queryClient = useQueryClient();

  const [year, setYear] = useState("2023");
  const [period, setPeriod] = useState("");
  const [status, setStatus] = useState("review_required");
  const [queuePage, setQueuePage] = useState(1);

  const monthlyQuery = useQuery({
    queryKey: ["tax-reports-monthly", year],
    queryFn: () => apiGet<TaxMonthlyReportResponse>("/tax/reports/monthly", { year }),
  });

  const ossQuery = useQuery({
    queryKey: ["tax-reports-oss", year],
    queryFn: () => apiGet<OssReportResponse>("/tax/reports/oss", { year }),
  });

  const reviewParams = useMemo(
    () => ({
      status,
      period: period || undefined,
      page: queuePage,
      pageSize: 25,
    }),
    [status, period, queuePage],
  );

  const reviewQuery = useQuery({
    queryKey: ["tax-review-queue", reviewParams],
    queryFn: () => apiGet<TaxReviewQueueResponse>("/tax/review-queue", reviewParams),
  });

  const recomputeMutation = useMutation({
    mutationFn: () => apiPost<TaxRecomputeResponse>("/tax/recompute", { year: Number(year) }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tax-reports-monthly", year] }),
        queryClient.invalidateQueries({ queryKey: ["tax-reports-oss", year] }),
        queryClient.invalidateQueries({ queryKey: ["tax-review-queue"] }),
      ]);
    },
  });

  const patchMutation = useMutation({
    mutationFn: ({ transactionId, payload }: { transactionId: number; payload: Record<string, unknown> }) =>
      apiPatch(`/tax/transactions/${transactionId}/determination`, payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tax-reports-monthly", year] }),
        queryClient.invalidateQueries({ queryKey: ["tax-reports-oss", year] }),
        queryClient.invalidateQueries({ queryKey: ["tax-review-queue"] }),
      ]);
    },
  });

  const queue = reviewQuery.data;
  const totals = monthlyQuery.data?.totals;

  function finalizeDefault(item: TaxReviewQueueItem) {
    const taxCode = item.amount_cents >= 0 ? "DE_OUTPUT_19" : "DE_INPUT_19";
    patchMutation.mutate({
      transactionId: item.bank_transaction_id,
      payload: {
        status: "final",
        taxCode,
        taxRateBps: 1900,
        confidence: 0.7,
        evidenceLevel: item.linked_document_count > 0 ? "medium" : "low",
        reasonCodes: ["manual_default_19"],
      },
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Steuer / MwSt</h2>
          <p className="text-sm text-muted-foreground">
            Konservative Tax-Engine mit Review-Queue, Monatsreport, OSS-Auswertung und manueller Finalisierung.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            className="w-[120px]"
            value={year}
            onChange={(event) => setYear(event.target.value)}
            placeholder="Jahr"
          />
          <Button disabled={recomputeMutation.isPending} onClick={() => recomputeMutation.mutate()}>
            {recomputeMutation.isPending ? "Recompute läuft..." : "Tax-Recompute"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <Card>
          <CardHeader>
            <CardTitle>Output USt</CardTitle>
          </CardHeader>
          <CardContent className="text-xl font-semibold">{formatEuro(totals?.output_tax_cents ?? 0)}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Vorsteuer</CardTitle>
          </CardHeader>
          <CardContent className="text-xl font-semibold">{formatEuro(totals?.input_tax_cents ?? 0)}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Zahllast</CardTitle>
          </CardHeader>
          <CardContent className="text-xl font-semibold">{formatEuro(totals?.net_liability_cents ?? 0)}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Unsichere Fälle</CardTitle>
          </CardHeader>
          <CardContent className="text-xl font-semibold">{formatInt(totals?.uncertain_case_count ?? 0)}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Unsichere USt</CardTitle>
          </CardHeader>
          <CardContent className="text-xl font-semibold">{formatEuro(totals?.uncertain_tax_cents ?? 0)}</CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Monatsreport</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Periode</TableHead>
                  <TableHead className="text-right">Output</TableHead>
                  <TableHead className="text-right">Vorsteuer</TableHead>
                  <TableHead className="text-right">Zahllast</TableHead>
                  <TableHead className="text-right">Unsicher</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(monthlyQuery.data?.items ?? []).map((row) => (
                  <TableRow key={row.period}>
                    <TableCell>{row.period}</TableCell>
                    <TableCell className="text-right">{formatEuro(row.output_tax_cents)}</TableCell>
                    <TableCell className="text-right">{formatEuro(row.input_tax_cents)}</TableCell>
                    <TableCell className="text-right">{formatEuro(row.net_liability_cents)}</TableCell>
                    <TableCell className="text-right">{formatInt(row.uncertain_case_count)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>OSS-Auswertung</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Periode</TableHead>
                  <TableHead>Land</TableHead>
                  <TableHead className="text-right">Basis</TableHead>
                  <TableHead className="text-right">Steuer</TableHead>
                  <TableHead className="text-right">Zeilen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(ossQuery.data?.items ?? []).map((row, index) => (
                  <TableRow key={`${row.period}-${row.oss_country_code}-${index}`}>
                    <TableCell>{row.period}</TableCell>
                    <TableCell>{row.oss_country_code}</TableCell>
                    <TableCell className="text-right">{formatEuro(row.base_cents)}</TableCell>
                    <TableCell className="text-right">{formatEuro(row.tax_cents)}</TableCell>
                    <TableCell className="text-right">{formatInt(row.line_count)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Review Queue</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <Input placeholder="Periode YYYY-MM" value={period} onChange={(event) => { setPeriod(event.target.value); setQueuePage(1); }} />
            <Select value={status} onValueChange={(value) => { setStatus(value); setQueuePage(1); }}>
              <SelectTrigger>
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="review_required">review_required</SelectItem>
                <SelectItem value="draft">draft</SelectItem>
                <SelectItem value="final">final</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tx</TableHead>
                <TableHead>Datum</TableHead>
                <TableHead className="text-right">Betrag</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead>Dok.</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Aktion</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(queue?.items ?? []).map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.bank_transaction_id}</TableCell>
                  <TableCell>{item.booking_date}</TableCell>
                  <TableCell className="text-right">{formatEuro(item.amount_cents)}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{item.status}</Badge>
                  </TableCell>
                  <TableCell>{confidenceLabel(item.confidence)}</TableCell>
                  <TableCell>{item.linked_document_count}</TableCell>
                  <TableCell className="max-w-[260px] truncate">{item.reason_codes_json}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" disabled={patchMutation.isPending} onClick={() => finalizeDefault(item)}>
                        Final 19%
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={patchMutation.isPending}
                        onClick={() =>
                          patchMutation.mutate({
                            transactionId: item.bank_transaction_id,
                            payload: {
                              status: "review_required",
                              confidence: 0.3,
                              reasonCodes: ["manual_review"],
                            },
                          })
                        }
                      >
                        Review
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Treffer: {formatInt(queue?.total ?? 0)}</p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={queuePage <= 1} onClick={() => setQueuePage((value) => Math.max(1, value - 1))}>
                Zurück
              </Button>
              <Badge variant="secondary">Seite {queuePage}</Badge>
              <Button
                variant="outline"
                size="sm"
                disabled={(queue?.items.length ?? 0) < (queue?.pageSize ?? 25)}
                onClick={() => setQueuePage((value) => value + 1)}
              >
                Weiter
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {recomputeMutation.data ? (
        <p className="text-sm text-muted-foreground">
          Recompute: {recomputeMutation.data.processed} verarbeitet, {recomputeMutation.data.final_count} final, {recomputeMutation.data.review_count} review,
          {" "}
          {recomputeMutation.data.skipped_manual_final_count} manuelle Finals geschützt.
        </p>
      ) : null}
    </div>
  );
}
