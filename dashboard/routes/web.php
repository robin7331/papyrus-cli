<?php

use App\Http\Controllers\BelegPdfController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\SyncYearController;
use App\Http\Controllers\TransactionBelegAssociationController;
use Illuminate\Support\Facades\Route;

Route::get('/', [DashboardController::class, 'home'])->name('home');
Route::get('/transaktionen', [DashboardController::class, 'transactions'])->name('transaktionen.index');
Route::get('/transaktionen/{importedTransaction}', [DashboardController::class, 'transaction'])->name('transaktionen.show');
Route::post('/transaktionen/{importedTransaction}/belege', [TransactionBelegAssociationController::class, 'store'])
    ->name('transaktionen.belege.store');
Route::delete('/transaktionen/{importedTransaction}/belege/{importedBeleg}', [TransactionBelegAssociationController::class, 'destroy'])
    ->name('transaktionen.belege.destroy');
Route::get('/belege', [DashboardController::class, 'belege'])->name('belege.index');
Route::get('/belege/{importedBeleg}', [DashboardController::class, 'beleg'])->name('belege.show');
Route::post('/jahre/{year}/sync', SyncYearController::class)->name('years.sync');
Route::get('/belege/{importedBeleg}/pdf', BelegPdfController::class)->name('belege.pdf');
