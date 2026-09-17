<?php

use App\Http\Controllers\CategoryController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\ExpenseController;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Route;

Route::get('/expenses', [ExpenseController::class, 'index']);
Route::post('/expenses', [ExpenseController::class, 'store']);
Route::get('/expenses/{expense}', [ExpenseController::class, 'show']);
Route::patch('/expenses/{expense}/confirm', [ExpenseController::class, 'confirm']);
Route::delete('/expenses/{expense}', [ExpenseController::class, 'destroy']);

Route::get('/categories', [CategoryController::class, 'index']);
Route::get('/dashboard/summary', [DashboardController::class, 'summary']);

Route::get('/health', function () {
    $mlStatus = 'unavailable';

    try {
        $ml = Http::timeout(3)->get(rtrim((string) config('services.ml.url'), '/') . '/health');
        $mlStatus = $ml->successful() ? 'ok' : 'unavailable';
    } catch (\Throwable $e) {
        $mlStatus = 'unavailable';
    }

    return response()->json(['api' => 'ok', 'ml' => $mlStatus]);
});
