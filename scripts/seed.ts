
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

// Read configuration from our private .env file.
const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY;

// Stop immediately if configuration is missing.
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing Supabase environment variables');
}

// This administrative client is for local scripts only.
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Our four demonstration departments.
const departments = [
  { name: 'Engineering' },
  { name: 'Sales' },
  { name: 'Human Resources' },
  { name: 'Operations' },
];

async function seedDepartments() {
  const { data, error } = await supabase
    .from('departments')
    .upsert(departments, { onConflict: 'name' })
    .select('id, name');

  if (error) {
    throw new Error(`Department seeding failed: ${error.message}`);
  }

  console.log(`Successfully seeded ${data.length} departments.`);

  for (const department of data) {
    console.log(department.name);
  }
}

seedDepartments().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
