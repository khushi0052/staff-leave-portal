
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { demoUsers } from './demo-users';

// =====================================================
// 1. ENVIRONMENT VARIABLES
// =====================================================

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY;
const demoPassword = process.env.DEMO_USER_PASSWORD;

if (!supabaseUrl || !serviceRoleKey || !demoPassword) {
  throw new Error('Missing required environment variables');
}

// The seed must not accidentally target a hosted database.
const url = new URL(supabaseUrl);

if (
  !['127.0.0.1', 'localhost'].includes(url.hostname) ||
  url.port !== '54321'
) {
  throw new Error('This seed step only supports local Supabase');
}

// =====================================================
// 2. SUPABASE ADMIN CLIENT
// =====================================================

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// =====================================================
// 3. DEPARTMENTS
// =====================================================

const departmentNames = [
  'Engineering',
  'Sales',
  'Human Resources',
  'Operations',
];

async function seedDepartments() {
  const { data, error } = await supabase
    .from('departments')
    .upsert(
      departmentNames.map((name) => ({ name })),
      { onConflict: 'name' }
    )
    .select('id, name');

  if (error || !data) {
    throw new Error(
      `Failed to seed departments: ${error?.message}`
    );
  }

  if (data.length !== 4) {
    throw new Error('Expected exactly 4 departments');
  }

  return new Map(
    data.map((department) => [
      department.name,
      department.id,
    ])
  );
}

// =====================================================
// 4. LOAD EXISTING AUTH USERS
// =====================================================

async function getExistingUsers() {
  const users = new Map<string, string>();
  let page = 1;

  while (true) {
    const { data, error } =
      await supabase.auth.admin.listUsers({
        page,
        perPage: 100,
      });

    if (error) {
      throw new Error(
        `Failed to list users: ${error.message}`
      );
    }

    for (const user of data.users) {
      if (user.email) {
        users.set(user.email.toLowerCase(), user.id);
      }
    }

    if (data.users.length < 100) {
      break;
    }

    page++;
  }

  return users;
}

// =====================================================
// 5. CREATE EMPLOYEE ACCOUNTS
// =====================================================

async function seedEmployees(
  departmentIds: Map<string, string>
) {
  const existingUsers = await getExistingUsers();

  let created = 0;
  let alreadyExisting = 0;

  for (const employee of demoUsers) {
    const departmentId =
      departmentIds.get(employee.department);

    if (!departmentId) {
      throw new Error(
        `Unknown department: ${employee.department}`
      );
    }

    const email = employee.email.toLowerCase();
    let userId = existingUsers.get(email);

    // Create an Auth account if it does not exist.
    if (!userId) {
      const { data, error } =
        await supabase.auth.admin.createUser({
          email,
          password: demoPassword,
          email_confirm: true,
        });

      if (error || !data.user) {
        throw new Error(
          `Cannot create ${email}: ${error?.message}`
        );
      }

      userId = data.user.id;
      existingUsers.set(email, userId);
      created++;
    } else {
      alreadyExisting++;
    }

    // Check whether this Auth user has a profile.
    const { data: profile, error: lookupError } =
      await supabase
        .from('profiles')
        .select('id')
        .eq('id', userId)
        .maybeSingle();

    if (lookupError) {
      throw new Error(
        `Profile lookup failed: ${lookupError.message}`
      );
    }

    // Never overwrite existing profiles or HR entitlements.
    if (!profile) {
      const { error: insertError } = await supabase
        .from('profiles')
        .insert({
          id: userId,
          full_name: employee.fullName,
          email,
          role: employee.role,
          department_id: departmentId,
          annual_entitlement: 20,
        });

      if (insertError) {
        throw new Error(
          `Profile creation failed for ${email}: ${insertError.message}`
        );
      }
    }

    console.log(`Ready: ${email} (${employee.role})`);
  }

  console.log(`New Auth accounts: ${created}`);
  console.log(`Existing Auth accounts: ${alreadyExisting}`);
}

// =====================================================
// 6. MAIN FUNCTION
// =====================================================

async function main() {
  console.log('Starting demo account seed...');

  const departmentIds = await seedDepartments();
  console.log('Departments ready: 4');

  await seedEmployees(departmentIds);

  console.log('Demo account seeding completed!');
}

main().catch((error) => {
  console.error('Seed failed:', error);
  process.exitCode = 1;
});
