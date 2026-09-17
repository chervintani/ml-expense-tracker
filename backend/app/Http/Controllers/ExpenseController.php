<?php

namespace App\Http\Controllers;

use App\Models\Category;
use App\Models\Expense;
use App\Models\PredictionLog;
use App\Services\MLService;
use App\Services\OutlierService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ExpenseController extends Controller
{
    public function __construct(
        protected MLService $ml,
        protected OutlierService $outlier,
    ) {}

    public function index(): JsonResponse
    {
        return response()->json(
            Expense::with('category')->latest('id')->paginate(20)
        );
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'description' => ['required', 'string', 'max:255'],
            'amount' => ['required', 'numeric', 'min:0.01'],
        ]);

        // 1. Save with a pending status (no prediction yet).
        $expense = Expense::create([
            'description' => $validated['description'],
            'amount' => $validated['amount'],
            'status' => 'pending',
        ]);

        // 2. Ask the ML microservice to categorize the description.
        $prediction = $this->ml->predict($expense->description);
        $category = $prediction['category'] ?? null;

        // 3. Outlier check against this category's prior history.
        [$isOutlier, $reason] = $this->outlier->check((float) $expense->amount, $category);

        // 4. Persist the prediction + outlier verdict.
        $expense->update([
            'predicted_category' => $category,
            'prediction_confidence' => $prediction['confidence'] ?? null,
            'category_id' => $category ? Category::where('name', $category)->value('id') : null,
            'is_outlier' => $isOutlier,
            'outlier_reason' => $reason,
            'status' => 'predicted',
        ]);

        // 5. Log the full ML response for debugging / future evaluation.
        PredictionLog::create([
            'expense_id' => $expense->id,
            'raw_input' => $expense->description,
            'raw_response' => $prediction,
            'model_version' => $prediction['model_version'] ?? '1.0',
            'latency_ms' => $prediction['latency_ms'] ?? null,
        ]);

        return response()->json($expense->fresh('category'), 201);
    }

    public function show(Expense $expense): JsonResponse
    {
        return response()->json($expense->load('category'));
    }

    /**
     * User confirms or corrects the predicted category. Confirmed rows become
     * the trusted baseline for outlier detection.
     */
    public function confirm(Request $request, Expense $expense): JsonResponse
    {
        $validated = $request->validate([
            'category' => ['required', 'string', 'exists:categories,name'],
        ]);

        $expense->update([
            'predicted_category' => $validated['category'],
            'category_id' => Category::where('name', $validated['category'])->value('id'),
            'status' => 'confirmed',
        ]);

        return response()->json($expense->fresh('category'));
    }

    public function destroy(Expense $expense): JsonResponse
    {
        $expense->delete(); // soft delete

        return response()->json(['deleted' => true]);
    }
}
