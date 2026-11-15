
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
  throw new Error(
    'Missing SUPABASE_URL, SERVICE_ROLE_KEY or DEMO_USER_PASSWORD'
  );
}

if (demoPassword.length < 8) {
  throw new Error(
    'DEMO_USER_PASSWORD must have at least 8 characters.'
  );
}

// =====================================================
// 2. DATABASE SAFETY CHECK
// =====================================================

// Only permit:
// 1. The local Supabase development environment.
// 2. Our specific hosted Supabase demo project,
//    with an additional explicit confirmation.

const url = new URL(supabaseUrl);

const isLocal =
  ['127.0.0.1', 'localhost'].includes(url.hostname) &&
  url.port === '54321';

const isApprovedHostedProject =
  url.protocol === 'https:' &&
  url.hostname === 'bednwijfpolgzmkmtbfh.supabase.co' &&
  process.env.ALLOW_HOSTED_DEMO_SEED ===
    'I_CONFIRM_THIS_IS_MY_DEMO_PROJECT';

if (!isLocal && !isApprovedHostedProject) {
  throw new Error(
    'Seeding blocked. Target local Supabase or explicitly authorize the hosted demo project.'
  );
}

console.log(
  `Seeding target: ${isLocal ? 'LOCAL SUPABASE' : 'HOSTED DEMO SUPABASE'}`
);

console.log(`Expected demo users: ${demoUsers.length}`);

// =====================================================
// 3. SUPABASE ADMIN CLIENT
// =====================================================

// IMPORTANT:
// SERVICE_ROLE_KEY / secret key is used only by this
// server-side script.
//
// Never place this key in React, Vite or a public repository.

const supabase = createClient(
  supabaseUrl,
  serviceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

// =====================================================
// 4. DEPARTMENTS
// =====================================================

const departmentNames = [
  'Engineering',
  'Sales',
  'Human Resources',
  'Operations',
];

async function seedDepartments(): Promise<Map<string, string>> {
  console.log('Checking departments...');

  const { data, error } = await supabase
    .from('departments')
    .upsert(
      departmentNames.map((name) => ({ name })),
      { onConflict: 'name' }
    )
    .select('id, name');

  if (error || !data) {
    throw new Error(
      `Failed to seed departments: ${
        error?.message ?? 'No data returned'
      }`
    );
  }

  if (data.length !== departmentNames.length) {
    throw new Error(
      `Expected ${departmentNames.length} departments, received ${data.length}`
    );
  }

  console.log(`Departments ready: ${data.length}`);

  return new Map(
    data.map((department) => [
      department.name as string,
      department.id as string,
    ])
  );
}

// =====================================================
// 5. LOAD EXISTING AUTHENTICATION USERS
// =====================================================

// We check existing users before creating new ones.
// This prevents duplicates when the script is rerun.

async function getExistingUsers(): Promise<Map<string, string>> {
  console.log('Checking existing Auth accounts...');

  const existingUsers = new Map<string, string>();

  let page = 1;
  const perPage = 100;

  while (true) {
    const { data, error } =
      await supabase.auth.admin.listUsers({
        page,
        perPage,
      });

    if (error) {
      throw new Error(
        `Failed to list Auth users: ${error.message}`
      );
    }

    for (const user of data.users) {
      if (user.email) {
        existingUsers.set(
          user.email.toLowerCase(),
          user.id
        );
      }
    }

    if (data.users.length < perPage) {
      break;
    }

    page++;
  }

  console.log(
    `Existing Auth accounts found: ${existingUsers.size}`
  );

  return existingUsers;
}

// =====================================================
// 6. CREATE DEMO ACCOUNTS AND PROFILES
// =====================================================

async function seedEmployees(
  departmentIds: Map<string, string>
): Promise<void> {
  const existingUsers = await getExistingUsers();

  let created = 0;
  let alreadyExisting = 0;
  let profilesCreated = 0;
  let profilesConfigured = 0;
  let profilesPreserved = 0;

  for (const employee of demoUsers) {
    const departmentId =
      departmentIds.get(employee.department);

    if (!departmentId) {
      throw new Error(
        `Unknown department for ${employee.email}: ${employee.department}`
      );
    }

    const email = employee.email.trim().toLowerCase();

    let userId = existingUsers.get(email);
    let wasCreated = false;

    // ---------------------------------------------
    // A. CREATE AUTH USER IF IT DOES NOT EXIST
    // ---------------------------------------------

    if (!userId) {
      const { data, error } =
        await supabase.auth.admin.createUser({
          email,
          password: demoPassword,
          email_confirm: true,
        });

      if (error || !data.user) {
        throw new Error(
          `Cannot create Auth user ${email}: ${
            error?.message ?? 'No user returned'
          }`
        );
      }

      userId = data.user.id;
      existingUsers.set(email, userId);

      wasCreated = true;
      created++;
    } else {
      alreadyExisting++;
    }

    // ---------------------------------------------
    // B. CHECK EXISTING PROFILE
    // ---------------------------------------------

    const { data: profile, error: lookupError } =
      await supabase
        .from('profiles')
        .select(
          'id, full_name, email, role, department_id, annual_entitlement'
        )
        .eq('id', userId)
        .maybeSingle();

    if (lookupError) {
      throw new Error(
        `Profile lookup failed for ${email}: ${lookupError.message}`
      );
    }

    // ---------------------------------------------
    // C. CONFIGURE A NEW USER'S PROFILE
    // ---------------------------------------------

    if (wasCreated) {
      // A database trigger might have already created
      // a basic profile when the Auth user was created.
      //
      // We use UPSERT to configure that new profile
      // with the correct department, name and role.

      const { error: profileError } =
        await supabase
          .from('profiles')
          .upsert(
            {
              id: userId,
              full_name: employee.fullName,
              email,
              role: employee.role,
              department_id: departmentId,
              annual_entitlement: 20,
            },
            { onConflict: 'id' }
          );

      if (profileError) {
        throw new Error(
          `Failed to configure new profile ${email}: ${profileError.message}`
        );
      }

      profilesConfigured++;
    }

    // ---------------------------------------------
    // D. EXISTING USER WITH NO PROFILE
    // ---------------------------------------------

    else if (!profile) {
      const { error: insertError } =
        await supabase
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
          `Failed to create missing profile ${email}: ${insertError.message}`
        );
      }

      profilesCreated++;
    }

    // ---------------------------------------------
    // E. EXISTING USER WITH EXISTING PROFILE
    // ---------------------------------------------

    else {
      // Do not overwrite existing roles,
      // departments or HR-assigned entitlements.
      profilesPreserved++;

      // Alert if the existing account has
      // a different role from our demo definition.
      if (profile.role !== employee.role) {
        console.warn(
          `WARNING: ${email} has database role "${profile.role}", expected "${employee.role}". Existing role preserved.`
        );
      }
    }

    console.log(
      `Ready: ${email} (${employee.role})`
    );
  }

  // ---------------------------------------------
  // F. SUMMARY
  // ---------------------------------------------

  console.log('\n========== SEED SUMMARY ==========');
  console.log(`Expected demo accounts: ${demoUsers.length}`);
  console.log(`New Auth accounts: ${created}`);
  console.log(`Existing Auth accounts: ${alreadyExisting}`);
  console.log(`New profiles created: ${profilesCreated}`);
  console.log(`New profiles configured: ${profilesConfigured}`);
  console.log(`Existing profiles preserved: ${profilesPreserved}`);
  console.log('==================================\n');
}

// =====================================================
// 7. VERIFY SEEDED DEMO ACCOUNTS
// =====================================================

async function verifySeed(): Promise<void> {
  console.log('Verifying demo accounts...');

  const expectedEmails = demoUsers.map((employee) =>
    employee.email.trim().toLowerCase()
  );

  const { data: profiles, error } =
    await supabase
      .from('profiles')
      .select('id, email, role, department_id')
      .in('email', expectedEmails);

  if (error) {
    throw new Error(
      `Verification failed: ${error.message}`
    );
  }

  const existingEmails = new Set(
    (profiles ?? []).map((profile) =>
      String(profile.email).toLowerCase()
    )
  );

  const missingEmails = expectedEmails.filter(
    (email) => !existingEmails.has(email)
  );

  if (missingEmails.length > 0) {
    throw new Error(
      `Missing ${missingEmails.length} demo profiles: ${missingEmails.join(', ')}`
    );
  }

  console.log(
    `Verified ${expectedEmails.length} demo profiles.`
  );

  const roleCounts = {
    staff: 0,
    manager: 0,
    hr: 0,
  };

  for (const profile of profiles ?? []) {
    if (profile.role === 'staff') roleCounts.staff++;
    if (profile.role === 'manager') roleCounts.manager++;
    if (profile.role === 'hr') roleCounts.hr++;
  }

  console.log('Role distribution:', roleCounts);
}

// =====================================================
// 8. MAIN FUNCTION
// =====================================================

async function main(): Promise<void> {
  console.log('\nStarting demo account seed...\n');

  const departmentIds = await seedDepartments();

  await seedEmployees(departmentIds);

  await verifySeed();

  console.log('\nDemo account seeding completed successfully!');
}

// Handle errors without exposing credentials.

main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : 'Unknown seed error';

  console.error(`\nSeed failed: ${message}`);
  process.exitCode = 1;
});
