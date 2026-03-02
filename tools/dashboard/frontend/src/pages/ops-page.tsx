import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DateRangeFilters } from "@/components/layout/date-range-filters";
import { MetricCard } from "@/components/layout/metric-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiGet } from "@/lib/api";
import type { ImportQualityResponse } from "@/lib/types";
import { formatInt } from "@/lib/utils";

export function OpsPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const params = useMemo(() => ({ from, to }), [from, to]);

  const qualityQuery = useQuery({
    queryKey: ["import-quality", params],
    queryFn: () => apiGet<ImportQualityResponse>("/ops/import-quality", params),
  });

  const data = qualityQuery.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Import- und Parser-Qualität</h2>
          <p className="text-sm text-muted-foreground">Kennzahlen aus `statement_import_audit`, `bank_transactions_raw` und Referenztabellen.</p>
        </div>
        <DateRangeFilters from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Transaktionen (Filter)" value={formatInt(data?.transaction_coverage.tx_total ?? 0)} />
        <MetricCard title="Mit Audit" value={formatInt(data?.transaction_coverage.tx_with_audit ?? 0)} />
        <MetricCard title="Ohne Audit" value={formatInt(data?.transaction_coverage.tx_without_audit ?? 0)} />
        <MetricCard title="Docs ohne Transaktionen" value={formatInt(data?.docs_without_transactions ?? 0)} />
      </div>

      <Tabs defaultValue="counts">
        <TabsList>
          <TabsTrigger value="counts">Entity Counts</TabsTrigger>
          <TabsTrigger value="audit">Audit-Status</TabsTrigger>
          <TabsTrigger value="raw">Raw-Status</TabsTrigger>
        </TabsList>

        <TabsContent value="counts">
          <Card>
            <CardHeader>
              <CardTitle>Tabellenstände</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {Object.entries(data?.entity_counts ?? {}).map(([key, value]) => (
                <div key={key} className="grid grid-cols-2 gap-2 border-b py-1">
                  <span className="font-medium text-muted-foreground">{key}</span>
                  <span>{formatInt(value)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit">
          <Card>
            <CardHeader>
              <CardTitle>Audit parse_status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {(data?.audit_status_counts ?? []).map((row) => (
                <div key={row.parse_status} className="grid grid-cols-2 gap-2 border-b py-1">
                  <span className="font-medium text-muted-foreground">{row.parse_status}</span>
                  <span>{formatInt(row.count)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="raw">
          <Card>
            <CardHeader>
              <CardTitle>Raw parse_status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {(data?.raw_status_counts ?? []).map((row) => (
                <div key={row.parse_status} className="grid grid-cols-2 gap-2 border-b py-1">
                  <span className="font-medium text-muted-foreground">{row.parse_status}</span>
                  <span>{formatInt(row.count)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {qualityQuery.isError ? <p className="text-sm text-destructive">Die Ops-Daten konnten nicht geladen werden.</p> : null}
    </div>
  );
}
