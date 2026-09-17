<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * HTTP client for the Python/Flask ML microservice.
 *
 * Degrades gracefully: if the service is slow or down, the caller still gets a
 * usable result (fallback "Uncategorized") instead of an exception reaching the
 * user. Also measures round-trip latency for the prediction log.
 */
class MLService
{
    protected string $baseUrl;

    public function __construct()
    {
        $this->baseUrl = rtrim((string) config('services.ml.url', 'http://localhost:5001'), '/');
    }

    public function predict(string $description): array
    {
        try {
            $start = microtime(true);
            $response = Http::timeout(5)
                ->acceptJson()
                ->post($this->baseUrl . '/predict', ['description' => $description]);
            $latency = (int) round((microtime(true) - $start) * 1000);

            if ($response->successful()) {
                $data = $response->json();
                $data['latency_ms'] = $data['latency_ms'] ?? $latency;

                return $data;
            }

            Log::warning('ML service returned an error status', ['status' => $response->status()]);
        } catch (\Throwable $e) {
            Log::warning('ML service unavailable: ' . $e->getMessage());
        }

        // Defensive fallback so a missing ML service never blocks expense entry.
        return [
            'category' => 'Uncategorized',
            'confidence' => 0.0,
            'fallback' => true,
            'latency_ms' => 0,
            'model_version' => null,
        ];
    }
}
