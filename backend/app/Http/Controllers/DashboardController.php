<?php

namespace App\Http\Controllers;

use App\Models\Expense;
use Illuminate\Http\JsonResponse;

class DashboardController extends Controller
{
    public function summary(): JsonResponse
    {
        $categories = Expense::query()
            ->selectRaw("COALESCE(predicted_category, 'Uncategorized') as category, SUM(amount) as total, COUNT(*) as count")
            ->groupBy('category')
            ->orderByDesc('total')
            ->get()
            ->map(fn ($row) => [
                'category' => $row->category,
                'total' => (float) $row->total,
                'count' => (int) $row->count,
            ]);

        return response()->json([
            'categories' => $categories,
            'outlier_count' => Expense::where('is_outlier', true)->count(),
            'total_spend' => (float) Expense::sum('amount'),
        ]);
    }
}
