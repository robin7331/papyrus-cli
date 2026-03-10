<?php

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
        Schema::create('imported_transactions', function (Blueprint $table) {
            $table->id();
            $table->unsignedSmallInteger('source_year');
            $table->string('account_number');
            $table->unsignedInteger('statement_sequence');
            $table->string('statement_no');
            $table->unsignedBigInteger('source_statement_id');
            $table->unsignedBigInteger('source_transaction_id');
            $table->unsignedInteger('row_index');
            $table->date('booking_date');
            $table->string('transaction_type');
            $table->text('booking_text');
            $table->integer('debit_cents')->nullable();
            $table->integer('credit_cents')->nullable();
            $table->integer('amount_cents');
            $table->integer('balance_after_cents');
            $table->timestamp('synced_at');
            $table->timestamps();

            $table->unique(
                ['source_year', 'account_number', 'statement_sequence', 'row_index'],
                'imported_transactions_source_unique'
            );
            $table->index(['source_year', 'booking_date']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('imported_transactions');
    }
};
