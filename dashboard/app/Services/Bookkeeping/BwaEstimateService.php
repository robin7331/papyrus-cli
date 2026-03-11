<?php

namespace App\Services\Bookkeeping;

use App\Models\ImportedTransaction;

class BwaEstimateService
{
    private const OUTPUT_VAT_SHARE_BPS = 7270;

    private const INPUT_VAT_SHARE_BPS = 8920;

    /**
     * @var list<array{pattern: string, reason: string}>
     */
    private const EXCLUSION_RULES = [
        [
            'pattern' => '/\bprivat\b/ui',
            'reason' => 'Privatbewegung erkannt',
        ],
        [
            'pattern' => '/\bgesellschafter\b/ui',
            'reason' => 'Gesellschafterbezug oder -einlage erkannt',
        ],
        [
            'pattern' => '/\bdarlehen\b/ui',
            'reason' => 'Darlehensbezug erkannt',
        ],
        [
            'pattern' => '/\beinlage\b/ui',
            'reason' => 'Einlage erkannt',
        ],
        [
            'pattern' => '/\bumbuchung\b/ui',
            'reason' => 'Umbuchung erkannt',
        ],
        [
            'pattern' => '/\bverrechnungskonto\b/ui',
            'reason' => 'Verrechnungskonto erkannt',
        ],
    ];

    /**
     * @var list<array{pattern: string, reason: string}>
     */
    private const TAX_PAYMENT_RULES = [
        [
            'pattern' => '/\bfinanzamt\b/ui',
            'reason' => 'Finanzamt-Bewegung erkannt',
        ],
        [
            'pattern' => '/\bumsatzsteuer\b/ui',
            'reason' => 'Umsatzsteuer-Bewegung erkannt',
        ],
        [
            'pattern' => '/\bust\b/ui',
            'reason' => 'USt-Bewegung erkannt',
        ],
        [
            'pattern' => '/\bvorsteuer\b/ui',
            'reason' => 'Vorsteuer-Bewegung erkannt',
        ],
        [
            'pattern' => '/\blohnsteuer\b/ui',
            'reason' => 'Lohnsteuer-Bewegung erkannt',
        ],
        [
            'pattern' => '/\bkörperschaftsteuer\b/ui',
            'reason' => 'Körperschaftsteuer-Bewegung erkannt',
        ],
        [
            'pattern' => '/\bkoerperschaftsteuer\b/ui',
            'reason' => 'Körperschaftsteuer-Bewegung erkannt',
        ],
        [
            'pattern' => '/\bgewerbesteuer\b/ui',
            'reason' => 'Gewerbesteuer-Bewegung erkannt',
        ],
        [
            'pattern' => '/\belster\b/ui',
            'reason' => 'ELSTER-Steuerbewegung erkannt',
        ],
    ];

    /**
     * @return array{
     *     summary: array{
     *         total_transaction_count: int,
     *         operating_transaction_count: int,
     *         excluded_transaction_count: int,
     *         separate_tax_transaction_count: int,
     *         input_vat_transaction_count: int,
     *         operating_inflow_gross_cents: int,
     *         assumed_output_vat_cents: int,
     *         assumed_input_vat_cents: int,
     *         estimated_net_vat_payable_cents: int,
     *         assumed_revenue_net_cents: int,
     *         operating_outflow_gross_cents: int,
     *         assumed_expense_net_cents: int,
     *         estimated_operating_profit_cents: int,
     *         separate_tax_movement_cents: int,
     *         excluded_net_movement_cents: int,
     *         profit_status: string
     *     },
     *     months: list<array{
     *         month: string,
     *         label: string,
     *         transaction_count: int,
     *         operating_inflow_gross_cents: int,
     *         assumed_output_vat_cents: int,
     *         assumed_input_vat_cents: int,
     *         estimated_net_vat_payable_cents: int,
     *         assumed_revenue_net_cents: int,
     *         operating_outflow_gross_cents: int,
     *         assumed_expense_net_cents: int,
     *         estimated_operating_profit_cents: int,
     *         separate_tax_movement_cents: int,
     *         excluded_net_movement_cents: int
     *     }>,
     *     transactions: list<array{
     *         id: int,
     *         source_year: int,
     *         account_number: string,
     *         statement_no: string,
     *         booking_date: string|null,
     *         transaction_type: string,
     *         booking_text: string,
     *         amount_cents: int,
     *         assumed_input_vat_cents: int,
     *         bucket: string,
     *         bucket_label: string,
     *         classification_reason: string
     *     }>
     * }
     */
    public function estimateForYear(int $year): array
    {
        $monthAggregates = $this->initializeMonthAggregates($year);
        $summaryAggregate = $this->emptyAggregate();

        $transactions = ImportedTransaction::query()
            ->where('source_year', $year)
            ->orderByDesc('booking_date')
            ->orderByDesc('id')
            ->get();

        $classifiedTransactions = $transactions->map(function (ImportedTransaction $transaction) use (&$monthAggregates, &$summaryAggregate): array {
            $classifiedTransaction = $this->classifyTransaction($transaction);
            $monthKey = $transaction->booking_date?->format('Y-m');

            $summaryAggregate = $this->mergeAggregate(
                $summaryAggregate,
                $classifiedTransaction,
            );

            if ($monthKey !== null && array_key_exists($monthKey, $monthAggregates)) {
                $monthAggregates[$monthKey] = $this->mergeAggregate(
                    $monthAggregates[$monthKey],
                    $classifiedTransaction,
                );
            }

            return $classifiedTransaction;
        })->values()->all();

        return [
            'summary' => $this->finalizeSummary($summaryAggregate),
            'months' => array_values(array_map(
                fn (array $aggregate): array => $this->finalizeMonth($aggregate),
                $monthAggregates,
            )),
            'transactions' => $classifiedTransactions,
        ];
    }

    /**
     * @return array<string, array<string, int|string>>
     */
    private function initializeMonthAggregates(int $year): array
    {
        $aggregates = [];

        foreach (range(1, 12) as $month) {
            $monthKey = sprintf('%d-%02d', $year, $month);
            $aggregates[$monthKey] = [
                ...$this->emptyAggregate(),
                'month' => $monthKey,
                'label' => sprintf('%02d/%d', $month, $year),
            ];
        }

        return $aggregates;
    }

    /**
     * @return array{
     *     total_transaction_count: int,
     *     operating_transaction_count: int,
     *     excluded_transaction_count: int,
     *     separate_tax_transaction_count: int,
     *     input_vat_transaction_count: int,
     *     operating_inflow_gross_cents: int,
     *     operating_outflow_gross_cents: int,
     *     assumed_input_vat_cents: int,
     *     separate_tax_movement_cents: int,
     *     excluded_net_movement_cents: int
     * }
     */
    private function emptyAggregate(): array
    {
        return [
            'total_transaction_count' => 0,
            'operating_transaction_count' => 0,
            'excluded_transaction_count' => 0,
            'separate_tax_transaction_count' => 0,
            'input_vat_transaction_count' => 0,
            'operating_inflow_gross_cents' => 0,
            'operating_outflow_gross_cents' => 0,
            'assumed_input_vat_cents' => 0,
            'separate_tax_movement_cents' => 0,
            'excluded_net_movement_cents' => 0,
        ];
    }

    /**
     * @param  array{
     *     total_transaction_count: int,
     *     operating_transaction_count: int,
     *     excluded_transaction_count: int,
     *     separate_tax_transaction_count: int,
     *     input_vat_transaction_count: int,
     *     operating_inflow_gross_cents: int,
     *     operating_outflow_gross_cents: int,
     *     assumed_input_vat_cents: int,
     *     separate_tax_movement_cents: int,
     *     excluded_net_movement_cents: int
     * }  $aggregate
     * @param  array{
     *     id: int,
     *     source_year: int,
     *     account_number: string,
     *     statement_no: string,
     *     booking_date: string|null,
     *     transaction_type: string,
     *     booking_text: string,
     *     amount_cents: int,
     *     assumed_input_vat_cents: int,
     *     bucket: string,
     *     bucket_label: string,
     *     classification_reason: string
     * }  $classifiedTransaction
     * @return array{
     *     total_transaction_count: int,
     *     operating_transaction_count: int,
     *     excluded_transaction_count: int,
     *     separate_tax_transaction_count: int,
     *     input_vat_transaction_count: int,
     *     operating_inflow_gross_cents: int,
     *     operating_outflow_gross_cents: int,
     *     assumed_input_vat_cents: int,
     *     separate_tax_movement_cents: int,
     *     excluded_net_movement_cents: int
     * }
     */
    private function mergeAggregate(array $aggregate, array $classifiedTransaction): array
    {
        $aggregate['total_transaction_count']++;

        if ($classifiedTransaction['bucket'] === 'operating_inflow') {
            $aggregate['operating_transaction_count']++;
            $aggregate['operating_inflow_gross_cents'] += $classifiedTransaction['amount_cents'];
        }

        if ($classifiedTransaction['bucket'] === 'operating_outflow') {
            $aggregate['operating_transaction_count']++;
            $aggregate['operating_outflow_gross_cents'] += abs($classifiedTransaction['amount_cents']);
            $aggregate['assumed_input_vat_cents'] += $classifiedTransaction['assumed_input_vat_cents'];

            if ($classifiedTransaction['assumed_input_vat_cents'] > 0) {
                $aggregate['input_vat_transaction_count']++;
            }
        }

        if ($classifiedTransaction['bucket'] === 'separate_tax_payment') {
            $aggregate['separate_tax_transaction_count']++;
            $aggregate['separate_tax_movement_cents'] += $classifiedTransaction['amount_cents'];
        }

        if ($classifiedTransaction['bucket'] === 'excluded_private_or_financing') {
            $aggregate['excluded_transaction_count']++;
            $aggregate['excluded_net_movement_cents'] += $classifiedTransaction['amount_cents'];
        }

        return $aggregate;
    }

    /**
     * @param  array{
     *     total_transaction_count: int,
     *     operating_transaction_count: int,
     *     excluded_transaction_count: int,
     *     separate_tax_transaction_count: int,
     *     operating_inflow_gross_cents: int,
     *     operating_outflow_gross_cents: int,
     *     separate_tax_movement_cents: int,
     *     excluded_net_movement_cents: int
     * }  $aggregate
     * @return array{
     *     total_transaction_count: int,
     *     operating_transaction_count: int,
     *     excluded_transaction_count: int,
     *     separate_tax_transaction_count: int,
     *     input_vat_transaction_count: int,
     *     operating_inflow_gross_cents: int,
     *     assumed_output_vat_cents: int,
     *     assumed_input_vat_cents: int,
     *     estimated_net_vat_payable_cents: int,
     *     assumed_revenue_net_cents: int,
     *     operating_outflow_gross_cents: int,
     *     assumed_expense_net_cents: int,
     *     estimated_operating_profit_cents: int,
     *     separate_tax_movement_cents: int,
     *     excluded_net_movement_cents: int,
     *     profit_status: string
     * }
     */
    private function finalizeSummary(array $aggregate): array
    {
        $assumedOutputVat = $this->assumedOutputVatFromShareCents(
            $aggregate['operating_inflow_gross_cents'],
        );
        $assumedRevenueNet = $aggregate['operating_inflow_gross_cents'] - $assumedOutputVat;
        $assumedExpenseNet = $aggregate['operating_outflow_gross_cents'] - $aggregate['assumed_input_vat_cents'];
        $estimatedOperatingProfit = $assumedRevenueNet - $assumedExpenseNet;
        $estimatedNetVatPayable = $assumedOutputVat - $aggregate['assumed_input_vat_cents'];

        return [
            ...$aggregate,
            'assumed_output_vat_cents' => $assumedOutputVat,
            'assumed_input_vat_cents' => $aggregate['assumed_input_vat_cents'],
            'estimated_net_vat_payable_cents' => $estimatedNetVatPayable,
            'assumed_revenue_net_cents' => $assumedRevenueNet,
            'assumed_expense_net_cents' => $assumedExpenseNet,
            'estimated_operating_profit_cents' => $estimatedOperatingProfit,
            'profit_status' => $this->profitStatus($estimatedOperatingProfit),
        ];
    }

    /**
     * @param  array{
     *     month: string,
     *     label: string,
     *     total_transaction_count: int,
     *     operating_transaction_count: int,
     *     excluded_transaction_count: int,
     *     separate_tax_transaction_count: int,
     *     input_vat_transaction_count: int,
     *     operating_inflow_gross_cents: int,
     *     operating_outflow_gross_cents: int,
     *     assumed_input_vat_cents: int,
     *     separate_tax_movement_cents: int,
     *     excluded_net_movement_cents: int
     * }  $aggregate
     * @return array{
     *     month: string,
     *     label: string,
     *     transaction_count: int,
     *     operating_inflow_gross_cents: int,
     *     assumed_output_vat_cents: int,
     *     assumed_input_vat_cents: int,
     *     estimated_net_vat_payable_cents: int,
     *     assumed_revenue_net_cents: int,
     *     operating_outflow_gross_cents: int,
     *     assumed_expense_net_cents: int,
     *     estimated_operating_profit_cents: int,
     *     separate_tax_movement_cents: int,
     *     excluded_net_movement_cents: int
     * }
     */
    private function finalizeMonth(array $aggregate): array
    {
        $assumedOutputVat = $this->assumedOutputVatFromShareCents(
            $aggregate['operating_inflow_gross_cents'],
        );
        $assumedRevenueNet = $aggregate['operating_inflow_gross_cents'] - $assumedOutputVat;
        $assumedExpenseNet = $aggregate['operating_outflow_gross_cents'] - $aggregate['assumed_input_vat_cents'];

        return [
            'month' => $aggregate['month'],
            'label' => $aggregate['label'],
            'transaction_count' => $aggregate['total_transaction_count'],
            'operating_inflow_gross_cents' => $aggregate['operating_inflow_gross_cents'],
            'assumed_output_vat_cents' => $assumedOutputVat,
            'assumed_input_vat_cents' => $aggregate['assumed_input_vat_cents'],
            'estimated_net_vat_payable_cents' => $assumedOutputVat - $aggregate['assumed_input_vat_cents'],
            'assumed_revenue_net_cents' => $assumedRevenueNet,
            'operating_outflow_gross_cents' => $aggregate['operating_outflow_gross_cents'],
            'assumed_expense_net_cents' => $assumedExpenseNet,
            'estimated_operating_profit_cents' => $assumedRevenueNet - $assumedExpenseNet,
            'separate_tax_movement_cents' => $aggregate['separate_tax_movement_cents'],
            'excluded_net_movement_cents' => $aggregate['excluded_net_movement_cents'],
        ];
    }

    private function assumedOutputVatCents(int $grossAmountCents): int
    {
        return (int) round($grossAmountCents * 19 / 119);
    }

    private function assumedOutputVatFromShareCents(int $grossInflowCents): int
    {
        return (int) round(
            $this->assumedOutputVatCents($grossInflowCents)
            * self::OUTPUT_VAT_SHARE_BPS
            / 10000,
        );
    }

    private function assumedInputVatFromShareCents(int $grossOutflowCents): int
    {
        return (int) round(
            $this->assumedOutputVatCents($grossOutflowCents)
            * self::INPUT_VAT_SHARE_BPS
            / 10000,
        );
    }

    private function profitStatus(int $estimatedOperatingProfitCents): string
    {
        if ($estimatedOperatingProfitCents > 0) {
            return 'profit';
        }

        if ($estimatedOperatingProfitCents < 0) {
            return 'loss';
        }

        return 'break_even';
    }

    /**
     * @return array{
     *     id: int,
     *     source_year: int,
     *     account_number: string,
     *     statement_no: string,
     *     booking_date: string|null,
     *     transaction_type: string,
     *     booking_text: string,
     *     amount_cents: int,
     *     assumed_input_vat_cents: int,
     *     bucket: string,
     *     bucket_label: string,
     *     classification_reason: string
     * }
     */
    private function classifyTransaction(ImportedTransaction $transaction): array
    {
        $searchableText = mb_strtolower(
            trim($transaction->transaction_type.' '.$transaction->booking_text),
        );
        $classification = $this->bucketFromRules(
            $searchableText,
            self::EXCLUSION_RULES,
            'excluded_private_or_financing',
            'Privat / Finanzierung',
        );

        if ($classification !== null) {
            return $this->classifiedTransactionRow($transaction, $classification);
        }

        $classification = $this->bucketFromRules(
            $searchableText,
            self::TAX_PAYMENT_RULES,
            'separate_tax_payment',
            'Steuerbewegung',
        );

        if ($classification !== null) {
            return $this->classifiedTransactionRow($transaction, $classification);
        }

        if ($transaction->amount_cents >= 0) {
            return $this->classifiedTransactionRow($transaction, [
                'assumed_input_vat_cents' => 0,
                'bucket' => 'operating_inflow',
                'bucket_label' => 'Betrieblicher Eingang',
                'classification_reason' => '72,7 % der betrieblichen Einzahlungseingänge werden als 19 % USt-haltig angesetzt',
            ]);
        }

        return $this->classifiedTransactionRow($transaction, [
            'assumed_input_vat_cents' => $this->assumedInputVatFromShareCents(abs($transaction->amount_cents)),
            'bucket' => 'operating_outflow',
            'bucket_label' => 'Betrieblicher Ausgang',
            'classification_reason' => '89,2 % der betrieblichen Auszahlungsausgänge werden als 19 % USt-haltig angesetzt',
        ]);
    }

    /**
     * @param  list<array{pattern: string, reason: string}>  $rules
     * @return array{bucket: string, bucket_label: string, classification_reason: string}|null
     */
    private function bucketFromRules(
        string $searchableText,
        array $rules,
        string $bucket,
        string $bucketLabel,
    ): ?array {
        foreach ($rules as $rule) {
            if (preg_match($rule['pattern'], $searchableText) === 1) {
                return [
                    'bucket' => $bucket,
                    'bucket_label' => $bucketLabel,
                    'classification_reason' => $rule['reason'],
                ];
            }
        }

        return null;
    }

    /**
     * @param  array{assumed_input_vat_cents?: int, bucket: string, bucket_label: string, classification_reason: string}  $classification
     * @return array{
     *     id: int,
     *     source_year: int,
     *     account_number: string,
     *     statement_no: string,
     *     booking_date: string|null,
     *     transaction_type: string,
     *     booking_text: string,
     *     amount_cents: int,
     *     assumed_input_vat_cents: int,
     *     bucket: string,
     *     bucket_label: string,
     *     classification_reason: string
     * }
     */
    private function classifiedTransactionRow(
        ImportedTransaction $transaction,
        array $classification,
    ): array {
        return [
            'id' => $transaction->id,
            'source_year' => $transaction->source_year,
            'account_number' => $transaction->account_number,
            'statement_no' => $transaction->statement_no,
            'booking_date' => $transaction->booking_date?->toDateString(),
            'transaction_type' => $transaction->transaction_type,
            'booking_text' => $transaction->booking_text,
            'amount_cents' => $transaction->amount_cents,
            'assumed_input_vat_cents' => $classification['assumed_input_vat_cents'] ?? 0,
            'bucket' => $classification['bucket'],
            'bucket_label' => $classification['bucket_label'],
            'classification_reason' => $classification['classification_reason'],
        ];
    }
}
