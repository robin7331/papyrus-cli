<?php

use App\Models\ImportedBeleg;
use App\Models\ImportedTransaction;
use Illuminate\Database\Eloquent\Factories\Sequence;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\File;
use Inertia\Testing\AssertableInertia as Assert;

beforeEach(function () {
    $this->yearsRoot = storage_path('framework/testing/bookkeeping-'.str_replace('.', '', uniqid('', true)));
    File::ensureDirectoryExists($this->yearsRoot);

    config()->set('bookkeeping.years_root', $this->yearsRoot);
});

afterEach(function () {
    File::deleteDirectory($this->yearsRoot);
});

it('discovers only valid years with a sqlite source', function () {
    createSourceDatabase($this->yearsRoot, 2023, [
        'belege' => [
            belegRow(sourceId: 1, targetBasename: 'rechnung-2023'),
        ],
    ]);

    File::ensureDirectoryExists($this->yearsRoot.'/2024');
    File::ensureDirectoryExists($this->yearsRoot.'/archiv');

    $this->get(route('home'))
        ->assertSuccessful()
        ->assertInertia(fn (Assert $page) => $page
            ->where('availableYears', [2023])
            ->has('yearSyncStates', 1)
            ->where('yearSyncStates.0.year', 2023)
            ->where('yearSyncStates.0.source_has_belege', true)
            ->where('yearSyncStates.0.source_has_transactions', false)
        );
});

it('renders the home overview with recent stats and missing pdf state', function () {
    createSourceDatabase($this->yearsRoot, 2023, [
        'belege' => [
            belegRow(sourceId: 1, targetBasename: 'acme-2023-1', invoiceNumber: 'INV-2023-1'),
        ],
    ]);

    ImportedTransaction::factory()->create([
        'source_year' => 2023,
        'booking_date' => '2023-01-03',
        'booking_text' => 'Office rent',
        'amount_cents' => -50000,
        'balance_after_cents' => 50000,
    ]);

    ImportedBeleg::factory()->create([
        'source_year' => 2023,
        'document_date' => '2023-01-05',
        'invoice_number' => 'INV-2023-2',
        'issuer_name' => 'Acme GmbH',
        'target_basename' => 'missing-pdf-2023-2',
        'pdf_relative_path' => '2023/belege/missing-pdf-2023-2.pdf',
    ]);

    $this->get(route('home', ['year' => 2023]))
        ->assertSuccessful()
        ->assertInertia(fn (Assert $page) => $page
            ->where('selectedYear', '2023')
            ->where('stats.transaction_count', 1)
            ->where('stats.beleg_count', 1)
            ->where('stats.missing_pdf_count', 1)
            ->where('recentTransactions.0.booking_text', 'Office rent')
            ->where('recentBelege.0.invoice_number', 'INV-2023-2')
        );
});

it('renders a conservative bwa estimate with classified transactions and month totals', function () {
    ImportedTransaction::factory()->create([
        'source_year' => 2023,
        'booking_date' => '2023-01-05',
        'transaction_type' => 'Gutschrift',
        'booking_text' => 'Kundenzahlung Januar',
        'credit_cents' => 11900,
        'debit_cents' => null,
        'amount_cents' => 11900,
        'balance_after_cents' => 211900,
        'source_transaction_id' => 8101,
        'row_index' => 8101,
    ]);

    ImportedTransaction::factory()->create([
        'source_year' => 2023,
        'booking_date' => '2023-01-06',
        'transaction_type' => 'Lastschrift',
        'booking_text' => 'Bueromiete Januar',
        'credit_cents' => null,
        'debit_cents' => 7000,
        'amount_cents' => -7000,
        'balance_after_cents' => 204900,
        'source_transaction_id' => 8102,
        'row_index' => 8102,
    ]);

    ImportedTransaction::factory()->create([
        'source_year' => 2023,
        'booking_date' => '2023-01-07',
        'transaction_type' => 'Überweisung',
        'booking_text' => 'Finanzamt Umsatzsteuer Januar',
        'credit_cents' => null,
        'debit_cents' => 1900,
        'amount_cents' => -1900,
        'balance_after_cents' => 203000,
        'source_transaction_id' => 8103,
        'row_index' => 8103,
    ]);

    ImportedTransaction::factory()->create([
        'source_year' => 2023,
        'booking_date' => '2023-01-08',
        'transaction_type' => 'Überweisung',
        'booking_text' => 'Robin Reiter privat',
        'credit_cents' => null,
        'debit_cents' => 50000,
        'amount_cents' => -50000,
        'balance_after_cents' => 153000,
        'source_transaction_id' => 8104,
        'row_index' => 8104,
    ]);

    ImportedTransaction::factory()->create([
        'source_year' => 2023,
        'booking_date' => '2023-02-01',
        'transaction_type' => 'Gutschrift',
        'booking_text' => 'Projekt Februar',
        'credit_cents' => 23800,
        'debit_cents' => null,
        'amount_cents' => 23800,
        'balance_after_cents' => 176800,
        'source_transaction_id' => 8105,
        'row_index' => 8105,
    ]);

    ImportedTransaction::factory()->create([
        'source_year' => 2023,
        'booking_date' => '2023-02-03',
        'transaction_type' => 'Lastschrift',
        'booking_text' => 'Steuerberater Rechnung',
        'credit_cents' => null,
        'debit_cents' => 11900,
        'amount_cents' => -11900,
        'balance_after_cents' => 164900,
        'source_transaction_id' => 8106,
        'row_index' => 8106,
    ]);

    $this->get(route('bwa.index', ['year' => 2023]))
        ->assertSuccessful()
        ->assertInertia(fn (Assert $page) => $page
            ->where('selectedYear', 2023)
            ->where(
                'estimateLabel',
                'Schätzung / Notfallmethodik auf Basis von Kontobewegungen',
            )
            ->where('summary.total_transaction_count', 6)
            ->where('summary.operating_transaction_count', 4)
            ->where('summary.excluded_transaction_count', 1)
            ->where('summary.separate_tax_transaction_count', 1)
            ->where('summary.input_vat_transaction_count', 2)
            ->where('summary.operating_inflow_gross_cents', 35700)
            ->where('summary.assumed_output_vat_cents', 4144)
            ->where('summary.assumed_input_vat_cents', 2692)
            ->where('summary.estimated_net_vat_payable_cents', 1452)
            ->where('summary.assumed_revenue_net_cents', 31556)
            ->where('summary.operating_outflow_gross_cents', 18900)
            ->where('summary.assumed_expense_net_cents', 16208)
            ->where('summary.estimated_operating_profit_cents', 15348)
            ->where('summary.separate_tax_movement_cents', -1900)
            ->where('summary.excluded_net_movement_cents', -50000)
            ->where('summary.profit_status', 'profit')
            ->where('months.0.month', '2023-01')
            ->where('months.0.transaction_count', 4)
            ->where('months.0.operating_inflow_gross_cents', 11900)
            ->where('months.0.assumed_output_vat_cents', 1381)
            ->where('months.0.assumed_input_vat_cents', 997)
            ->where('months.0.estimated_net_vat_payable_cents', 384)
            ->where('months.0.assumed_revenue_net_cents', 10519)
            ->where('months.0.operating_outflow_gross_cents', 7000)
            ->where('months.0.assumed_expense_net_cents', 6003)
            ->where('months.0.estimated_operating_profit_cents', 4516)
            ->where('months.0.separate_tax_movement_cents', -1900)
            ->where('months.0.excluded_net_movement_cents', -50000)
            ->where('months.1.month', '2023-02')
            ->where('months.1.transaction_count', 2)
            ->where('months.1.operating_inflow_gross_cents', 23800)
            ->where('months.1.assumed_output_vat_cents', 2763)
            ->where('months.1.assumed_input_vat_cents', 1695)
            ->where('months.1.estimated_net_vat_payable_cents', 1068)
            ->where('months.1.assumed_revenue_net_cents', 21037)
            ->where('months.1.operating_outflow_gross_cents', 11900)
            ->where('months.1.assumed_expense_net_cents', 10205)
            ->where('months.1.estimated_operating_profit_cents', 10832)
            ->where('transactions', function (Collection $transactions): bool {
                expect($transactions)->toHaveCount(6);

                $bucketByText = $transactions
                    ->mapWithKeys(fn (array $transaction): array => [
                        $transaction['booking_text'] => [
                            'bucket' => $transaction['bucket'],
                            'reason' => $transaction['classification_reason'],
                            'input_vat' => $transaction['assumed_input_vat_cents'],
                        ],
                    ]);

                expect($bucketByText['Finanzamt Umsatzsteuer Januar']['bucket'])
                    ->toBe('separate_tax_payment');
                expect($bucketByText['Robin Reiter privat']['bucket'])
                    ->toBe('excluded_private_or_financing');
                expect($bucketByText['Steuerberater Rechnung']['bucket'])
                    ->toBe('operating_outflow');
                expect($bucketByText['Steuerberater Rechnung']['input_vat'])
                    ->toBe(1695);
                expect($bucketByText['Bueromiete Januar']['input_vat'])
                    ->toBe(997);
                expect($bucketByText['Kundenzahlung Januar']['bucket'])
                    ->toBe('operating_inflow');

                return true;
            })
        );
});

it('defaults the bwa estimate to the latest imported year', function () {
    ImportedTransaction::factory()->create([
        'source_year' => 2023,
        'booking_date' => '2023-05-05',
        'transaction_type' => 'Gutschrift',
        'booking_text' => 'Altjahr Umsatz',
        'credit_cents' => 11900,
        'debit_cents' => null,
        'amount_cents' => 11900,
        'balance_after_cents' => 611900,
        'source_transaction_id' => 9101,
        'row_index' => 9101,
    ]);

    ImportedTransaction::factory()->create([
        'source_year' => 2024,
        'booking_date' => '2024-05-05',
        'transaction_type' => 'Gutschrift',
        'booking_text' => 'Neujahr Umsatz',
        'credit_cents' => 23800,
        'debit_cents' => null,
        'amount_cents' => 23800,
        'balance_after_cents' => 723800,
        'source_transaction_id' => 9102,
        'row_index' => 9102,
    ]);

    $this->get(route('bwa.index'))
        ->assertSuccessful()
        ->assertInertia(fn (Assert $page) => $page
            ->where('selectedYear', 2024)
            ->where('summary.total_transaction_count', 1)
            ->where('summary.operating_inflow_gross_cents', 23800)
            ->where('transactions.0.booking_text', 'Neujahr Umsatz')
        );
});

it('renders the bwa preview page with the same estimate data', function () {
    ImportedTransaction::factory()->create([
        'source_year' => 2023,
        'booking_date' => '2023-04-01',
        'transaction_type' => 'Gutschrift',
        'booking_text' => 'Projekt April',
        'credit_cents' => 119000,
        'debit_cents' => null,
        'amount_cents' => 119000,
        'balance_after_cents' => 619000,
        'source_transaction_id' => 9301,
        'row_index' => 9301,
    ]);

    ImportedTransaction::factory()->create([
        'source_year' => 2023,
        'booking_date' => '2023-04-02',
        'transaction_type' => 'Überweisung online',
        'booking_text' => 'Lieferant Rechnungs Nr 4001',
        'credit_cents' => null,
        'debit_cents' => 59500,
        'amount_cents' => -59500,
        'balance_after_cents' => 559500,
        'source_transaction_id' => 9302,
        'row_index' => 9302,
    ]);

    $this->get(route('bwa.preview', ['year' => 2023]))
        ->assertSuccessful()
        ->assertInertia(fn (Assert $page) => $page
            ->component('bwa-preview')
            ->where('selectedYear', 2023)
            ->where(
                'estimateLabel',
                'Schätzung / Notfallmethodik auf Basis von Kontobewegungen',
            )
            ->where('summary.assumed_output_vat_cents', 13813)
            ->where('summary.assumed_input_vat_cents', 8474)
            ->where('summary.estimated_net_vat_payable_cents', 5339)
            ->where('months.3.month', '2023-04')
            ->where('months.3.assumed_revenue_net_cents', 105187)
            ->where('months.3.assumed_expense_net_cents', 51026)
        );
});

it('applies the fixed vat quotas to all operating inflows and outflows', function () {
    ImportedTransaction::factory()->create([
        'source_year' => 2023,
        'booking_date' => '2023-03-01',
        'transaction_type' => 'Gutschrift',
        'booking_text' => 'Projektumsatz',
        'credit_cents' => 119000,
        'debit_cents' => null,
        'amount_cents' => 119000,
        'balance_after_cents' => 519000,
        'source_transaction_id' => 9201,
        'row_index' => 9201,
    ]);

    ImportedTransaction::factory()->create([
        'source_year' => 2023,
        'booking_date' => '2023-03-02',
        'transaction_type' => 'Überweisung online',
        'booking_text' => 'P-Form Thomas Pfeffer Rechnungs Nr 3901 DATUM 14.02.2023, 09.24 UHR',
        'credit_cents' => null,
        'debit_cents' => 59500,
        'amount_cents' => -59500,
        'balance_after_cents' => 459500,
        'source_transaction_id' => 9202,
        'row_index' => 9202,
    ]);

    ImportedTransaction::factory()->create([
        'source_year' => 2023,
        'booking_date' => '2023-03-03',
        'transaction_type' => 'Lastschrift',
        'booking_text' => 'PayPal (Europe) S.a r.l. et Cie, S. C.A. Ihr Einkauf bei Digi-Key Corporation',
        'credit_cents' => null,
        'debit_cents' => 11900,
        'amount_cents' => -11900,
        'balance_after_cents' => 447600,
        'source_transaction_id' => 9203,
        'row_index' => 9203,
    ]);

    ImportedTransaction::factory()->create([
        'source_year' => 2023,
        'booking_date' => '2023-03-04',
        'transaction_type' => 'Lastschrift',
        'booking_text' => 'Tesla-DE by Adyen Adyen N.V. Tesla DE SV014AB84D',
        'credit_cents' => null,
        'debit_cents' => 23800,
        'amount_cents' => -23800,
        'balance_after_cents' => 423800,
        'source_transaction_id' => 9204,
        'row_index' => 9204,
    ]);

    ImportedTransaction::factory()->create([
        'source_year' => 2023,
        'booking_date' => '2023-03-05',
        'transaction_type' => 'Dauerauftrag',
        'booking_text' => 'Johann Reiter Lohn',
        'credit_cents' => null,
        'debit_cents' => 52000,
        'amount_cents' => -52000,
        'balance_after_cents' => 371800,
        'source_transaction_id' => 9205,
        'row_index' => 9205,
    ]);

    $this->get(route('bwa.index', ['year' => 2023]))
        ->assertSuccessful()
        ->assertInertia(fn (Assert $page) => $page
            ->where('summary.assumed_output_vat_cents', 13813)
            ->where('summary.assumed_input_vat_cents', 20965)
            ->where('summary.estimated_net_vat_payable_cents', -7152)
            ->where('summary.input_vat_transaction_count', 4)
            ->where('summary.assumed_expense_net_cents', 126235)
            ->where('summary.estimated_operating_profit_cents', -21048)
            ->where('transactions', function (Collection $transactions): bool {
                $rows = $transactions->mapWithKeys(fn (array $transaction): array => [
                    $transaction['booking_text'] => $transaction,
                ]);

                expect($rows['P-Form Thomas Pfeffer Rechnungs Nr 3901 DATUM 14.02.2023, 09.24 UHR']['assumed_input_vat_cents'])
                    ->toBe(8474);
                expect($rows['PayPal (Europe) S.a r.l. et Cie, S. C.A. Ihr Einkauf bei Digi-Key Corporation']['assumed_input_vat_cents'])
                    ->toBe(1695);
                expect($rows['Tesla-DE by Adyen Adyen N.V. Tesla DE SV014AB84D']['assumed_input_vat_cents'])
                    ->toBe(3390);
                expect($rows['Johann Reiter Lohn']['assumed_input_vat_cents'])
                    ->toBe(7406);

                return true;
            })
        );
});

it('syncs a belege-only year into the app database', function () {
    createSourceDatabase($this->yearsRoot, 2024, [
        'belege' => [
            belegRow(sourceId: 1, targetBasename: 'kab24-2024', invoiceNumber: 'KB-2024-1'),
        ],
    ]);

    $this->from(route('home'))
        ->post(route('years.sync', ['year' => 2024]))
        ->assertRedirect(route('home'));

    $this->assertDatabaseCount('imported_belegs', 1);
    $this->assertDatabaseCount('imported_transactions', 0);
    $this->assertDatabaseHas('year_sync_states', [
        'year' => 2024,
        'has_belege' => 1,
        'has_transactions' => 0,
        'last_seen_belege_count' => 1,
        'last_seen_transaction_count' => 0,
    ]);
    $this->assertDatabaseHas('imported_belegs', [
        'source_year' => 2024,
        'invoice_number' => 'KB-2024-1',
        'pdf_relative_path' => '2024/belege/kab24-2024.pdf',
    ]);
});

it('syncs transactions and belege when both source tables exist', function () {
    createSourceDatabase($this->yearsRoot, 2023, [
        'belege' => [
            belegRow(sourceId: 11, targetBasename: 'robins-tools-52'),
        ],
        'bank_statements' => [
            [
                'id' => 7,
                'year' => 2023,
                'account_number' => 'DE11111111111111111111',
                'statement_sequence' => 12,
                'statement_no' => '2023-012',
                'source_json_path' => 'auszuege/source.json',
                'source_pdf_path' => 'auszuege/source.pdf',
                'opening_date' => '2023-01-01',
                'opening_balance_cents' => 100000,
                'closing_date' => '2023-01-31',
                'closing_balance_cents' => 120000,
                'transaction_count' => 2,
            ],
        ],
        'bank_transactions' => [
            [
                'id' => 71,
                'statement_id' => 7,
                'row_index' => 1,
                'booking_date' => '2023-01-03',
                'transaction_type' => 'Ueberweisung',
                'booking_text' => 'Office rent',
                'debit_cents' => 50000,
                'credit_cents' => null,
                'amount_cents' => -50000,
                'balance_after_cents' => 50000,
            ],
            [
                'id' => 72,
                'statement_id' => 7,
                'row_index' => 2,
                'booking_date' => '2023-01-04',
                'transaction_type' => 'Gutschrift',
                'booking_text' => 'Project income',
                'debit_cents' => null,
                'credit_cents' => 70000,
                'amount_cents' => 70000,
                'balance_after_cents' => 120000,
            ],
        ],
    ]);

    $this->from(route('home'))
        ->post(route('years.sync', ['year' => 2023]))
        ->assertRedirect(route('home'));

    $this->assertDatabaseCount('imported_transactions', 2);
    $this->assertDatabaseCount('imported_belegs', 1);
    $this->assertDatabaseHas('imported_transactions', [
        'source_year' => 2023,
        'account_number' => 'DE11111111111111111111',
        'statement_sequence' => 12,
        'row_index' => 2,
        'amount_cents' => 70000,
    ]);
});

it('upserts updated rows and keeps stale rows on re-sync', function () {
    createSourceDatabase($this->yearsRoot, 2025, [
        'belege' => [
            belegRow(sourceId: 1, targetBasename: 'steuerberater-a', grossAmountCents: 6600),
            belegRow(sourceId: 2, targetBasename: 'steuerberater-b', grossAmountCents: 8800),
        ],
    ]);

    $this->from(route('home'))
        ->post(route('years.sync', ['year' => 2025]))
        ->assertRedirect(route('home'));

    createSourceDatabase($this->yearsRoot, 2025, [
        'belege' => [
            belegRow(sourceId: 1, targetBasename: 'steuerberater-a', grossAmountCents: 9900),
        ],
    ]);

    $this->from(route('home'))
        ->post(route('years.sync', ['year' => 2025]))
        ->assertRedirect(route('home'));

    $this->assertDatabaseCount('imported_belegs', 2);
    $this->assertDatabaseHas('imported_belegs', [
        'source_year' => 2025,
        'target_basename' => 'steuerberater-a',
        'gross_amount_cents' => 9900,
    ]);
    $this->assertDatabaseHas('imported_belegs', [
        'source_year' => 2025,
        'target_basename' => 'steuerberater-b',
        'gross_amount_cents' => 8800,
    ]);
});

it('applies search, sort and pagination on the transactions page', function () {
    ImportedTransaction::factory()->count(18)->sequence(
        fn (Sequence $sequence): array => [
            'source_year' => 2023,
            'booking_text' => sprintf('Office charge %02d', $sequence->index + 1),
            'amount_cents' => ($sequence->index + 1) * 100,
            'balance_after_cents' => 100000 + (($sequence->index + 1) * 100),
            'row_index' => $sequence->index + 1,
            'source_transaction_id' => 1000 + $sequence->index,
        ],
    )->create();

    ImportedTransaction::factory()->count(7)->sequence(
        fn (Sequence $sequence): array => [
            'source_year' => 2024,
            'booking_text' => sprintf('Office charge %02d', $sequence->index + 19),
            'amount_cents' => ($sequence->index + 19) * 100,
            'balance_after_cents' => 110000 + (($sequence->index + 19) * 100),
            'row_index' => 100 + $sequence->index,
            'source_transaction_id' => 2000 + $sequence->index,
        ],
    )->create();

    ImportedBeleg::factory()->count(3)->sequence(
        ['source_year' => 2023, 'issuer_name' => 'Acme', 'invoice_number' => 'A-100', 'target_basename' => 'acme-a-100'],
        ['source_year' => 2023, 'issuer_name' => 'Acme', 'invoice_number' => 'A-300', 'target_basename' => 'acme-a-300'],
        ['source_year' => 2024, 'issuer_name' => 'Acme', 'invoice_number' => 'A-200', 'target_basename' => 'acme-a-200'],
    )->create();

    $this->get(route('transaktionen.index', [
        'search' => 'Office',
        'sort' => 'amount_cents',
        'dir' => 'asc',
        'page' => 2,
    ]))
        ->assertSuccessful()
        ->assertInertia(fn (Assert $page) => $page
            ->where('filters.search', 'Office')
            ->where('filters.sort', 'amount_cents')
            ->where('filters.dir', 'asc')
            ->where('transactions.current_page', 2)
            ->where('transactions.total', 25)
            ->where('transactions.data.0.is_associated', false)
            ->where('transactions.data.0.amount_cents', 2100)
        );
});

it('filters transactions by exact amount', function () {
    ImportedTransaction::factory()->create([
        'source_year' => 2023,
        'booking_text' => 'Matching transaction',
        'amount_cents' => 1234,
        'balance_after_cents' => 501234,
        'source_transaction_id' => 9101,
        'row_index' => 9101,
    ]);

    ImportedTransaction::factory()->create([
        'source_year' => 2023,
        'booking_text' => 'Different transaction',
        'amount_cents' => 1200,
        'balance_after_cents' => 501200,
        'source_transaction_id' => 9102,
        'row_index' => 9102,
    ]);

    $this->get(route('transaktionen.index', [
        'exact_amount' => '12,34',
    ]))
        ->assertSuccessful()
        ->assertInertia(fn (Assert $page) => $page
            ->where('filters.exact_amount', '12,34')
            ->where('transactions.total', 1)
            ->where('transactions.data.0.booking_text', 'Matching transaction')
            ->where('transactions.data.0.amount_cents', 1234)
        );
});

it('shows association status on the transactions page', function () {
    $transaction = ImportedTransaction::factory()->create([
        'source_year' => 2023,
        'booking_date' => '2023-01-05',
        'booking_text' => 'Software Abo',
    ]);

    $beleg = ImportedBeleg::factory()->create([
        'source_year' => 2023,
        'document_date' => '2023-01-05',
        'invoice_number' => 'INV-SOFTWARE',
        'target_basename' => 'invoice-software',
    ]);

    $transaction->belege()->attach($beleg->id);

    $this->get(route('transaktionen.index'))
        ->assertSuccessful()
        ->assertInertia(fn (Assert $page) => $page
            ->where('transactions.data.0.is_associated', true)
            ->where('transactions.data.0.belege_count', 1)
        );
});

it('shows nearby belege and associated belege outside the date window', function () {
    $transaction = ImportedTransaction::factory()->create([
        'source_year' => 2023,
        'booking_date' => '2023-01-05',
        'booking_text' => 'Hosting Rechnung',
    ]);

    $sameDayBeleg = ImportedBeleg::factory()->create([
        'source_year' => 2023,
        'document_date' => '2023-01-05',
        'invoice_number' => 'INV-SAME-DAY',
        'target_basename' => 'same-day',
    ]);

    $nearbyBeleg = ImportedBeleg::factory()->create([
        'source_year' => 2023,
        'document_date' => '2023-01-02',
        'invoice_number' => 'INV-NEARBY',
        'target_basename' => 'nearby',
    ]);

    $outsideWindowBeleg = ImportedBeleg::factory()->create([
        'source_year' => 2023,
        'document_date' => '2023-01-12',
        'invoice_number' => 'INV-OUTSIDE',
        'target_basename' => 'outside',
    ]);

    ImportedBeleg::factory()->create([
        'source_year' => 2024,
        'document_date' => '2023-01-05',
        'invoice_number' => 'INV-OTHER-YEAR',
        'target_basename' => 'other-year',
    ]);

    $transaction->belege()->attach([
        $sameDayBeleg->id,
        $outsideWindowBeleg->id,
    ]);

    $this->get(route('transaktionen.show', [
        'importedTransaction' => $transaction,
        'year' => 'all',
        'search' => 'Hosting',
        'page' => 2,
    ]))
        ->assertSuccessful()
        ->assertInertia(fn (Assert $page) => $page
            ->where('transaction.belege_count', 2)
            ->where('indexState.year', 'all')
            ->where('indexState.page', 2)
            ->where('nearbyBelege', function (Collection $belege) use ($nearbyBeleg, $sameDayBeleg): bool {
                expect($belege)->toHaveCount(2);

                expect($belege[0]['id'])->toBe($nearbyBeleg->id);
                expect($belege[0]['is_associated'])->toBeFalse();
                expect($belege[1]['id'])->toBe($sameDayBeleg->id);
                expect($belege[1]['is_associated'])->toBeTrue();

                return true;
            })
            ->where('associatedBelegeOutsideWindow.0.invoice_number', 'INV-OUTSIDE')
        );
});

it('stores and removes beleg associations for a transaction', function () {
    $transaction = ImportedTransaction::factory()->create([
        'source_year' => 2023,
        'booking_date' => '2023-01-05',
    ]);

    $beleg = ImportedBeleg::factory()->create([
        'source_year' => 2023,
        'document_date' => '2023-01-05',
        'target_basename' => 'transaction-link',
    ]);

    $this->from(route('transaktionen.show', $transaction))
        ->post(route('transaktionen.belege.store', $transaction), [
            'imported_beleg_id' => $beleg->id,
        ])
        ->assertRedirect(route('transaktionen.show', $transaction));

    $this->assertDatabaseHas('beleg_transaction_links', [
        'imported_transaction_id' => $transaction->id,
        'imported_beleg_id' => $beleg->id,
    ]);

    $this->from(route('transaktionen.show', $transaction))
        ->delete(route('transaktionen.belege.destroy', [
            'importedTransaction' => $transaction,
            'importedBeleg' => $beleg,
        ]))
        ->assertRedirect(route('transaktionen.show', $transaction));

    $this->assertDatabaseMissing('beleg_transaction_links', [
        'imported_transaction_id' => $transaction->id,
        'imported_beleg_id' => $beleg->id,
    ]);
});

it('applies search, sort and pagination on the belege page', function () {
    ImportedBeleg::factory()->count(3)->sequence(
        ['source_year' => 2023, 'issuer_name' => 'Acme', 'invoice_number' => 'A-100', 'target_basename' => 'acme-a-100'],
        ['source_year' => 2023, 'issuer_name' => 'Acme', 'invoice_number' => 'A-300', 'target_basename' => 'acme-a-300'],
        ['source_year' => 2024, 'issuer_name' => 'Acme', 'invoice_number' => 'A-200', 'target_basename' => 'acme-a-200'],
    )->create();

    $this->get(route('belege.index', [
        'search' => 'Acme',
        'sort' => 'invoice_number',
        'dir' => 'desc',
    ]))
        ->assertSuccessful()
        ->assertInertia(fn (Assert $page) => $page
            ->where('filters.search', 'Acme')
            ->where('filters.sort', 'invoice_number')
            ->where('filters.dir', 'desc')
            ->where('belege.total', 3)
            ->where('belege.data.0.is_associated', false)
            ->where('belege.data.0.invoice_number', 'A-300')
        );
});

it('filters belege by exact amount', function () {
    ImportedBeleg::factory()->create([
        'source_year' => 2023,
        'issuer_name' => 'Exact Match GmbH',
        'invoice_number' => 'EX-1234',
        'gross_amount_cents' => 1234,
        'target_basename' => 'exact-match',
    ]);

    ImportedBeleg::factory()->create([
        'source_year' => 2023,
        'issuer_name' => 'Different GmbH',
        'invoice_number' => 'EX-1200',
        'gross_amount_cents' => 1200,
        'target_basename' => 'different-match',
    ]);

    $this->get(route('belege.index', [
        'exact_amount' => '12.34',
    ]))
        ->assertSuccessful()
        ->assertInertia(fn (Assert $page) => $page
            ->where('filters.exact_amount', '12.34')
            ->where('belege.total', 1)
            ->where('belege.data.0.invoice_number', 'EX-1234')
            ->where('belege.data.0.gross_amount_cents', 1234)
        );
});

it('shows association status on the belege page', function () {
    $transaction = ImportedTransaction::factory()->create([
        'source_year' => 2023,
        'booking_date' => '2023-01-05',
        'booking_text' => 'Agenturhonorar',
    ]);

    $beleg = ImportedBeleg::factory()->create([
        'source_year' => 2023,
        'document_date' => '2023-01-05',
        'invoice_number' => 'INV-AGENTUR',
        'target_basename' => 'invoice-agentur',
    ]);

    $transaction->belege()->attach($beleg->id);

    $this->get(route('belege.index'))
        ->assertSuccessful()
        ->assertInertia(fn (Assert $page) => $page
            ->where('belege.data.0.is_associated', true)
            ->where('belege.data.0.transactions_count', 1)
        );
});

it('shows nearby transactions and associated transactions outside the date window for a beleg', function () {
    $beleg = ImportedBeleg::factory()->create([
        'source_year' => 2023,
        'document_date' => '2023-01-05',
        'invoice_number' => 'INV-HOSTING',
        'target_basename' => 'invoice-hosting',
    ]);

    $sameDayTransaction = ImportedTransaction::factory()->create([
        'source_year' => 2023,
        'booking_date' => '2023-01-05',
        'booking_text' => 'Hosting Rechnung',
        'source_transaction_id' => 7001,
        'row_index' => 7001,
    ]);

    $nearbyTransaction = ImportedTransaction::factory()->create([
        'source_year' => 2023,
        'booking_date' => '2023-01-02',
        'booking_text' => 'Cloud Abo',
        'source_transaction_id' => 7002,
        'row_index' => 7002,
    ]);

    $outsideWindowTransaction = ImportedTransaction::factory()->create([
        'source_year' => 2023,
        'booking_date' => '2023-01-12',
        'booking_text' => 'Später Abgleich',
        'source_transaction_id' => 7003,
        'row_index' => 7003,
    ]);

    ImportedTransaction::factory()->create([
        'source_year' => 2024,
        'booking_date' => '2023-01-05',
        'booking_text' => 'Falsches Jahr',
        'source_transaction_id' => 7004,
        'row_index' => 7004,
    ]);

    $beleg->transactions()->attach([
        $sameDayTransaction->id,
        $outsideWindowTransaction->id,
    ]);

    $this->get(route('belege.show', [
        'importedBeleg' => $beleg,
        'year' => 'all',
        'search' => 'Hosting',
        'page' => 3,
    ]))
        ->assertSuccessful()
        ->assertInertia(fn (Assert $page) => $page
            ->where('beleg.transactions_count', 2)
            ->where('indexState.year', 'all')
            ->where('indexState.page', 3)
            ->where('nearbyTransactions', function (Collection $transactions) use ($nearbyTransaction, $sameDayTransaction): bool {
                expect($transactions)->toHaveCount(2);

                expect($transactions[0]['id'])->toBe($nearbyTransaction->id);
                expect($transactions[0]['is_associated'])->toBeFalse();
                expect($transactions[1]['id'])->toBe($sameDayTransaction->id);
                expect($transactions[1]['is_associated'])->toBeTrue();

                return true;
            })
            ->where(
                'associatedTransactionsOutsideWindow.0.booking_text',
                'Später Abgleich',
            )
        );
});

it('serves beleg pdf files inline and returns 404 for missing files', function () {
    File::ensureDirectoryExists($this->yearsRoot.'/2023/belege');
    File::put($this->yearsRoot.'/2023/belege/existing.pdf', '%PDF-1.4 test');

    $existingBeleg = ImportedBeleg::factory()->create([
        'source_year' => 2023,
        'target_basename' => 'existing',
        'pdf_relative_path' => '2023/belege/existing.pdf',
    ]);

    $missingBeleg = ImportedBeleg::factory()->create([
        'source_year' => 2023,
        'target_basename' => 'missing',
        'pdf_relative_path' => '2023/belege/missing.pdf',
    ]);

    $this->get(route('belege.pdf', $existingBeleg))
        ->assertSuccessful()
        ->assertHeader('content-type', 'application/pdf');

    $this->get(route('belege.pdf', $missingBeleg))
        ->assertNotFound();
});

function createSourceDatabase(string $root, int $year, array $tables): void
{
    $yearPath = $root.'/'.$year;
    $databasePath = $yearPath.'/database.sqlite';

    File::deleteDirectory($yearPath);
    File::ensureDirectoryExists($yearPath.'/belege');

    $pdo = new PDO('sqlite:'.$databasePath);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    if (array_key_exists('belege', $tables)) {
        $pdo->exec(<<<'SQL'
            CREATE TABLE belege (
                id INTEGER PRIMARY KEY,
                year INTEGER NOT NULL,
                document_date TEXT NOT NULL,
                issuer_name TEXT,
                invoice_number TEXT,
                subject TEXT,
                summary_short TEXT,
                document_type TEXT,
                gross_amount_cents INTEGER,
                net_amount_cents INTEGER,
                vat_amount_cents INTEGER,
                vat_rate_bps INTEGER,
                vat_treatment TEXT,
                country_code TEXT,
                notes_json TEXT NOT NULL,
                raw_json TEXT NOT NULL,
                target_basename TEXT NOT NULL,
                source_json_path TEXT NOT NULL,
                source_pdf_path TEXT NOT NULL,
                imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
        SQL);

        $statement = $pdo->prepare(<<<'SQL'
            INSERT INTO belege (
                id, year, document_date, issuer_name, invoice_number, subject, summary_short,
                document_type, gross_amount_cents, net_amount_cents, vat_amount_cents,
                vat_rate_bps, vat_treatment, country_code, notes_json, raw_json,
                target_basename, source_json_path, source_pdf_path
            ) VALUES (
                :id, :year, :document_date, :issuer_name, :invoice_number, :subject, :summary_short,
                :document_type, :gross_amount_cents, :net_amount_cents, :vat_amount_cents,
                :vat_rate_bps, :vat_treatment, :country_code, :notes_json, :raw_json,
                :target_basename, :source_json_path, :source_pdf_path
            );
        SQL);

        foreach ($tables['belege'] as $row) {
            $statement->execute($row);
            File::put($yearPath.'/belege/'.$row['target_basename'].'.pdf', '%PDF-'.$row['target_basename']);
        }
    }

    if (array_key_exists('bank_statements', $tables)) {
        $pdo->exec(<<<'SQL'
            CREATE TABLE bank_statements (
                id INTEGER PRIMARY KEY,
                year INTEGER NOT NULL,
                account_number TEXT NOT NULL,
                statement_sequence INTEGER NOT NULL,
                statement_no TEXT NOT NULL,
                source_json_path TEXT NOT NULL,
                source_pdf_path TEXT,
                opening_date TEXT NOT NULL,
                opening_balance_cents INTEGER NOT NULL,
                closing_date TEXT NOT NULL,
                closing_balance_cents INTEGER NOT NULL,
                transaction_count INTEGER NOT NULL,
                imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
        SQL);

        $statement = $pdo->prepare(<<<'SQL'
            INSERT INTO bank_statements (
                id, year, account_number, statement_sequence, statement_no, source_json_path,
                source_pdf_path, opening_date, opening_balance_cents, closing_date,
                closing_balance_cents, transaction_count
            ) VALUES (
                :id, :year, :account_number, :statement_sequence, :statement_no, :source_json_path,
                :source_pdf_path, :opening_date, :opening_balance_cents, :closing_date,
                :closing_balance_cents, :transaction_count
            );
        SQL);

        foreach ($tables['bank_statements'] as $row) {
            $statement->execute($row);
        }
    }

    if (array_key_exists('bank_transactions', $tables)) {
        $pdo->exec(<<<'SQL'
            CREATE TABLE bank_transactions (
                id INTEGER PRIMARY KEY,
                statement_id INTEGER NOT NULL,
                row_index INTEGER NOT NULL,
                booking_date TEXT NOT NULL,
                transaction_type TEXT NOT NULL,
                booking_text TEXT NOT NULL,
                debit_cents INTEGER,
                credit_cents INTEGER,
                amount_cents INTEGER NOT NULL,
                balance_after_cents INTEGER NOT NULL
            );
        SQL);

        $statement = $pdo->prepare(<<<'SQL'
            INSERT INTO bank_transactions (
                id, statement_id, row_index, booking_date, transaction_type, booking_text,
                debit_cents, credit_cents, amount_cents, balance_after_cents
            ) VALUES (
                :id, :statement_id, :row_index, :booking_date, :transaction_type, :booking_text,
                :debit_cents, :credit_cents, :amount_cents, :balance_after_cents
            );
        SQL);

        foreach ($tables['bank_transactions'] as $row) {
            $statement->execute($row);
        }
    }
}

function belegRow(
    int $sourceId,
    string $targetBasename,
    ?string $invoiceNumber = null,
    int $grossAmountCents = 15860,
): array {
    return [
        'id' => $sourceId,
        'year' => 2023,
        'document_date' => '2023-01-04',
        'issuer_name' => 'Robins Tools',
        'invoice_number' => $invoiceNumber ?? 'INV-'.$sourceId,
        'subject' => 'Rechnung '.$sourceId,
        'summary_short' => 'Kurzbeschreibung '.$sourceId,
        'document_type' => 'Rechnung',
        'gross_amount_cents' => $grossAmountCents,
        'net_amount_cents' => 13328,
        'vat_amount_cents' => 2532,
        'vat_rate_bps' => 1900,
        'vat_treatment' => 'standard',
        'country_code' => 'DE',
        'notes_json' => json_encode(['note' => 'ok'], JSON_THROW_ON_ERROR),
        'raw_json' => json_encode(['raw' => 'source'], JSON_THROW_ON_ERROR),
        'target_basename' => $targetBasename,
        'source_json_path' => 'scanned_belege/'.$targetBasename.'.json',
        'source_pdf_path' => 'scanned_belege/'.$targetBasename.'.pdf',
    ];
}
