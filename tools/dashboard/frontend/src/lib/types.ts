export type DateRange = {
  from?: string;
  to?: string;
};

export type OverviewResponse = {
  counts: Record<string, number>;
  range: {
    min_booking_date: string | null;
    max_booking_date: string | null;
  };
};

export type KpisResponse = {
  total_inflow_cents: number;
  total_outflow_cents: number;
  net_cents: number;
  tx_count: number;
  distinct_counterparties: number;
};

export type MonthlyCashflowPoint = {
  month: string;
  inflow_cents: number;
  outflow_cents: number;
  net_cents: number;
  tx_count: number;
};

export type TxTypeDistributionPoint = {
  tx_type: string;
  count: number;
  amount_cents: number;
};

export type CounterpartyRow = {
  counterparty_name: string;
  tx_count: number;
  sum_cents: number;
  inflow_cents: number;
  outflow_cents: number;
};

export type TransactionRow = {
  id: number;
  booking_date: string;
  valuta_date: string | null;
  amount_cents: number;
  running_balance_cents: number | null;
  purpose: string | null;
  counterparty_name: string | null;
  reference: string | null;
  tx_type: string;
  statement_doc_id: number;
};

export type TransactionsResponse = {
  items: TransactionRow[];
  page: number;
  pageSize: number;
  total: number;
};

export type TransactionDetailResponse = {
  transaction: Record<string, unknown>;
  raw_rows: Array<Record<string, unknown>>;
  audit_rows: Array<Record<string, unknown>>;
};

export type ImportQualityResponse = {
  date_range: DateRange;
  entity_counts: Record<string, number>;
  audit_status_counts: Array<{ parse_status: string; count: number }>;
  raw_status_counts: Array<{ parse_status: string; count: number }>;
  transaction_coverage: {
    tx_total: number;
    tx_with_audit: number;
    tx_without_audit: number;
  };
  docs_without_transactions: number;
};
