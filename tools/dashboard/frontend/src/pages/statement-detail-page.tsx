import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DocumentPreviewPane } from "@/components/document-preview-pane";
import { apiGet } from "@/lib/api";
import type { StatementDetailResponse } from "@/lib/types";
import { formatEuro } from "@/lib/utils";

function formatDate(value: string | null): string {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" }).format(parsed);
}

function statusLabel(status: "offen" | "zugeordnet" | "nicht_erforderlich" | "in_klaerung"): string {
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

function formatMetaRows(items: Array<string | null>): string {
  return items.filter((item): item is string => typeof item === "string" && item.trim().length > 0).join(" · ") || "-";
}

export function StatementDetailPage() {
  const [searchParams] = useSearchParams();
  const { statementDocId: statementDocIdParam } = useParams<{ statementDocId: string }>();

  const statementDocId = Number(statementDocIdParam);
  const hasStatementDocId = Number.isInteger(statementDocId) && statementDocId > 0;
  const queryString = useMemo(() => searchParams.toString(), [searchParams]);
  const detailBack = queryString ? `/transactions?${queryString}` : "/transactions";

  const detailQuery = useQuery({
    queryKey: ["statement-doc", statementDocId],
    queryFn: () => apiGet<StatementDetailResponse>(`/statement-docs/${statementDocId}`),
    enabled: hasStatementDocId,
  });

  if (!hasStatementDocId) {
    return (
      <div className="space-y-4">
        <Button variant="outline" asChild>
          <Link to={detailBack}>Zurück zu Transaktionen</Link>
        </Button>
        <p className="text-sm text-destructive">Ungültige Auszugs-ID.</p>
      </div>
    );
  }

  if (detailQuery.isLoading && !detailQuery.data) {
    return <p className="text-sm text-muted-foreground">Lade Auszug ...</p>;
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <div className="space-y-4">
        <Button variant="outline" asChild>
          <Link to={detailBack}>Zurück zu Transaktionen</Link>
        </Button>
        <p className="text-sm text-destructive">Auszug konnte nicht geladen werden.</p>
      </div>
    );
  }

  const statement = detailQuery.data.statement;
  const transactions = detailQuery.data.transactions;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Kontoauszug #{statement.id}</h2>
          <p className="text-sm text-muted-foreground">Vollbildansicht mit Metadaten und Transaktionsliste.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link to={detailBack}>Zurück</Link>
          </Button>
          {statement.statement_file_url ? (
            <Button variant="outline" asChild>
              <a href={statement.statement_file_url} target="_blank" rel="noreferrer">
                PDF öffnen
              </a>
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Auszugsmetadaten</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 md:grid-cols-2">
              <p>
                <span className="text-muted-foreground">Auszug:</span> {statement.statement_no ?? "-"}
              </p>
              <p>
                <span className="text-muted-foreground">Periode:</span> {statement.period_from ?? "-"} bis {statement.period_to ?? "-"}
              </p>
              <p>
                <span className="text-muted-foreground">Konto IBAN:</span> {statement.account_iban ?? "-"}
              </p>
              <p>
                <span className="text-muted-foreground">Eröffnungs-Saldo:</span>{" "}
                {statement.opening_balance_cents === null ? "-" : formatEuro(statement.opening_balance_cents)}
              </p>
              <p>
                <span className="text-muted-foreground">Schluss-Saldo:</span>{" "}
                {statement.closing_balance_cents === null ? "-" : formatEuro(statement.closing_balance_cents)}
              </p>
              <p>
                <span className="text-muted-foreground">Transaktionen:</span> {statement.transaction_count}
              </p>
              <p>
                <span className="text-muted-foreground">Datei-Hash:</span> {statement.file_sha256 ?? "-"}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Transaktionen ({transactions.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {transactions.length === 0 ? <p className="text-xs text-muted-foreground">Keine Transaktionen in diesem Auszug.</p> : null}
              {transactions.map((tx) => (
                <div key={tx.id} className="space-y-2 rounded-md border p-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">
                      <Link className="underline underline-offset-2 hover:no-underline" to={`/transactions/${tx.id}${queryString ? `?${queryString}` : ""}`}>
                        Transaktion #{tx.id}
                      </Link>
                    </p>
                    <div className="flex flex-wrap gap-1">
                      <Badge variant="outline">{statusLabel(tx.document_status)}</Badge>
                      <Badge variant="secondary">{formatMetaRows([tx.tx_type])}</Badge>
                    </div>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    <p className="text-xs">
                      <span className="text-muted-foreground">Buchung:</span> {formatDate(tx.booking_date)}
                    </p>
                    <p className="text-xs">
                      <span className="text-muted-foreground">Betrag:</span> {formatEuro(tx.amount_cents)}
                    </p>
                    <p className="text-xs md:col-span-2">
                      <span className="text-muted-foreground">Zugeordnete Belege:</span> {tx.linked_documents_count}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground break-all">{formatMetaRows([tx.purpose, tx.counterparty_name, tx.reference])}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <DocumentPreviewPane
          title={`Auszug ${statement.statement_no ?? statement.id}`}
          url={statement.statement_file_url}
          mimeType="application/pdf"
          fileName={`Auszug-${statement.id}.pdf`}
          fallbackText="Auszugsvorschau nicht verfügbar."
        />
      </div>
    </div>
  );
}
