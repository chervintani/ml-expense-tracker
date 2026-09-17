#!/usr/bin/env bash
# Populate the running app with a spread of sample expenses, including one
# deliberate outlier (a ₱5000 "Jollibee lunch"). The outlier detector needs at
# least 5 prior expenses in a category, so 5 normal Food rows are added first.
#
# Usage:  bash scripts/demo-data.sh
# Requires the Laravel app to be running on http://localhost:8000.
set -e
API="${1:-http://localhost:8000/api}"

post() {
  curl -s -o /dev/null -w "  %{http_code}  $1\n" -X POST "$API/expenses" \
    -H 'Content-Type: application/json' \
    -d "{\"description\":\"$1\",\"amount\":$2}"
}

echo "Seeding sample expenses -> $API"
# 5 normal Food expenses (baseline for the outlier check)
post "Jollibee lunch" 150
post "7-Eleven coffee" 80
post "McDonalds breakfast" 120
post "Samyang noodles grocery" 200
post "Mang Inasal chicken" 165
# other categories
post "Grab to office" 180
post "Jeepney fare" 13
post "Meralco bill payment" 2500
post "Maynilad water bill" 650
post "Netflix subscription" 549
post "Globe postpaid bill" 1299
post "Shopee order phone case" 320
post "Uniqlo shirt" 790
# the outlier (5 Food rows already exist above)
post "Jollibee lunch" 5000
echo "Done. Open http://localhost:8000"
