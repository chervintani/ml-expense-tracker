#!/usr/bin/env bash
# Start all three services for the Smart Expense Tracker.
#   - MySQL            (Homebrew service, runs in the background)
#   - Flask ML service (port 5001, started in the background)
#   - Laravel server   (port 8000, runs in the foreground)
#
# Usage:  bash start.sh      (then open http://localhost:8000)
# Stop:   press Ctrl+C       (stops Flask + Laravel; MySQL keeps running)
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "==> Starting MySQL (Homebrew service)..."
brew services start mysql >/dev/null 2>&1 || true

echo "==> Starting Flask ML service on :5001..."
cd "$ROOT/ml-service"
.venv/bin/python app.py > /tmp/expense-ml.log 2>&1 &
ML_PID=$!
trap "echo; echo '==> Stopping ML service...'; kill $ML_PID 2>/dev/null" EXIT

# Wait until the model has loaded and the service answers.
printf "    waiting for ML service"
until curl -s http://localhost:5001/health >/dev/null 2>&1; do printf "."; sleep 0.5; done
echo " ready (logs: /tmp/expense-ml.log)"

echo "==> Starting Laravel on http://localhost:8000  (Ctrl+C to stop everything)"
cd "$ROOT/backend"
php artisan serve
