
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error('Missing Supabase configuration');
}

// Protect against accidentally seeding a hosted database.
const parsedUrl = new URL(url);

if (
  !['localhost', '127.0.0.1'].includes(parsedUrl.hostname) ||
  parsedUrl.port !== '54321'
) {
  throw new Error('This script only supports local Supabase');
}

const supabase = createClient(url, key, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Example company holidays, not an official regional calendar.
const holidays = [2025, 2026, 2027].flatMap((year) => [
  { date: `${year}-01-01`, name: 'Demo New Year Holiday' },
  { date: `${year}-05-01`, name: 'Demo May Holiday' },
  { date: `${year}-12-25`, name: 'Demo Year-End Holiday' },
]);

async function seedHolidays() {
  const { data, error } = await supabase
    .from('public_holidays')
    .upsert(holidays, { onConflict: 'date' })
    .select('date');

  if (error) {
    throw new Error(`Holiday seed failed: ${error.message}`);
  }

  console.log(`Seeded ${data.length} demonstration holidays.`);
}

seedHolidays().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
