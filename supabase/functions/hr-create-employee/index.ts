import { createClient } from 'npm:@supabase/supabase-js@2';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function getSecretKey(): string | undefined {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  try {
    const secrets = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>;
    return secrets.default;
  } catch { return undefined; }
}

function calculateEntitlement(joiningDate: string): number {
  const [y, m, d] = joiningDate.split('-').map(Number);
  const currentYear = new Date().getUTCFullYear();
  const date = new Date(Date.UTC(y, m - 1, d));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(joiningDate) ||
      date.getUTCFullYear() !== y || date.getUTCMonth() + 1 !== m ||
      date.getUTCDate() !== d || y > currentYear) {
    throw new Error('Invalid joining date.');
  }
  const today = new Date();
  const todayKey = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(today.getUTCDate()).padStart(2, '0')}`;
  if (joiningDate > todayKey) throw new Error('Joining date cannot be in the future.');
  if (y < currentYear) return 20;
  const eligibleMonths = m === 1 ? 12 : 12 - m;
  return Math.round((20 * eligibleMonths) / 12);
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });

  const token = request.headers.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return json(401, { error: 'Please sign in as HR.' });

  const url = Deno.env.get('SUPABASE_URL');
  const secretKey = getSecretKey();
  const initialPassword = Deno.env.get('EMPLOYEE_INITIAL_PASSWORD');
  if (!url || !secretKey || !initialPassword || initialPassword.length < 12) {
    return json(500, { error: 'Employee creation is not configured on the server.' });
  }

  const admin = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Verify the caller's actual Supabase Auth session, then role from database.
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) return json(401, { error: 'Session is invalid.' });
  const { data: hr, error: hrError } = await admin.from('profiles')
    .select('role').eq('id', authData.user.id).single();
  if (hrError || hr?.role !== 'hr') return json(403, { error: 'Only HR may create employees.' });

  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return json(400, { error: 'Invalid JSON body.' }); }

  const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const departmentId = typeof body.department_id === 'string' ? body.department_id : '';
  const isManager = body.is_manager;
  const joiningDate = typeof body.joining_date === 'string' ? body.joining_date : '';

  if (fullName.length < 2 || fullName.length > 120 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
      !/^[0-9a-fA-F-]{36}$/.test(departmentId) || typeof isManager !== 'boolean') {
    return json(400, { error: 'Enter a valid name, email, department and manager selection.' });
  }

  let annualEntitlement: number;
  try { annualEntitlement = calculateEntitlement(joiningDate); }
  catch { return json(400, { error: 'Invalid joining date.' }); }

  const { data: department, error: departmentError } = await admin
    .from('departments').select('id').eq('id', departmentId).maybeSingle();
  if (departmentError || !department) return json(400, { error: 'Select an existing department.' });

  const { data: created, error: creationError } = await admin.auth.admin.createUser({
    email,
    password: initialPassword,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (creationError || !created.user) {
    return json(400, { error: creationError?.message ?? 'Unable to create account.' });
  }

  const employeeId = created.user.id;
  const { error: profileError } = await admin.from('profiles').upsert({
    id: employeeId,
    full_name: fullName,
    email,
    department_id: departmentId,
    role: isManager ? 'manager' : 'staff',
    annual_entitlement: annualEntitlement,
    joining_date: joiningDate,
  }, { onConflict: 'id' });

  if (profileError) {
    // Avoid leaving an Auth account without an employee profile.
    const { error: rollbackError } = await admin.auth.admin.deleteUser(employeeId);
    return json(500, {
      error: rollbackError
        ? 'Profile creation failed; account cleanup also failed. Contact your administrator.'
        : 'Profile creation failed. No employee account was retained.',
    });
  }

  return json(201, { id: employeeId, annual_entitlement: annualEntitlement });
});
