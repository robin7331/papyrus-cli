<?php

namespace App\Http\Controllers;

use App\Models\ImportedBeleg;
use App\Models\ImportedTransaction;
use App\Models\YearSyncState;
use App\Services\Bookkeeping\BwaEstimateService;
use App\Services\Bookkeeping\YearDatabaseDiscovery;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Inertia\Inertia;
use Inertia\Response;

class DashboardController extends Controller
{
    /**
     * @var array<string, string>
     */
    private const TRANSACTION_SORTS = [
        'booking_date' => 'booking_date',
        'amount_cents' => 'amount_cents',
        'balance_after_cents' => 'balance_after_cents',
        'account_number' => 'account_number',
    ];

    /**
     * @var array<string, string>
     */
    private const BELEG_SORTS = [
        'document_date' => 'document_date',
        'gross_amount_cents' => 'gross_amount_cents',
        'issuer_name' => 'issuer_name',
        'invoice_number' => 'invoice_number',
    ];

    public function home(Request $request, YearDatabaseDiscovery $yearDatabaseDiscovery): Response
    {
        [
            'availableYears' => $availableYears,
            'selectedYear' => $selectedYear,
            'discoveredYears' => $discoveredYears,
        ] = $this->resolveYearContext($request, $yearDatabaseDiscovery);

        $yearSyncStates = $this->buildYearSyncStates($discoveredYears);
        $transactionsQuery = ImportedTransaction::query()
            ->withCount('belege')
            ->forYear($selectedYear);
        $belegeQuery = ImportedBeleg::query()->forYear($selectedYear);

        return Inertia::render('dashboard', [
            'availableYears' => $availableYears,
            'selectedYear' => $selectedYear,
            'yearSyncStates' => $yearSyncStates,
            'stats' => $this->buildHomeStats(
                $transactionsQuery,
                $belegeQuery,
                $yearSyncStates,
            ),
            'recentTransactions' => (clone $transactionsQuery)
                ->orderByDesc('booking_date')
                ->orderByDesc('id')
                ->limit(5)
                ->get()
                ->map(fn (ImportedTransaction $transaction): array => $this->mapTransaction($transaction))
                ->values()
                ->all(),
            'recentBelege' => (clone $belegeQuery)
                ->orderByDesc('document_date')
                ->orderByDesc('id')
                ->limit(5)
                ->get()
                ->map(fn (ImportedBeleg $beleg): array => $this->mapBeleg($beleg))
                ->values()
                ->all(),
        ]);
    }

    public function bwa(
        Request $request,
        YearDatabaseDiscovery $yearDatabaseDiscovery,
        BwaEstimateService $bwaEstimateService,
    ): Response {
        return Inertia::render(
            'bwa',
            $this->buildBwaPageProps($request, $yearDatabaseDiscovery, $bwaEstimateService),
        );
    }

    public function bwaPreview(
        Request $request,
        YearDatabaseDiscovery $yearDatabaseDiscovery,
        BwaEstimateService $bwaEstimateService,
    ): Response {
        return Inertia::render(
            'bwa-preview',
            $this->buildBwaPageProps($request, $yearDatabaseDiscovery, $bwaEstimateService),
        );
    }

    public function transactions(Request $request, YearDatabaseDiscovery $yearDatabaseDiscovery): Response
    {
        [
            'availableYears' => $availableYears,
            'selectedYear' => $selectedYear,
        ] = $this->resolveYearContext($request, $yearDatabaseDiscovery);

        $filters = $this->resolveTableFilters(
            $request,
            'booking_date',
            'desc',
            self::TRANSACTION_SORTS,
        );
        $transactionsQuery = $this->buildTransactionQuery($selectedYear, $filters);

        $transactions = (clone $transactionsQuery)
            ->orderBy(self::TRANSACTION_SORTS[$filters['sort']], $filters['dir'])
            ->orderBy('id', $filters['dir'])
            ->paginate(20)
            ->withQueryString()
            ->through(fn (ImportedTransaction $transaction): array => $this->mapTransaction($transaction));

        return Inertia::render('transaktionen', [
            'availableYears' => $availableYears,
            'selectedYear' => $selectedYear,
            'filters' => $this->buildTransactionsIndexState(
                $request,
                $selectedYear,
                $filters,
            ),
            'summary' => $this->buildTransactionSummary($transactionsQuery),
            'transactions' => $this->paginationData($transactions),
        ]);
    }

    public function transaction(
        Request $request,
        ImportedTransaction $importedTransaction,
    ): Response {
        $importedTransaction
            ->loadCount('belege')
            ->load([
                'belege' => fn ($query) => $query
                    ->orderBy('document_date')
                    ->orderBy('id'),
            ]);

        $bookingDate = $importedTransaction->booking_date;
        $windowStart = $bookingDate?->copy()->subDays(3);
        $windowEnd = $bookingDate?->copy()->addDays(3);
        $associatedBelegIds = $importedTransaction->belege->modelKeys();

        $nearbyBelege = ImportedBeleg::query()
            ->where('source_year', $importedTransaction->source_year)
            ->whereBetween('document_date', [
                $windowStart?->toDateString(),
                $windowEnd?->toDateString(),
            ])
            ->orderBy('document_date')
            ->orderBy('id')
            ->get();

        $nearbyBelegIds = $nearbyBelege->modelKeys();

        return Inertia::render('transaktionen/show', [
            'indexState' => $this->buildTransactionsIndexState(
                $request,
                (string) $importedTransaction->source_year,
            ),
            'transaction' => $this->mapTransaction($importedTransaction),
            'dateWindow' => [
                'from' => $windowStart?->toDateString(),
                'to' => $windowEnd?->toDateString(),
                'days' => 3,
            ],
            'nearbyBelege' => $nearbyBelege
                ->map(fn (ImportedBeleg $beleg): array => $this->mapAssociationBeleg(
                    $beleg,
                    $bookingDate?->toDateString(),
                    in_array($beleg->id, $associatedBelegIds, true),
                ))
                ->values()
                ->all(),
            'associatedBelegeOutsideWindow' => $importedTransaction->belege
                ->reject(fn (ImportedBeleg $beleg): bool => in_array($beleg->id, $nearbyBelegIds, true))
                ->map(fn (ImportedBeleg $beleg): array => $this->mapAssociationBeleg(
                    $beleg,
                    $bookingDate?->toDateString(),
                    true,
                ))
                ->values()
                ->all(),
        ]);
    }

    public function belege(Request $request, YearDatabaseDiscovery $yearDatabaseDiscovery): Response
    {
        [
            'availableYears' => $availableYears,
            'selectedYear' => $selectedYear,
        ] = $this->resolveYearContext($request, $yearDatabaseDiscovery);

        $filters = $this->resolveTableFilters(
            $request,
            'document_date',
            'desc',
            self::BELEG_SORTS,
        );
        $belegeQuery = $this->buildBelegQuery($selectedYear, $filters);

        $belege = (clone $belegeQuery)
            ->orderBy(self::BELEG_SORTS[$filters['sort']], $filters['dir'])
            ->orderBy('id', $filters['dir'])
            ->paginate(20)
            ->withQueryString()
            ->through(fn (ImportedBeleg $beleg): array => $this->mapBeleg($beleg));

        return Inertia::render('belege', [
            'availableYears' => $availableYears,
            'selectedYear' => $selectedYear,
            'filters' => $this->buildBelegeIndexState(
                $request,
                $selectedYear,
                $filters,
            ),
            'summary' => $this->buildBelegSummary($belegeQuery),
            'belege' => $this->paginationData($belege),
        ]);
    }

    public function beleg(
        Request $request,
        ImportedBeleg $importedBeleg,
    ): Response {
        $importedBeleg
            ->loadCount('transactions')
            ->load([
                'transactions' => fn ($query) => $query
                    ->orderBy('booking_date')
                    ->orderBy('id'),
            ]);

        $documentDate = $importedBeleg->document_date;
        $windowStart = $documentDate?->copy()->subDays(3);
        $windowEnd = $documentDate?->copy()->addDays(3);
        $associatedTransactionIds = $importedBeleg->transactions->modelKeys();

        $nearbyTransactions = ImportedTransaction::query()
            ->where('source_year', $importedBeleg->source_year)
            ->whereBetween('booking_date', [
                $windowStart?->toDateString(),
                $windowEnd?->toDateString(),
            ])
            ->orderBy('booking_date')
            ->orderBy('id')
            ->withCount('belege')
            ->get();

        $nearbyTransactionIds = $nearbyTransactions->modelKeys();

        return Inertia::render('belege/show', [
            'indexState' => $this->buildBelegeIndexState(
                $request,
                (string) $importedBeleg->source_year,
            ),
            'beleg' => $this->mapBeleg($importedBeleg),
            'dateWindow' => [
                'from' => $windowStart?->toDateString(),
                'to' => $windowEnd?->toDateString(),
                'days' => 3,
            ],
            'nearbyTransactions' => $nearbyTransactions
                ->map(fn (ImportedTransaction $transaction): array => $this->mapAssociationTransaction(
                    $transaction,
                    $documentDate?->toDateString(),
                    in_array($transaction->id, $associatedTransactionIds, true),
                ))
                ->values()
                ->all(),
            'associatedTransactionsOutsideWindow' => $importedBeleg->transactions
                ->reject(fn (ImportedTransaction $transaction): bool => in_array($transaction->id, $nearbyTransactionIds, true))
                ->map(fn (ImportedTransaction $transaction): array => $this->mapAssociationTransaction(
                    $transaction,
                    $documentDate?->toDateString(),
                    true,
                ))
                ->values()
                ->all(),
        ]);
    }

    /**
     * @return array{
     *     availableYears: list<int>,
     *     selectedYear: string,
     *     discoveredYears: Collection<int, array{year: int, database_path: string, has_belege: bool, has_transactions: bool}>
     * }
     */
    private function resolveYearContext(Request $request, YearDatabaseDiscovery $yearDatabaseDiscovery): array
    {
        $discoveredYears = $yearDatabaseDiscovery->discover();
        $availableYears = $discoveredYears->pluck('year')->all();

        return [
            'availableYears' => $availableYears,
            'selectedYear' => $this->resolveSelectedYear(
                (string) $request->query('year', 'all'),
                $availableYears,
            ),
            'discoveredYears' => $discoveredYears,
        ];
    }

    /**
     * @param  list<int>  $availableYears
     */
    private function resolveSelectedYear(string $selectedYear, array $availableYears): string
    {
        if ($selectedYear === 'all') {
            return 'all';
        }

        return in_array((int) $selectedYear, $availableYears, true)
            ? (string) (int) $selectedYear
            : 'all';
    }

    /**
     * @return list<int>
     */
    private function availableEstimateYears(YearDatabaseDiscovery $yearDatabaseDiscovery): array
    {
        return $yearDatabaseDiscovery->discover()
            ->pluck('year')
            ->merge(
                ImportedTransaction::query()
                    ->select('source_year')
                    ->distinct()
                    ->orderBy('source_year')
                    ->pluck('source_year'),
            )
            ->map(fn (mixed $year): int => (int) $year)
            ->unique()
            ->sort()
            ->values()
            ->all();
    }

    /**
     * @param  list<int>  $availableYears
     */
    private function resolveEstimateYear(Request $request, array $availableYears): ?int
    {
        if ($availableYears === []) {
            return null;
        }

        $defaultYear = max($availableYears);
        $requestedYear = (int) $request->query('year', $defaultYear);

        return in_array($requestedYear, $availableYears, true)
            ? $requestedYear
            : $defaultYear;
    }

    /**
     * @return array{
     *     availableYears: list<int>,
     *     selectedYear: int|null,
     *     estimateLabel: string,
     *     methodologyNotes: list<string>,
     *     summary: array<string, int|string>|null,
     *     months: array<int, array<string, int|string>>,
     *     transactions: array<int, array<string, int|string|null>>
     * }
     */
    private function buildBwaPageProps(
        Request $request,
        YearDatabaseDiscovery $yearDatabaseDiscovery,
        BwaEstimateService $bwaEstimateService,
    ): array {
        $availableYears = $this->availableEstimateYears($yearDatabaseDiscovery);
        $selectedYear = $this->resolveEstimateYear($request, $availableYears);
        $estimate = $selectedYear === null
            ? null
            : $bwaEstimateService->estimateForYear($selectedYear);

        return [
            'availableYears' => $availableYears,
            'selectedYear' => $selectedYear,
            'estimateLabel' => 'Schätzung / Notfallmethodik auf Basis von Kontobewegungen',
            'methodologyNotes' => [
                '72,7 % der verbleibenden Einzahlungseingänge werden als Bruttoerlöse inklusive 19 % Umsatzsteuer behandelt.',
                '89,2 % der verbleibenden Auszahlungsausgänge werden als Bruttoaufwand mit 19 % Vorsteuer behandelt.',
                'Privat-, Finanzierungs- und erkennbare Steuerbewegungen werden separat ausgewiesen und nicht in das operative Kernergebnis gemischt.',
            ],
            'summary' => $estimate['summary'] ?? null,
            'months' => $estimate['months'] ?? [],
            'transactions' => $estimate['transactions'] ?? [],
        ];
    }

    /**
     * @param  array<string, string>  $allowedSorts
     * @return array{search: string, exact_amount: string, exact_amount_cents: int|null, sort: string, dir: string}
     */
    private function resolveTableFilters(
        Request $request,
        string $defaultSort,
        string $defaultDir,
        array $allowedSorts,
    ): array {
        $sort = (string) $request->query('sort', $defaultSort);
        $dir = (string) $request->query('dir', $defaultDir);

        return [
            'search' => trim((string) $request->query('search', '')),
            'exact_amount' => trim((string) $request->query('exact_amount', '')),
            'exact_amount_cents' => $this->parseAmountFilterToCents(
                trim((string) $request->query('exact_amount', '')),
            ),
            'sort' => array_key_exists($sort, $allowedSorts) ? $sort : $defaultSort,
            'dir' => $dir === 'asc' ? 'asc' : 'desc',
        ];
    }

    /**
     * @param  array{search: string, exact_amount: string, exact_amount_cents: int|null, sort: string, dir: string}  $filters
     */
    private function buildTransactionQuery(string $selectedYear, array $filters): Builder
    {
        return ImportedTransaction::query()
            ->withCount('belege')
            ->forYear($selectedYear)
            ->when($filters['search'] !== '', function (Builder $query) use ($filters): void {
                $query->where(function (Builder $nestedQuery) use ($filters): void {
                    $search = '%'.$filters['search'].'%';

                    $nestedQuery
                        ->where('booking_text', 'like', $search)
                        ->orWhere('transaction_type', 'like', $search)
                        ->orWhere('account_number', 'like', $search)
                        ->orWhere('statement_no', 'like', $search);
                });
            })
            ->when($filters['exact_amount_cents'] !== null, function (Builder $query) use ($filters): void {
                $query->where('amount_cents', $filters['exact_amount_cents']);
            });
    }

    /**
     * @param  array{search: string, exact_amount: string, exact_amount_cents: int|null, sort: string, dir: string}  $filters
     */
    private function buildBelegQuery(string $selectedYear, array $filters): Builder
    {
        return ImportedBeleg::query()
            ->withCount('transactions')
            ->forYear($selectedYear)
            ->when($filters['search'] !== '', function (Builder $query) use ($filters): void {
                $query->where(function (Builder $nestedQuery) use ($filters): void {
                    $search = '%'.$filters['search'].'%';

                    $nestedQuery
                        ->where('issuer_name', 'like', $search)
                        ->orWhere('invoice_number', 'like', $search)
                        ->orWhere('subject', 'like', $search)
                        ->orWhere('summary_short', 'like', $search)
                        ->orWhere('target_basename', 'like', $search);
                });
            })
            ->when($filters['exact_amount_cents'] !== null, function (Builder $query) use ($filters): void {
                $query->where('gross_amount_cents', $filters['exact_amount_cents']);
            });
    }

    private function parseAmountFilterToCents(string $amount): ?int
    {
        $normalizedAmount = preg_replace('/\s+/', '', $amount);

        if ($normalizedAmount === null || $normalizedAmount === '') {
            return null;
        }

        if (! preg_match('/^[+-]?[\d.,]+$/', $normalizedAmount)) {
            return null;
        }

        $sign = 1;

        if (str_starts_with($normalizedAmount, '-')) {
            $sign = -1;
            $normalizedAmount = substr($normalizedAmount, 1);
        } elseif (str_starts_with($normalizedAmount, '+')) {
            $normalizedAmount = substr($normalizedAmount, 1);
        }

        if ($normalizedAmount === '') {
            return null;
        }

        $lastCommaPosition = strrpos($normalizedAmount, ',');
        $lastDotPosition = strrpos($normalizedAmount, '.');
        $decimalSeparator = null;
        $decimalPosition = false;

        if ($lastCommaPosition !== false || $lastDotPosition !== false) {
            $decimalPosition = max($lastCommaPosition ?: -1, $lastDotPosition ?: -1);
            $candidateSeparator = $normalizedAmount[$decimalPosition];
            $fractionalPart = substr($normalizedAmount, $decimalPosition + 1);

            if (
                $fractionalPart !== ''
                && strlen($fractionalPart) <= 2
                && ctype_digit($fractionalPart)
            ) {
                $decimalSeparator = $candidateSeparator;
            }
        }

        if ($decimalSeparator === null) {
            $integerPart = str_replace([',', '.'], '', $normalizedAmount);

            if ($integerPart === '' || ! ctype_digit($integerPart)) {
                return null;
            }

            return $sign * ((int) $integerPart * 100);
        }

        $integerPart = substr($normalizedAmount, 0, $decimalPosition);
        $fractionalPart = substr($normalizedAmount, $decimalPosition + 1);
        $integerDigits = str_replace(
            $decimalSeparator === ',' ? '.' : ',',
            '',
            $integerPart,
        );

        if ($integerDigits === '' || ! ctype_digit($integerDigits)) {
            return null;
        }

        if (! ctype_digit($fractionalPart) || strlen($fractionalPart) > 2) {
            return null;
        }

        $fractionalDigits = str_pad($fractionalPart, 2, '0');

        return $sign * (((int) $integerDigits * 100) + (int) $fractionalDigits);
    }

    /**
     * @param  Collection<int, array{year: int, database_path: string, has_belege: bool, has_transactions: bool}>  $discoveredYears
     * @return array<int, array<string, bool|int|string|null>>
     */
    private function buildYearSyncStates(Collection $discoveredYears): array
    {
        $states = YearSyncState::query()
            ->whereIn('year', $discoveredYears->pluck('year')->all())
            ->get()
            ->keyBy('year');

        return $discoveredYears->map(function (array $year) use ($states): array {
            /** @var YearSyncState|null $state */
            $state = $states->get($year['year']);

            return [
                'year' => $year['year'],
                'database_path' => $year['database_path'],
                'source_has_belege' => $year['has_belege'],
                'source_has_transactions' => $year['has_transactions'],
                'has_belege' => $state?->has_belege ?? false,
                'has_transactions' => $state?->has_transactions ?? false,
                'last_seen_belege_count' => $state?->last_seen_belege_count ?? 0,
                'last_seen_transaction_count' => $state?->last_seen_transaction_count ?? 0,
                'last_synced_at' => $state?->last_synced_at?->toAtomString(),
                'last_error' => $state?->last_error,
            ];
        })->all();
    }

    /**
     * @param  array<int, array<string, bool|int|string|null>>  $yearSyncStates
     * @return array{
     *     transaction_count: int,
     *     beleg_count: int,
     *     missing_pdf_count: int,
     *     missing_counterparty_count: int,
     *     latest_synced_year: int|null,
     *     latest_synced_at: string|null,
     *     years_pending_sync: int
     * }
     */
    private function buildHomeStats(
        Builder $transactionsQuery,
        Builder $belegeQuery,
        array $yearSyncStates,
    ): array {
        /** @var array{year: int, last_synced_at: string}|null $latestSync */
        $latestSync = collect($yearSyncStates)
            ->filter(fn (array $state): bool => is_string($state['last_synced_at']))
            ->sortByDesc('last_synced_at')
            ->map(fn (array $state): array => [
                'year' => (int) $state['year'],
                'last_synced_at' => (string) $state['last_synced_at'],
            ])
            ->first();

        return [
            'transaction_count' => (clone $transactionsQuery)->count(),
            'beleg_count' => (clone $belegeQuery)->count(),
            'missing_pdf_count' => $this->countMissingPdfFiles($belegeQuery),
            'missing_counterparty_count' => (clone $belegeQuery)
                ->where(function (Builder $query): void {
                    $query
                        ->whereNull('issuer_name')
                        ->orWhere('issuer_name', '');
                })
                ->count(),
            'latest_synced_year' => $latestSync['year'] ?? null,
            'latest_synced_at' => $latestSync['last_synced_at'] ?? null,
            'years_pending_sync' => collect($yearSyncStates)
                ->filter(function (array $state): bool {
                    $belegePending = $state['source_has_belege']
                        && ! $state['has_belege'];
                    $transactionsPending = $state['source_has_transactions']
                        && ! $state['has_transactions'];

                    return $belegePending || $transactionsPending;
                })
                ->count(),
        ];
    }

    /**
     * @param  array{search: string, exact_amount: string, exact_amount_cents: int|null, sort: string, dir: string}|null  $filters
     * @return array{year: string, search: string, exact_amount: string, sort: string, dir: string, page: int}
     */
    private function buildTransactionsIndexState(
        Request $request,
        string $year,
        ?array $filters = null,
    ): array {
        $filters ??= $this->resolveTableFilters(
            $request,
            'booking_date',
            'desc',
            self::TRANSACTION_SORTS,
        );

        return [
            'year' => (string) $request->query('year', $year),
            'search' => $filters['search'],
            'exact_amount' => $filters['exact_amount'],
            'sort' => $filters['sort'],
            'dir' => $filters['dir'],
            'page' => max(1, (int) $request->query('page', 1)),
        ];
    }

    /**
     * @param  array{search: string, exact_amount: string, exact_amount_cents: int|null, sort: string, dir: string}|null  $filters
     * @return array{year: string, search: string, exact_amount: string, sort: string, dir: string, page: int}
     */
    private function buildBelegeIndexState(
        Request $request,
        string $year,
        ?array $filters = null,
    ): array {
        $filters ??= $this->resolveTableFilters(
            $request,
            'document_date',
            'desc',
            self::BELEG_SORTS,
        );

        return [
            'year' => (string) $request->query('year', $year),
            'search' => $filters['search'],
            'exact_amount' => $filters['exact_amount'],
            'sort' => $filters['sort'],
            'dir' => $filters['dir'],
            'page' => max(1, (int) $request->query('page', 1)),
        ];
    }

    /**
     * @return array{
     *     total_count: int,
     *     credit_total_cents: int,
     *     debit_total_cents: int,
     *     latest_booking_date: string|null
     * }
     */
    private function buildTransactionSummary(Builder $transactionsQuery): array
    {
        /** @var ImportedTransaction|null $latestTransaction */
        $latestTransaction = (clone $transactionsQuery)
            ->orderByDesc('booking_date')
            ->orderByDesc('id')
            ->first();

        return [
            'total_count' => (clone $transactionsQuery)->count(),
            'credit_total_cents' => (int) ((clone $transactionsQuery)
                ->where('amount_cents', '>', 0)
                ->sum('amount_cents')),
            'debit_total_cents' => abs((int) ((clone $transactionsQuery)
                ->where('amount_cents', '<', 0)
                ->sum('amount_cents'))),
            'latest_booking_date' => $latestTransaction?->booking_date?->toDateString(),
        ];
    }

    /**
     * @return array{
     *     total_count: int,
     *     gross_total_cents: int,
     *     with_pdf_count: int,
     *     missing_supplier_count: int
     * }
     */
    private function buildBelegSummary(Builder $belegeQuery): array
    {
        return [
            'total_count' => (clone $belegeQuery)->count(),
            'gross_total_cents' => (int) ((clone $belegeQuery)->sum('gross_amount_cents')),
            'with_pdf_count' => (clone $belegeQuery)->count() - $this->countMissingPdfFiles($belegeQuery),
            'missing_supplier_count' => (clone $belegeQuery)
                ->where(function (Builder $query): void {
                    $query
                        ->whereNull('issuer_name')
                        ->orWhere('issuer_name', '');
                })
                ->count(),
        ];
    }

    private function countMissingPdfFiles(Builder $belegeQuery): int
    {
        return (clone $belegeQuery)
            ->get()
            ->filter(fn (ImportedBeleg $beleg): bool => ! is_file($beleg->pdfAbsolutePath()))
            ->count();
    }

    /**
     * @return array<string, int|string|null|bool>
     */
    private function mapTransaction(ImportedTransaction $transaction): array
    {
        $belegeCount = (int) ($transaction->getAttribute('belege_count') ?? 0);

        return [
            'id' => $transaction->id,
            'source_year' => $transaction->source_year,
            'account_number' => $transaction->account_number,
            'statement_sequence' => $transaction->statement_sequence,
            'statement_no' => $transaction->statement_no,
            'row_index' => $transaction->row_index,
            'booking_date' => $transaction->booking_date?->toDateString(),
            'transaction_type' => $transaction->transaction_type,
            'booking_text' => $transaction->booking_text,
            'debit_cents' => $transaction->debit_cents,
            'credit_cents' => $transaction->credit_cents,
            'amount_cents' => $transaction->amount_cents,
            'balance_after_cents' => $transaction->balance_after_cents,
            'belege_count' => $belegeCount,
            'is_associated' => $belegeCount > 0,
            'synced_at' => $transaction->synced_at?->toAtomString(),
        ];
    }

    /**
     * @return array<string, int|string|null|bool>
     */
    private function mapBeleg(ImportedBeleg $beleg): array
    {
        $transactionsCount = (int) ($beleg->getAttribute('transactions_count') ?? 0);

        return [
            'id' => $beleg->id,
            'source_year' => $beleg->source_year,
            'document_date' => $beleg->document_date?->toDateString(),
            'issuer_name' => $beleg->issuer_name,
            'invoice_number' => $beleg->invoice_number,
            'subject' => $beleg->subject,
            'summary_short' => $beleg->summary_short,
            'document_type' => $beleg->document_type,
            'gross_amount_cents' => $beleg->gross_amount_cents,
            'target_basename' => $beleg->target_basename,
            'pdf_available' => is_file($beleg->pdfAbsolutePath()),
            'transactions_count' => $transactionsCount,
            'is_associated' => $transactionsCount > 0,
            'synced_at' => $beleg->synced_at?->toAtomString(),
        ];
    }

    /**
     * @return array<string, int|string|null|bool>
     */
    private function mapAssociationBeleg(
        ImportedBeleg $beleg,
        ?string $bookingDate,
        bool $isAssociated,
    ): array {
        $daysOffset = null;

        if ($bookingDate !== null && $beleg->document_date !== null) {
            $daysOffset = (int) Carbon::parse($bookingDate)
                ->diffInDays($beleg->document_date, false);
        }

        return [
            ...$this->mapBeleg($beleg),
            'is_associated' => $isAssociated,
            'days_offset' => $daysOffset,
        ];
    }

    /**
     * @return array<string, int|string|null|bool>
     */
    private function mapAssociationTransaction(
        ImportedTransaction $transaction,
        ?string $documentDate,
        bool $isAssociated,
    ): array {
        $daysOffset = null;

        if ($documentDate !== null && $transaction->booking_date !== null) {
            $daysOffset = (int) Carbon::parse($documentDate)
                ->diffInDays($transaction->booking_date, false);
        }

        return [
            ...$this->mapTransaction($transaction),
            'is_associated' => $isAssociated,
            'days_offset' => $daysOffset,
        ];
    }

    /**
     * @param  LengthAwarePaginator<int, array<string, mixed>>  $paginator
     * @return array<string, mixed>
     */
    private function paginationData(LengthAwarePaginator $paginator): array
    {
        return [
            'data' => $paginator->items(),
            'current_page' => $paginator->currentPage(),
            'last_page' => $paginator->lastPage(),
            'per_page' => $paginator->perPage(),
            'total' => $paginator->total(),
            'from' => $paginator->firstItem(),
            'to' => $paginator->lastItem(),
        ];
    }
}
