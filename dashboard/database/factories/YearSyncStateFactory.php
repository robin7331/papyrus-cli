<?php

namespace Database\Factories;

use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends \Illuminate\Database\Eloquent\Factories\Factory<\App\Models\YearSyncState>
 */
class YearSyncStateFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'year' => 2023,
            'database_path' => '/tmp/2023/database.sqlite',
            'has_belege' => true,
            'has_transactions' => true,
            'last_seen_belege_count' => 42,
            'last_seen_transaction_count' => 392,
            'last_synced_at' => now(),
            'last_error' => null,
        ];
    }
}
