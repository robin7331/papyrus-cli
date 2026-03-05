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

export type DocumentStatus = "offen" | "zugeordnet" | "nicht_erforderlich" | "in_klaerung";

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
  document_status: DocumentStatus;
  missing_invoice_flag: 0 | 1;
  linked_documents_count: number;
  pending_match_suggestions_count: number;
};

export type TransactionsResponse = {
  items: TransactionRow[];
  page: number;
  pageSize: number;
  total: number;
};

export type LinkedDocument = {
  id: number;
  link_role: "primary" | "supporting";
  link_origin: "manual" | "auto_confirmed" | "import";
  confidence: number | null;
  is_active: 0 | 1;
  created_at: string;
  created_by: string | null;
  document_id: number;
  year: number;
  source_type: string;
  lifecycle_status: string;
  storage_rel_path: string;
  original_filename: string | null;
  mime_type: string | null;
  file_size_bytes: number;
  file_sha256: string;
  document_date: string | null;
  issuer_name: string | null;
  invoice_number: string | null;
  gross_amount_cents: number | null;
  currency: string;
};

export type MatchSuggestion = {
  id: number;
  document_id: number;
  matcher_name: string;
  matcher_version: string;
  score: number;
  reason_codes_json: string;
  status: "pending" | "accepted" | "rejected" | "auto_applied" | "expired";
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
  storage_rel_path: string;
  original_filename: string | null;
  source_type: string;
  document_date: string | null;
  issuer_name: string | null;
  invoice_number: string | null;
  gross_amount_cents: number | null;
  currency: string;
};

export type DocumentStatusHistoryRow = {
  id: number;
  old_status: DocumentStatus | null;
  new_status: DocumentStatus;
  reason: string | null;
  changed_by: string | null;
  changed_at: string;
};

export type TransactionDetail = {
  id: number;
  account_id: number;
  statement_doc_id: number;
  booking_date: string;
  valuta_date: string | null;
  amount_cents: number;
  currency: string;
  running_balance_cents: number | null;
  purpose: string | null;
  counterparty_name: string | null;
  counterparty_iban: string | null;
  counterparty_bic: string | null;
  reference: string | null;
  tx_type: string | null;
  fingerprint: string;
  is_reversal: 0 | 1;
  document_status: DocumentStatus;
  missing_invoice_flag: 0 | 1;
  document_status_updated_at: string | null;
  document_note: string | null;
  statement_no: string | null;
  period_from: string | null;
  period_to: string | null;
  opening_balance_cents: number | null;
  closing_balance_cents: number | null;
  file_path: string | null;
  statement_file_url: string | null;
  account_iban: string | null;
  year: number | null;
  file_sha256: string | null;
};

export type TransactionDetailResponse = {
  transaction: TransactionDetail;
  raw_rows: Array<Record<string, unknown>>;
  audit_rows: Array<Record<string, unknown>>;
  linked_documents: LinkedDocument[];
  match_suggestions: MatchSuggestion[];
  document_status_history: DocumentStatusHistoryRow[];
  tax_determination: TaxDetermination | null;
};

export type DocumentDetailResponse = {
  document: DocumentListItem;
};

export type StatementDetailTransactionRow = {
  id: number;
  booking_date: string;
  valuta_date: string | null;
  amount_cents: number;
  currency: string;
  purpose: string | null;
  counterparty_name: string | null;
  reference: string | null;
  tx_type: string | null;
  document_status: DocumentStatus;
  missing_invoice_flag: 0 | 1;
  linked_documents_count: number;
};

export type StatementDetailResponse = {
  statement: {
    id: number;
    statement_no: string | null;
    period_from: string | null;
    period_to: string | null;
    opening_balance_cents: number | null;
    closing_balance_cents: number | null;
    account_iban: string | null;
    file_sha256: string | null;
    file_path: string | null;
    statement_file_url: string | null;
    transaction_count: number;
  };
  transactions: StatementDetailTransactionRow[];
};

export type UploadDocumentResponse = {
  transaction_id: number;
  deduplicated: boolean;
  document: Record<string, unknown>;
  link: Record<string, unknown>;
  new_status: DocumentStatus;
};

export type MatchSuggestionsRefreshResponse = {
  ok: boolean;
  transaction_id: number;
  has_active_link: boolean;
  expired_count: number;
  candidate_count: number;
  suggestions: MatchSuggestion[];
};

export type MatchSelectionResponse = {
  ok: boolean;
  transaction_id: number;
  linked_document_ids: number[];
  new_status: DocumentStatus;
};

export type NextOpenTransactionResponse = {
  nextTransactionId: number | null;
};

export type DocumentListItem = {
  id: number;
  year: number;
  source_type: "email" | "scan" | "portal" | "manuell" | "sonstiges";
  lifecycle_status: "inbox" | "archiviert" | "verworfen";
  storage_rel_path: string;
  original_filename: string | null;
  mime_type: string | null;
  file_size_bytes: number;
  file_sha256: string;
  document_date: string | null;
  issuer_name: string | null;
  invoice_number: string | null;
  gross_amount_cents: number | null;
  net_amount_cents?: number | null;
  vat_amount_cents?: number | null;
  vat_rate_bps?: number | null;
  subject?: string | null;
  summary_short?: string | null;
  ocr_text?: string | null;
  ocr_confidence?: number | null;
  ai_confidence?: number | null;
  review_required?: 0 | 1;
  extraction_model?: string | null;
  metadata_json?: string | null;
  created_at: string;
  updated_at: string;
  linked_transactions_count: number;
  linked_inflow_count?: number;
  linked_outflow_count?: number;
};

export type DocumentsResponse = {
  items: DocumentListItem[];
  page: number;
  pageSize: number;
  total: number;
};

export type DocumentMatchTransactionSuggestion = {
  transaction_id: number;
  booking_date: string;
  amount_cents: number;
  purpose: string | null;
  counterparty_name: string | null;
  reference: string | null;
  tx_type: string | null;
  document_status: DocumentStatus;
  linked_documents_count: number;
  score: number;
  reason_codes_json: string;
};

export type DocumentMatchTransactionsResponse = {
  ok: boolean;
  document_id: number;
  candidate_count: number;
  suggestions: DocumentMatchTransactionSuggestion[];
};

export type DocumentLinkedTransaction = {
  link_id: number;
  link_role: "primary" | "supporting";
  link_origin: "manual" | "auto_confirmed" | "import";
  confidence: number | null;
  created_at: string;
  created_by: string | null;
  transaction_id: number;
  booking_date: string;
  valuta_date: string | null;
  amount_cents: number;
  currency: string;
  purpose: string | null;
  counterparty_name: string | null;
  reference: string | null;
  tx_type: string | null;
  document_status: DocumentStatus;
  statement_doc_id: number | null;
  missing_invoice_flag: 0 | 1;
};

export type DocumentLinkedTransactionsResponse = {
  document_id: number;
  total: number;
  items: DocumentLinkedTransaction[];
};

export type DocumentRescanResponse = {
  ok: boolean;
  document_id: number;
  document: DocumentListItem;
  rescan: {
    model: string;
    ocr_pages: number | null;
    used_uploaded_pdf: boolean;
  };
};

export type DocumentPatchPayload = {
  documentDate?: string | null;
  issuerName?: string | null;
  invoiceNumber?: string | null;
  subject?: string | null;
  summaryShort?: string | null;
  documentType?: string | null;
  grossAmountCents?: number | null;
  netAmountCents?: number | null;
  vatAmountCents?: number | null;
  vatRateBps?: number | null;
  vatTreatment?: "VAT_19" | "VAT_0" | "VAT_OSS" | "VAT_EXPORT" | "VAT_REVERSE_CHARGE" | "VAT_UNKNOWN";
  countryCode?: string | null;
  notes?: string[];
  reviewRequired?: boolean;
  ocrText?: string | null;
  aiConfidence?: number | null;
  ocrConfidence?: number | null;
  changeReason?: string;
};

export type DocumentPatchResponse = {
  ok: boolean;
  document_id: number;
  document: DocumentListItem;
  changed_fields: string[];
  expired_match_suggestions: number;
  linked_transaction_ids: number[];
  tax_recompute: Array<{
    transaction_id: number;
    ok: boolean;
    skipped_manual_final?: boolean;
    forced_final?: boolean;
    message?: string;
  }>;
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

export type TaxMonthlyReportRow = {
  period: string;
  output_tax_cents: number;
  input_tax_cents: number;
  net_liability_cents: number;
  uncertain_case_count: number;
  uncertain_tax_cents: number;
  generated_at: string;
};

export type TaxMonthlyReportResponse = {
  year: number;
  items: TaxMonthlyReportRow[];
  totals: {
    output_tax_cents: number;
    input_tax_cents: number;
    net_liability_cents: number;
    uncertain_case_count: number;
    uncertain_tax_cents: number;
  };
};

export type TaxReviewQueueItem = {
  id: number;
  bank_transaction_id: number;
  status: "draft" | "final" | "review_required";
  tax_code: string | null;
  tax_rate_bps: number | null;
  net_amount_cents: number | null;
  tax_amount_cents: number | null;
  country_code: string | null;
  evidence_level: "low" | "medium" | "high";
  confidence: number;
  calculation_mode: "auto" | "manual";
  reason_codes_json: string;
  updated_at: string;
  booking_date: string;
  amount_cents: number;
  purpose: string | null;
  counterparty_name: string | null;
  linked_document_count: number;
};

export type TaxReviewQueueResponse = {
  items: TaxReviewQueueItem[];
  page: number;
  pageSize: number;
  total: number;
};

export type TaxRecomputeResponse = {
  year: number;
  processed: number;
  final_count: number;
  review_count: number;
  skipped_manual_final_count: number;
};

export type TaxRecomputeFromLinksResponse = {
  ok: boolean;
  transaction_id: number;
  skipped_manual_final: boolean;
  determination: TaxDetermination | null;
};

export type OssReportRow = {
  period: string;
  oss_country_code: string;
  base_cents: number;
  tax_cents: number;
  line_count: number;
};

export type OssReportResponse = {
  year: number;
  items: OssReportRow[];
};

export type TaxDetermination = {
  id: number;
  bank_transaction_id: number;
  status: "draft" | "final" | "review_required";
  calculation_mode: "auto" | "manual";
  tax_code: string | null;
  tax_rate_bps: number | null;
  net_amount_cents: number | null;
  tax_amount_cents: number | null;
  country_code: string | null;
  counterparty_vat_id: string | null;
  evidence_level: "low" | "medium" | "high";
  confidence: number;
  reason_codes_json: string;
  source_snapshot_json: string;
  decided_at: string | null;
  decided_by: string | null;
  updated_at: string;
};
