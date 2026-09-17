#!/usr/bin/env python3
"""Generate a labeled training dataset for the expense classifier.

Combines realistic Philippine-context vendor/item templates per category and
applies light natural-language variation to grow the set to a few hundred rows.
Uses only the standard library, so it can run with any Python before the ML
virtualenv exists.

Run:  python3 generate_data.py   ->  writes data/expenses.csv
"""
import csv
import os
import random
from collections import Counter

random.seed(42)

# category -> realistic base descriptions (PH context)
TEMPLATES = {
    "Food": [
        "Jollibee lunch", "McDonalds breakfast", "Mang Inasal chicken",
        "Chowking lunch", "Max's fried chicken", "KFC dinner",
        "Samgyupsal dinner", "7-Eleven coffee", "Starbucks latte",
        "milk tea CoCo", "Macao Imperial milk tea", "siomai rice meal",
        "lugaw breakfast", "street food isaw", "grocery at SM Supermarket",
        "Puregold groceries", "Samyang noodles grocery", "Jollibee Chickenjoy",
        "Greenwich pizza", "Bonchon chicken", "fishball snack",
        "pandesal bakery", "lechon manok takeout", "Goldilocks cake",
    ],
    "Transport": [
        "Grab to office", "Grab car ride", "jeepney fare",
        "tricycle fare home", "MRT ride", "LRT fare", "bus fare to Cubao",
        "taxi to airport", "Angkas ride", "toll fee SLEX", "parking fee mall",
        "Beep card load", "gas Shell station", "gas Petron station",
        "Grab to the mall", "P2P bus fare", "tricycle to market",
        "diesel refuel", "EDSA bus fare", "habal-habal ride",
    ],
    "Utilities": [
        "Meralco bill payment", "Maynilad water bill", "Manila Water bill",
        "Globe internet bill", "PLDT home internet", "Converge fiber bill",
        "Sky Cable bill", "monthly electricity bill", "water utility bill",
        "Globe broadband plan", "Smart home wifi", "monthly internet plan",
    ],
    "Shopping": [
        "Shopee order phone case", "Lazada order earphones",
        "Uniqlo shirt", "SM Department Store", "Ace Hardware tools",
        "National Bookstore supplies", "Watsons toiletries",
        "Shopee 9.9 sale haul", "Lazada gadget", "Penshoppe jeans",
        "Miniso items", "laptop bag online", "headphones order",
        "new sneakers", "phone charger Shopee", "Decathlon gear",
        # household & personal-care goods (so hygiene items aren't read as Food)
        "sanitary napkin pack", "dishwashing liquid soap", "toilet cleaner",
        "shampoo and conditioner", "toothpaste and toothbrush",
        "laundry detergent powder", "toilet paper pack", "hand soap refill",
        "baby diapers", "household cleaning supplies",
    ],
    "Bills": [
        "Globe postpaid bill", "Smart postpaid plan", "Netflix subscription",
        "Spotify subscription", "credit card payment", "Pag-IBIG contribution",
        "PhilHealth contribution", "SSS contribution", "insurance premium",
        "personal loan payment", "monthly rent payment", "tuition fee payment",
        "Disney+ subscription", "YouTube Premium", "gym membership fee",
    ],
    "Other": [
        "ATM withdrawal", "bank transfer fee", "GCash cash in",
        "Maya load", "Mercury Drug medicine", "pharmacy paracetamol",
        "haircut at barbershop", "salon treatment", "donation to charity",
        "birthday gift", "pasalubong for family", "miscellaneous expense",
        "load e-wallet", "clinic consultation", "printing and photocopy",
    ],
}

# light variation prefixes (empty weighted so the base form dominates)
PREFIXES = ["", "", "", "paid ", "bought ", "for "]


def build_rows():
    rows = []
    for category, items in TEMPLATES.items():
        for item in items:
            rows.append((item, category))
            for _ in range(2):
                prefix = random.choice(PREFIXES)
                rows.append((f"{prefix}{item}".strip(), category))

    seen, unique = set(), []
    for desc, cat in rows:
        key = (desc.lower(), cat)
        if key not in seen:
            seen.add(key)
            unique.append((desc, cat))
    random.shuffle(unique)
    return unique


def main():
    base = os.path.dirname(os.path.abspath(__file__))
    out_dir = os.path.join(base, "data")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "expenses.csv")

    rows = build_rows()
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["description", "category"])
        writer.writerows(rows)

    dist = Counter(cat for _, cat in rows)
    print(f"Wrote {len(rows)} rows to {out_path}")
    for cat, n in sorted(dist.items()):
        print(f"  {cat:12s} {n}")


if __name__ == "__main__":
    main()
