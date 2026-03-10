<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class YearSyncState extends Model
{
    /** @use HasFactory<\Database\Factories\YearSyncStateFactory> */
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
            'has_belege' => 'boolean',
            'has_transactions' => 'boolean',
            'last_synced_at' => 'datetime',
        ];
    }
}
