<?php

namespace Database\Seeders;

use App\Models\Category;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    /**
     * Seed the six expense categories the ML model predicts over.
     */
    public function run(): void
    {
        $categories = ['Food', 'Transport', 'Utilities', 'Shopping', 'Bills', 'Other'];

        foreach ($categories as $name) {
            Category::firstOrCreate(['name' => $name]);
        }
    }
}
