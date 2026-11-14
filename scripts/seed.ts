
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

// =====================================================
// 1. LOAD ENVIRONMENT VARIABLES
// =====================================================

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY;
const demoPassword = process.env.DEMO_USER_PASSWORD;

// Stop if any required configuration is missing.
if (!supabaseUrl || !serviceRoleKey || !demoPassword) {
  throw new Error(
    'Missing SUPABASE_URL, SERVICE_ROLE_KEY or DEMO_USER_PASSWORD in .env'
  );
}

// =====================================================
// 2. CREATE SUPABASE ADMIN CLIENT
// =====================================================

// This client must only run in trusted scripts.
// Never use the secret key in React.
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// =====================================================
// 3. SEED DEPARTMENTS
// =====================================================

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
    throw new Error(
      `Department seeding failed: ${error.message}`
    );
  }

  console.log(`Successfully seeded ${data.length} departments.`);

  for (const department of data) {
    console.log(department.name);
  }
}

// =====================================================
// 4. SEED TEST EMPLOYEE
// =====================================================

async function seedTestEmployee() {
  const email = 'aarav.staff@example.com';

  // Find the Engineering department.
  const { data: department, error: departmentError } =
    await supabase
      .from('departments')
      .select('id')
      .eq('name', 'Engineering')
      .single();

  if (departmentError || !department) {
    throw new Error('Engineering department not found');
  }

  // Get existing authentication users.
  const { data: usersData, error: listError } =
    await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });

  if (listError) {
    throw new Error(
      `Failed to list users: ${listError.message}`
    );
  }

  // Check if Aarav already has an account.
  let user = usersData.users.find(
    (existingUser) => existingUser.email === email
  );

  // Create the account if it does not exist.
  if (!user) {
    const { data, error } =
      await supabase.auth.admin.createUser({
        email,
        password: demoPassword,
        email_confirm: true,
      });

    if (error || !data.user) {
      throw new Error(
        error?.message ?? 'Failed to create employee'
      );
    }

    user = data.user;

    console.log('Created new authentication account');
  } else {
    console.log('Employee account already exists');
  }

  // Check if the employee already has a profile.
  const { data: existingProfile, error: profileCheckError } =
    await supabase
      .from('profiles')
      .select('id')
      .eq('id', user.id)
      .maybeSingle();

  if (profileCheckError) {
    throw new Error(profileCheckError.message);
  }

  // Only create a profile when it does not exist.
  // This avoids overwriting HR-assigned entitlements.
  if (!existingProfile) {
    const { error: profileError } = await supabase
      .from('profiles')
      .insert({
        id: user.id,
        full_name: 'Aarav Sharma',
        email,
        role: 'staff',
        department_id: department.id,
        annual_entitlement: 20,
      });

    if (profileError) {
      throw new Error(
        `Failed to create profile: ${profileError.message}`
      );
    }

    console.log('Created employee profile');
  } else {
    console.log('Employee profile already exists');
  }

  console.log('Test employee is ready:', email);
}

// =====================================================
// 5. MAIN SEED FUNCTION
// =====================================================

async function main() {
  console.log('Starting database seed...');

  // Run in order so the department exists before
  // assigning the employee to it.
  await seedDepartments();
  await seedTestEmployee();

  console.log('Database seed completed successfully!');
}

// Run the script and report any errors.
main().catch((error) => {
  console.error('Seed failed:', error);
  process.exitCode = 1;
});
