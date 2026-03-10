<?php

namespace App\Services\Bookkeeping;

use Illuminate\Support\Collection;
use Illuminate\Support\Facades\File;
use PDO;
use Throwable;

class YearDatabaseDiscovery
{
    /**
     * @return Collection<int, array{year: int, database_path: string, has_belege: bool, has_transactions: bool}>
     */
    public function discover(): Collection
    {
        $root = rtrim((string) config('bookkeeping.years_root'), DIRECTORY_SEPARATOR);

        if (! File::isDirectory($root)) {
            return collect();
        }

        return collect(File::directories($root))
            ->map(function (string $directory): ?array {
                $directoryName = basename($directory);

                if (! preg_match('/^\d{4}$/', $directoryName)) {
                    return null;
                }

                $databasePath = $directory.DIRECTORY_SEPARATOR.'database.sqlite';

                if (! File::exists($databasePath)) {
                    return null;
                }

                $tables = $this->tablesFor($databasePath);

                return [
                    'year' => (int) $directoryName,
                    'database_path' => $databasePath,
                    'has_belege' => in_array('belege', $tables, true),
                    'has_transactions' => in_array('bank_transactions', $tables, true)
                        && in_array('bank_statements', $tables, true),
                ];
            })
            ->filter()
            ->sortBy('year')
            ->values();
    }

    public function databasePathForYear(int $year): ?string
    {
        /** @var array{year: int, database_path: string, has_belege: bool, has_transactions: bool}|null $match */
        $match = $this->discover()->firstWhere('year', $year);

        return $match['database_path'] ?? null;
    }

    /**
     * @return list<string>
     */
    private function tablesFor(string $databasePath): array
    {
        try {
            $pdo = new PDO('sqlite:'.$databasePath);
            $statement = $pdo->query("select name from sqlite_master where type = 'table'");
            $tables = $statement !== false ? $statement->fetchAll(PDO::FETCH_COLUMN) : [];
        } catch (Throwable) {
            return [];
        }

        return array_values(array_map('strval', $tables));
    }
}
