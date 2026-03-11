export type FlashProps = {
    success: string | null;
    error: string | null;
};

export type SortDirection = 'asc' | 'desc';

export type PaginationData<T> = {
    data: T[];
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
    from: number | null;
    to: number | null;
};

export type TransactionSortKey =
    | 'booking_date'
    | 'amount_cents'
    | 'balance_after_cents'
    | 'account_number';

export type BelegSortKey =
    | 'document_date'
    | 'gross_amount_cents'
    | 'issuer_name'
    | 'invoice_number';

export type TransactionRow = {
    id: number;
    source_year: number;
    account_number: string;
    statement_sequence: number;
    statement_no: string;
    row_index: number;
    booking_date: string | null;
    transaction_type: string;
    booking_text: string;
    debit_cents: number | null;
    credit_cents: number | null;
    amount_cents: number;
    balance_after_cents: number;
    belege_count: number;
    is_associated: boolean;
    synced_at: string | null;
};

export type BelegRow = {
    id: number;
    source_year: number;
    document_date: string | null;
    issuer_name: string | null;
    invoice_number: string | null;
    subject: string | null;
    summary_short: string | null;
    document_type: string | null;
    gross_amount_cents: number | null;
    target_basename: string;
    pdf_available: boolean;
    transactions_count: number;
    is_associated: boolean;
    synced_at: string | null;
};

export type TransactionAssociationBelegRow = BelegRow & {
    is_associated: boolean;
    days_offset: number | null;
};

export type BelegAssociationTransactionRow = TransactionRow & {
    is_associated: boolean;
    days_offset: number | null;
};

export type YearSyncState = {
    year: number;
    database_path: string;
    source_has_belege: boolean;
    source_has_transactions: boolean;
    has_belege: boolean;
    has_transactions: boolean;
    last_seen_belege_count: number;
    last_seen_transaction_count: number;
    last_synced_at: string | null;
    last_error: string | null;
};

export type HomeStats = {
    transaction_count: number;
    beleg_count: number;
    missing_pdf_count: number;
    missing_counterparty_count: number;
    latest_synced_year: number | null;
    latest_synced_at: string | null;
    years_pending_sync: number;
};

export type TransactionSummary = {
    total_count: number;
    credit_total_cents: number;
    debit_total_cents: number;
    latest_booking_date: string | null;
};

export type BelegSummary = {
    total_count: number;
    gross_total_cents: number;
    with_pdf_count: number;
    missing_supplier_count: number;
};

export type HomePageProps = {
    availableYears: number[];
    selectedYear: string;
    yearSyncStates: YearSyncState[];
    stats: HomeStats;
    recentTransactions: TransactionRow[];
    recentBelege: BelegRow[];
};

export type TransactionsPageProps = {
    availableYears: number[];
    selectedYear: string;
    filters: TransactionIndexState;
    summary: TransactionSummary;
    transactions: PaginationData<TransactionRow>;
};

export type TransactionIndexState = {
    year: string;
    search: string;
    exact_amount: string;
    sort: TransactionSortKey;
    dir: SortDirection;
    page: number;
};

export type TransactionDateWindow = {
    from: string | null;
    to: string | null;
    days: number;
};

export type TransactionDetailPageProps = {
    indexState: TransactionIndexState;
    transaction: TransactionRow;
    dateWindow: TransactionDateWindow;
    nearbyBelege: TransactionAssociationBelegRow[];
    associatedBelegeOutsideWindow: TransactionAssociationBelegRow[];
};

export type BelegePageProps = {
    availableYears: number[];
    selectedYear: string;
    filters: BelegIndexState;
    summary: BelegSummary;
    belege: PaginationData<BelegRow>;
};

export type BelegIndexState = {
    year: string;
    search: string;
    exact_amount: string;
    sort: BelegSortKey;
    dir: SortDirection;
    page: number;
};

export type BelegDateWindow = {
    from: string | null;
    to: string | null;
    days: number;
};

export type BwaEstimateBucket =
    | 'excluded_private_or_financing'
    | 'separate_tax_payment'
    | 'operating_inflow'
    | 'operating_outflow';

export type BwaEstimateProfitStatus = 'profit' | 'loss' | 'break_even';

export type BwaEstimateSummary = {
    total_transaction_count: number;
    operating_transaction_count: number;
    excluded_transaction_count: number;
    separate_tax_transaction_count: number;
    input_vat_transaction_count: number;
    operating_inflow_gross_cents: number;
    assumed_output_vat_cents: number;
    assumed_input_vat_cents: number;
    estimated_net_vat_payable_cents: number;
    assumed_revenue_net_cents: number;
    operating_outflow_gross_cents: number;
    assumed_expense_net_cents: number;
    estimated_operating_profit_cents: number;
    separate_tax_movement_cents: number;
    excluded_net_movement_cents: number;
    profit_status: BwaEstimateProfitStatus;
};

export type BwaEstimateMonth = {
    month: string;
    label: string;
    transaction_count: number;
    operating_inflow_gross_cents: number;
    assumed_output_vat_cents: number;
    assumed_input_vat_cents: number;
    estimated_net_vat_payable_cents: number;
    assumed_revenue_net_cents: number;
    operating_outflow_gross_cents: number;
    assumed_expense_net_cents: number;
    estimated_operating_profit_cents: number;
    separate_tax_movement_cents: number;
    excluded_net_movement_cents: number;
};

export type BwaEstimateTransactionRow = {
    id: number;
    source_year: number;
    account_number: string;
    statement_no: string;
    booking_date: string | null;
    transaction_type: string;
    booking_text: string;
    amount_cents: number;
    assumed_input_vat_cents: number;
    bucket: BwaEstimateBucket;
    bucket_label: string;
    classification_reason: string;
};

export type BwaEstimatePageProps = {
    availableYears: number[];
    selectedYear: number | null;
    estimateLabel: string;
    methodologyNotes: string[];
    summary: BwaEstimateSummary | null;
    months: BwaEstimateMonth[];
    transactions: BwaEstimateTransactionRow[];
};

export type BelegDetailPageProps = {
    indexState: BelegIndexState;
    beleg: BelegRow;
    dateWindow: BelegDateWindow;
    nearbyTransactions: BelegAssociationTransactionRow[];
    associatedTransactionsOutsideWindow: BelegAssociationTransactionRow[];
};
