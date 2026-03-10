<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

class ImportedTransaction extends Model
{
    /** @use HasFactory<\Database\Factories\ImportedTransactionFactory> */
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
            'booking_date' => 'date',
            'synced_at' => 'datetime',
        ];
    }

    public function belege(): BelongsToMany
    {
        return $this->belongsToMany(
            ImportedBeleg::class,
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
}
