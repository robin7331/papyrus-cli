<?php

namespace Database\Factories;

use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends \Illuminate\Database\Eloquent\Factories\Factory<\App\Models\ImportedBeleg>
 */
class ImportedBelegFactory extends Factory
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
            'source_id' => $this->faker->unique()->numberBetween(1, 5000),
            'document_date' => $this->faker->date(),
            'issuer_name' => $this->faker->company(),
            'invoice_number' => strtoupper($this->faker->bothify('INV-####')),
            'subject' => $this->faker->sentence(),
            'summary_short' => $this->faker->sentence(6),
            'document_type' => 'Rechnung',
            'gross_amount_cents' => 1999,
            'net_amount_cents' => 1680,
            'vat_amount_cents' => 319,
            'vat_rate_bps' => 1900,
            'vat_treatment' => 'standard',
            'country_code' => 'DE',
            'notes_json' => json_encode(['status' => 'ok'], JSON_THROW_ON_ERROR),
            'raw_json' => json_encode(['source' => 'factory'], JSON_THROW_ON_ERROR),
            'target_basename' => strtolower($this->faker->unique()->bothify('beleg-####')),
            'source_json_path' => 'scanned_belege/example.json',
            'source_pdf_path' => 'scanned_belege/example.pdf',
            'pdf_relative_path' => '2023/belege/example.pdf',
            'synced_at' => now(),
        ];
    }
}
