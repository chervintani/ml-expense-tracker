<?php

use Illuminate\Support\Facades\Route;

// Serve the static frontend (lives in public/) from the app root.
// no-cache makes browsers revalidate, so a stale cached page is never paired
// with newer styles.css / app.js after a UI update.
Route::get('/', function () {
    return response()->file(public_path('index.html'), ['Cache-Control' => 'no-cache']);
});
