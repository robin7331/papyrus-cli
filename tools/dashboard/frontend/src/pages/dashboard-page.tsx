import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DateRangeFilters } from "@/components/layout/date-range-filters";
import { MetricCard } from "@/components/layout/metric-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiGet } from "@/lib/api";
import type {
  CounterpartyRow,
  KpisResponse,
  MonthlyCashflowPoint,
  OverviewResponse,
  TxTypeDistributionPoint,
} from "@/lib/types";
import { formatEuro, formatInt } from "@/lib/utils";

const pieColors = ["#0284c7", "#0ea5e9", "#38bdf8", "#7dd3fc", "#334155"];

export function DashboardPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const queryParams = useMemo(() => ({ from, to }), [from, to]);

  const overviewQuery = useQuery({
    queryKey: ["overview"],
    queryFn: () => apiGet<OverviewResponse>("/meta/overview"),
  });

  useEffect(() => {
    if (!overviewQuery.data) {
      return;
    }

    if (!from && overviewQuery.data.range.min_booking_date) {
      setFrom(overviewQuery.data.range.min_booking_date);
    }
    if (!to && overviewQuery.data.range.max_booking_date) {
      setTo(overviewQuery.data.range.max_booking_date);
    }
  }, [overviewQuery.data, from, to]);

  const kpiQuery = useQuery({
    queryKey: ["kpis", queryParams],
    queryFn: () => apiGet<KpisResponse>("/kpis", queryParams),
  });

  const monthlyQuery = useQuery({
    queryKey: ["monthly-cashflow", queryParams],
    queryFn: () => apiGet<MonthlyCashflowPoint[]>("/charts/monthly-cashflow", queryParams),
  });

  const distributionQuery = useQuery({
    queryKey: ["tx-type-distribution", queryParams],
    queryFn: () => apiGet<TxTypeDistributionPoint[]>("/charts/tx-type-distribution", queryParams),
  });

  const counterpartiesQuery = useQuery({
    queryKey: ["top-counterparties", queryParams],
    queryFn: () => apiGet<CounterpartyRow[]>("/top/counterparties", { ...queryParams, limit: 10 }),
  });

  const kpis = kpiQuery.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Finanzübersicht</h2>
          <p className="text-sm text-muted-foreground">Kennzahlen und Bewegungen aus `bank_transactions`</p>
        </div>
        <DateRangeFilters from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard title="Einnahmen" value={formatEuro(kpis?.total_inflow_cents ?? 0)} />
        <MetricCard title="Ausgaben" value={formatEuro(kpis?.total_outflow_cents ?? 0)} />
        <MetricCard title="Netto" value={formatEuro(kpis?.net_cents ?? 0)} />
        <MetricCard title="Transaktionen" value={formatInt(kpis?.tx_count ?? 0)} />
        <MetricCard title="Gegenparteien" value={formatInt(kpis?.distinct_counterparties ?? 0)} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Monatlicher Cashflow</CardTitle>
          </CardHeader>
          <CardContent className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyQuery.data ?? []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis tickFormatter={(value) => formatEuro(Number(value))} />
                <Tooltip formatter={(value: number) => formatEuro(value)} />
                <Bar dataKey="inflow_cents" name="Einnahmen" fill="#0284c7" />
                <Bar dataKey="outflow_cents" name="Ausgaben" fill="#ef4444" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Verteilung nach Typ</CardTitle>
          </CardHeader>
          <CardContent className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={distributionQuery.data ?? []} dataKey="count" nameKey="tx_type" outerRadius={100} label>
                  {(distributionQuery.data ?? []).map((entry, index) => (
                    <Cell key={`${entry.tx_type}-${index}`} fill={pieColors[index % pieColors.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Nettoverlauf</CardTitle>
          </CardHeader>
          <CardContent className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyQuery.data ?? []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis tickFormatter={(value) => formatEuro(Number(value))} />
                <Tooltip formatter={(value: number) => formatEuro(value)} />
                <Line type="monotone" dataKey="net_cents" stroke="#0f766e" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top Gegenparteien</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Summe</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(counterpartiesQuery.data ?? []).map((row) => (
                  <TableRow key={row.counterparty_name}>
                    <TableCell className="max-w-[260px] truncate">{row.counterparty_name}</TableCell>
                    <TableCell className="text-right font-medium">{formatEuro(row.sum_cents)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {kpiQuery.isError || monthlyQuery.isError || distributionQuery.isError || counterpartiesQuery.isError ? (
        <p className="text-sm text-destructive">Mindestens ein Widget konnte nicht geladen werden.</p>
      ) : null}
    </div>
  );
}
