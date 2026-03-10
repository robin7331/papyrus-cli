<?php

namespace Database\Factories;

use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends \Illuminate\Database\Eloquent\Factories\Factory<\App\Models\ImportedTransaction>
 */
class ImportedTransactionFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'source_year' => 2023,
            'account_number' => 'DE00123456780000000000',
            'statement_sequence' => 1,
            'statement_no' => '2023-001',
            'source_statement_id' => $this->faker->numberBetween(1, 500),
            'source_transaction_id' => $this->faker->unique()->numberBetween(1, 5000),
            'row_index' => $this->faker->unique()->numberBetween(1, 5000),
            'booking_date' => $this->faker->date(),
            'transaction_type' => $this->faker->randomElement(['Überweisung', 'Lastschrift', 'Kartenzahlung']),
            'booking_text' => $this->faker->sentence(),
            'debit_cents' => null,
            'credit_cents' => 12500,
            'amount_cents' => 12500,
            'balance_after_cents' => 125000,
            'synced_at' => now(),
        ];
    }
}
