<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreTransactionBelegAssociationRequest;
use App\Models\ImportedBeleg;
use App\Models\ImportedTransaction;
use Illuminate\Http\RedirectResponse;

class TransactionBelegAssociationController extends Controller
{
    public function store(
        StoreTransactionBelegAssociationRequest $request,
        ImportedTransaction $importedTransaction,
    ): RedirectResponse {
        $beleg = ImportedBeleg::query()->findOrFail(
            $request->validated('imported_beleg_id'),
        );

        $importedTransaction->belege()->syncWithoutDetaching([$beleg->id]);

        return back()->with('success', 'Beleg wurde der Transaktion zugeordnet.');
    }

    public function destroy(
        ImportedTransaction $importedTransaction,
        ImportedBeleg $importedBeleg,
    ): RedirectResponse {
        if ($importedBeleg->source_year !== $importedTransaction->source_year) {
            abort(404);
        }

        $importedTransaction->belege()->detach($importedBeleg->id);

        return back()->with('success', 'Belegzuordnung wurde entfernt.');
    }
}
