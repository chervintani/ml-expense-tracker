<?php

namespace App\Services;

use App\Models\Expense;

/**
 * Flags an expense whose amount is unusually large for its predicted category,
 * using the mean + 2*stddev rule over prior predicted/confirmed expenses.
 */
class OutlierService
{
    /**
     * @return array{0: bool, 1: ?string}  [isOutlier, reason]
     */
    public function check(float $amount, ?string $category): array
    {
        if (! $category || $category === 'Uncategorized') {
            return [false, null];
        }

        $stats = Expense::query()
            ->where('predicted_category', $category)
            ->whereIn('status', ['predicted', 'confirmed'])
            ->selectRaw('AVG(amount) as mean, STDDEV(amount) as std, COUNT(*) as count')
            ->first();

        // Need enough history, and a non-zero spread, before judging.
        if (! $stats || $stats->count < 5 || $stats->std === null || (float) $stats->std <= 0.0) {
            return [false, null];
        }

        $mean = (float) $stats->mean;
        $std = (float) $stats->std;
        $threshold = $mean + 2 * $std;

        if ($amount > $threshold) {
            $reason = sprintf(
                'Amount of ₱%s exceeds typical %s spend (avg ₱%s)',
                number_format($amount, 2),
                $category,
                number_format($mean, 2)
            );

            return [true, $reason];
        }

        return [false, null];
    }
}
