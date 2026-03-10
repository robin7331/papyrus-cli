<?php

use App\Models\ImportedBeleg;
use App\Models\ImportedTransaction;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('beleg_transaction_links', function (Blueprint $table) {
            $table->foreignIdFor(ImportedTransaction::class)
                ->constrained()
                ->cascadeOnDelete();
            $table->foreignIdFor(ImportedBeleg::class)
                ->constrained()
                ->cascadeOnDelete();
            $table->timestamps();

            $table->unique([
                'imported_transaction_id',
                'imported_beleg_id',
            ]);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('beleg_transaction_links');
    }
};
