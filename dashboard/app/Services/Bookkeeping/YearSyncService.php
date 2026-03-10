<?php

namespace App\Services\Bookkeeping;

use App\Models\YearSyncState;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use RuntimeException;
use Throwable;

class YearSyncService
{
    private const SOURCE_CONNECTION = 'bookkeeping-source';

    public function __construct(
        private readonly YearDatabaseDiscovery $yearDatabaseDiscovery,
    ) {}

    /**
     * @return array{beleg_count: int, transaction_count: int, has_belege: bool, has_transactions: bool}
     */
    public function sync(int $year): array
    {
        $databasePath = $this->yearDatabaseDiscovery->databasePathForYear($year);

        if ($databasePath === null || ! File::exists($databasePath)) {
            throw new RuntimeException("Keine Quelldatenbank für {$year} gefunden.");
        }

        $connection = $this->sourceConnection($databasePath);

        try {
            $hasBelege = $connection->getSchemaBuilder()->hasTable('belege');
            $hasTransactions = $connection->getSchemaBuilder()->hasTable('bank_transactions')
                && $connection->getSchemaBuilder()->hasTable('bank_statements');

            $belegCount = $hasBelege ? $this->syncBelege($connection->getName(), $year) : 0;
            $transactionCount = $hasTransactions ? $this->syncTransactions($connection->getName(), $year) : 0;

            YearSyncState::query()->updateOrCreate(
                ['year' => $year],
                [
                    'database_path' => $databasePath,
                    'has_belege' => $hasBelege,
                    'has_transactions' => $hasTransactions,
                    'last_seen_belege_count' => $belegCount,
                    'last_seen_transaction_count' => $transactionCount,
                    'last_synced_at' => now(),
                    'last_error' => null,
                ],
            );

            return [
                'beleg_count' => $belegCount,
                'transaction_count' => $transactionCount,
                'has_belege' => $hasBelege,
                'has_transactions' => $hasTransactions,
            ];
        } catch (Throwable $throwable) {
            YearSyncState::query()->updateOrCreate(
                ['year' => $year],
                [
                    'database_path' => $databasePath,
                    'last_error' => $throwable->getMessage(),
                ],
            );

            throw $throwable;
        } finally {
            DB::disconnect(self::SOURCE_CONNECTION);
            DB::purge(self::SOURCE_CONNECTION);
        }
    }

    private function sourceConnection(string $databasePath)
    {
        $connectionConfig = config('database.connections.sqlite');

        config([
            'database.connections.'.self::SOURCE_CONNECTION => [
                ...$connectionConfig,
                'database' => $databasePath,
            ],
        ]);

        DB::purge(self::SOURCE_CONNECTION);

        return DB::connection(self::SOURCE_CONNECTION);
    }

    private function syncBelege(string $connectionName, int $year): int
    {
        $timestamp = now();
        $rows = DB::connection($connectionName)
            ->table('belege')
            ->orderBy('id')
            ->get();

        foreach ($rows->chunk(250) as $chunk) {
            DB::table('imported_belegs')->upsert(
                $chunk->map(fn (object $row): array => [
                    'source_year' => $year,
                    'source_id' => (int) $row->id,
                    'document_date' => $row->document_date,
                    'issuer_name' => $row->issuer_name,
                    'invoice_number' => $row->invoice_number,
                    'subject' => $row->subject,
                    'summary_short' => $row->summary_short,
                    'document_type' => $row->document_type,
                    'gross_amount_cents' => $row->gross_amount_cents,
                    'net_amount_cents' => $row->net_amount_cents,
                    'vat_amount_cents' => $row->vat_amount_cents,
                    'vat_rate_bps' => $row->vat_rate_bps,
                    'vat_treatment' => $row->vat_treatment,
                    'country_code' => $row->country_code,
                    'notes_json' => $row->notes_json,
                    'raw_json' => $row->raw_json,
                    'target_basename' => $row->target_basename,
                    'source_json_path' => $row->source_json_path,
                    'source_pdf_path' => $row->source_pdf_path,
                    'pdf_relative_path' => sprintf('%d/belege/%s.pdf', $year, $row->target_basename),
                    'synced_at' => $timestamp,
                    'updated_at' => $timestamp,
                    'created_at' => $timestamp,
                ])->all(),
                ['source_year', 'target_basename'],
                [
                    'source_id',
                    'document_date',
                    'issuer_name',
                    'invoice_number',
                    'subject',
                    'summary_short',
                    'document_type',
                    'gross_amount_cents',
                    'net_amount_cents',
                    'vat_amount_cents',
                    'vat_rate_bps',
                    'vat_treatment',
                    'country_code',
                    'notes_json',
                    'raw_json',
                    'source_json_path',
                    'source_pdf_path',
                    'pdf_relative_path',
                    'synced_at',
                    'updated_at',
                ],
            );
        }

        return $rows->count();
    }

    private function syncTransactions(string $connectionName, int $year): int
    {
        $timestamp = now();
        $rows = DB::connection($connectionName)
            ->table('bank_transactions')
            ->join('bank_statements', 'bank_statements.id', '=', 'bank_transactions.statement_id')
            ->select([
                'bank_transactions.id as transaction_id',
                'bank_transactions.statement_id',
                'bank_transactions.row_index',
                'bank_transactions.booking_date',
                'bank_transactions.transaction_type',
                'bank_transactions.booking_text',
                'bank_transactions.debit_cents',
                'bank_transactions.credit_cents',
                'bank_transactions.amount_cents',
                'bank_transactions.balance_after_cents',
                'bank_statements.account_number',
                'bank_statements.statement_sequence',
                'bank_statements.statement_no',
            ])
            ->orderBy('bank_transactions.id')
            ->get();

        foreach ($rows->chunk(250) as $chunk) {
            DB::table('imported_transactions')->upsert(
                $chunk->map(fn (object $row): array => [
                    'source_year' => $year,
                    'account_number' => $row->account_number,
                    'statement_sequence' => (int) $row->statement_sequence,
                    'statement_no' => $row->statement_no,
                    'source_statement_id' => (int) $row->statement_id,
                    'source_transaction_id' => (int) $row->transaction_id,
                    'row_index' => (int) $row->row_index,
                    'booking_date' => $row->booking_date,
                    'transaction_type' => $row->transaction_type,
                    'booking_text' => $row->booking_text,
                    'debit_cents' => $row->debit_cents,
                    'credit_cents' => $row->credit_cents,
                    'amount_cents' => (int) $row->amount_cents,
                    'balance_after_cents' => (int) $row->balance_after_cents,
                    'synced_at' => $timestamp,
                    'updated_at' => $timestamp,
                    'created_at' => $timestamp,
                ])->all(),
                ['source_year', 'account_number', 'statement_sequence', 'row_index'],
                [
                    'statement_no',
                    'source_statement_id',
                    'source_transaction_id',
                    'booking_date',
                    'transaction_type',
                    'booking_text',
                    'debit_cents',
                    'credit_cents',
                    'amount_cents',
                    'balance_after_cents',
                    'synced_at',
                    'updated_at',
                ],
            );
        }

        return $rows->count();
    }
}
