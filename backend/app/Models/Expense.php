<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Expense extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'description',
        'amount',
        'category_id',
        'predicted_category',
        'prediction_confidence',
        'is_outlier',
        'outlier_reason',
        'status',
    ];

    protected $casts = [
        'amount' => 'decimal:2',
        'prediction_confidence' => 'float',
        'is_outlier' => 'boolean',
    ];

    public function category(): BelongsTo
    {
        return $this->belongsTo(Category::class);
    }

    public function predictionLogs(): HasMany
    {
        return $this->hasMany(PredictionLog::class);
    }
}
