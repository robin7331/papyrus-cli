<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

class ImportedBeleg extends Model
{
    /** @use HasFactory<\Database\Factories\ImportedBelegFactory> */
    use HasFactory;

    /**
     * @var list<string>
     */
    protected $guarded = [];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'document_date' => 'date',
            'synced_at' => 'datetime',
        ];
    }

    public function transactions(): BelongsToMany
    {
        return $this->belongsToMany(
            ImportedTransaction::class,
            'beleg_transaction_links',
        )->withTimestamps();
    }

    public function scopeForYear(Builder $query, string|int $year): Builder
    {
        if ($year === 'all') {
            return $query;
        }

        return $query->where('source_year', (int) $year);
    }

    public function pdfAbsolutePath(): string
    {
        return rtrim((string) config('bookkeeping.years_root'), DIRECTORY_SEPARATOR)
            .DIRECTORY_SEPARATOR
            .$this->pdf_relative_path;
    }
}
