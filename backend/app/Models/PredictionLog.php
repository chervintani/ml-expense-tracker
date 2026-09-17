<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PredictionLog extends Model
{
    // The table stores only created_at (via DB default), so disable Eloquent's
    // automatic updated_at handling.
    public $timestamps = false;

    protected $fillable = [
        'expense_id',
        'raw_input',
        'raw_response',
        'model_version',
        'latency_ms',
    ];

    protected $casts = [
        'raw_response' => 'array',
    ];

    public function expense(): BelongsTo
    {
        return $this->belongsTo(Expense::class);
    }
}
