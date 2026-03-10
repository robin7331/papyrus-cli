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
        Schema::create('imported_belegs', function (Blueprint $table) {
            $table->id();
            $table->unsignedSmallInteger('source_year');
            $table->unsignedBigInteger('source_id');
            $table->date('document_date');
            $table->string('issuer_name')->nullable();
            $table->string('invoice_number')->nullable();
            $table->text('subject')->nullable();
            $table->text('summary_short')->nullable();
            $table->string('document_type')->nullable();
            $table->integer('gross_amount_cents')->nullable();
            $table->integer('net_amount_cents')->nullable();
            $table->integer('vat_amount_cents')->nullable();
            $table->integer('vat_rate_bps')->nullable();
            $table->string('vat_treatment')->nullable();
            $table->string('country_code')->nullable();
            $table->longText('notes_json');
            $table->longText('raw_json');
            $table->string('target_basename');
            $table->text('source_json_path');
            $table->text('source_pdf_path')->nullable();
            $table->text('pdf_relative_path');
            $table->timestamp('synced_at');
            $table->timestamps();

            $table->unique(
                ['source_year', 'target_basename'],
                'imported_belegs_source_unique'
            );
            $table->index(['source_year', 'document_date']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('imported_belegs');
    }
};
