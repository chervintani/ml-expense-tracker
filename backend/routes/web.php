<?php

use Illuminate\Support\Facades\Route;

// Serve the static frontend (lives in public/) from the app root.
Route::get('/', function () {
    return response()->file(public_path('index.html'));
});
