<?php

namespace App\Http\Controllers;

use App\Http\Requests\SyncYearRequest;
use App\Services\Bookkeeping\YearSyncService;
use Throwable;

class SyncYearController extends Controller
{
    public function __invoke(SyncYearRequest $request, YearSyncService $yearSyncService)
    {
        $year = (int) $request->validated('year');

        try {
            $result = $yearSyncService->sync($year);
        } catch (Throwable $throwable) {
            return back()->with('error', sprintf(
                'Sync für %d fehlgeschlagen: %s',
                $year,
                $throwable->getMessage(),
            ));
        }

        return back()->with('success', sprintf(
            'Sync für %d abgeschlossen. %d Transaktionen und %d Belege verarbeitet.',
            $year,
            $result['transaction_count'],
            $result['beleg_count'],
        ));
    }
}
