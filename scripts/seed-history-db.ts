/**
 * Seed approximately 5,000 historical leave requests without touching existing
 * requests. The data is deterministic and repeat-safe. Run from repository root:
 *   npx tsx scripts/seed-history-db.ts                (dry run)
 *   For hosted WRITE, set SEED_HISTORY_WRITE and ALLOW_HOSTED_DEMO_SEED
 *   explicitly in your terminal only after reviewing the dry run.
 *
 * The configured SUPABASE_URL and SERVICE_ROLE_KEY must be server-side secrets.
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { demoUsers } from './demo-users';

type Status = 'approved' | 'rejected' | 'cancelled' | 'pending';
type LeaveType = 'annual' | 'sick' | 'unpaid';
type Person = {
  id: string;
  email: string;
  role: 'staff' | 'manager' | 'hr';
  department_id: string | null;
  annual_entitlement: number | null;
};
type Existing = {
  id: string;
  user_id: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  working_days: number;
  status: string;
  decided_by: string | null;
  created_at: string;
  updated_at: string;
};
type SeedRow = {
  id: string;
  user_id: string;
  department_id: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  working_days: number;
  status: Status;
  reason: string;
  decided_by: string | null;
  decision_comment: string | null;
  created_at: string;
  updated_at: string;
};
type AuditRow = {
  request_id: string;
  old_status: Status | null;
  new_status: Status;
  changed_by: string;
  comment: string | null;
  changed_at: string;
};

const TOTAL = 5000;
const BATCH = 100;
const SUPABASE_URL = process.env.SUPABASE_URL;
const KEY = process.env.SERVICE_ROLE_KEY;
const WRITE = process.env.SEED_HISTORY_WRITE === 'I_UNDERSTAND';
if (!URL || !KEY) throw new Error('Set SUPABASE_URL and SERVICE_ROLE_KEY in a root .env file.');
const endpoint = new URL(SUPABASE_URL!);
const local = ['localhost', '127.0.0.1'].includes(endpoint.hostname) && endpoint.port === '54321';
const hosted = endpoint.protocol === 'https:' && endpoint.hostname === 'bednwijfpolgzmkmtbfh.supabase.co';
if (!local && !hosted) throw new Error('Unrecognized Supabase project: refusing to seed.');
if (WRITE && hosted && process.env.ALLOW_HOSTED_DEMO_SEED !== 'I_CONFIRM_THIS_IS_MY_DEMO_PROJECT') {
  throw new Error('Hosted write blocked: confirm this is your demo project using ALLOW_HOSTED_DEMO_SEED.');
}
const db = createClient(SUPABASE_URL!, KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

function seededId(index: number): string {
  const hex = createHash('sha256').update(`leavedesk-historical-v1:${index}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
function rng(seed: number) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}
const random = rng(42);
const choose = <T>(items: T[]): T => items[Math.floor(random() * items.length)];
function iso(date: Date): string { return date.toISOString().slice(0, 10); }
function utcDate(text: string): Date { return new Date(`${text}T00:00:00Z`); }
function plusDays(text: string, count: number): string {
  const date = utcDate(text); date.setUTCDate(date.getUTCDate() + count); return iso(date);
}
function daysBetween(start: string, end: string, holidays: Set<string>): number {
  let days = 0;
  for (let d = start; d <= end; d = plusDays(d, 1)) {
    const weekday = utcDate(d).getUTCDay();
    if (weekday !== 0 && weekday !== 6 && !holidays.has(d)) days++;
  }
  return days;
}
async function fetchAll<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db.from(table).select(columns).order('id', { ascending: true }).range(offset, offset + 499);
    if (error) throw new Error(`Reading ${table}: ${error.message}`);
    const page = (data ?? []) as T[]; out.push(...page);
    if (page.length < 500) break;
  }
  return out;
}
function overlap(a: { start_date: string; end_date: string }, b: { start_date: string; end_date: string }): boolean {
  return a.start_date <= b.end_date && b.start_date <= a.end_date;
}
async function main() {
  console.log(`Target: ${local ? 'LOCAL' : 'HOSTED DEMO'} | ${WRITE ? 'WRITE' : 'DRY RUN'}`);
  const [people, allExisting] = await Promise.all([
    fetchAll<Person>('profiles', 'id,email,role,department_id,annual_entitlement'),
    fetchAll<Existing>('leave_requests', 'id,user_id,leave_type,start_date,end_date,working_days,status,decided_by,created_at,updated_at'),
  ]);
  // public_holidays uses "date" as its identifier; paginate without ordering by id.
  const holidays = new Set<string>();
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db.from('public_holidays').select('date').order('date').range(offset, offset + 499);
    if (error) throw new Error(`Reading public_holidays: ${error.message}`);
    for (const item of data ?? []) holidays.add(String(item.date));
    if ((data ?? []).length < 500) break;
  }
  const byEmail = new Map(people.map(p => [p.email.toLowerCase(), p]));
  const employees = demoUsers.map(u => byEmail.get(u.email.toLowerCase()));
  if (employees.some(p => !p || !p.department_id || p.annual_entitlement === null)) {
    throw new Error('Demo accounts/profiles are incomplete. Run and verify scripts/seed.ts first, then retry.');
  }
  const demoProfiles = employees as Person[];
const seedEmployees = demoProfiles.filter(
  (person) =>
    person.role === 'staff' ||
    person.role === 'manager'
);

if (seedEmployees.length < 30) {
  throw new Error(
    'Expected at least 30 Staff and Manager profiles.'
  );
}
  if (demoProfiles.length < 30) throw new Error(`Only ${demoProfiles.length} demo profiles configured; expected at least 30.`);
  if (!demoProfiles.some(p => p.role === 'hr')) throw new Error('Missing HR account for manager approval audit.');
  const hr = demoProfiles.find(p => p.role === 'hr')!;
  const managers = demoProfiles.filter(p => p.role === 'manager');
  const seedIds = Array.from({ length: TOTAL }, (_, i) => seededId(i));
  const seedIdSet = new Set(seedIds);
  const existingSeedRows = new Map(allExisting.filter(r => seedIdSet.has(r.id)).map(r => [r.id, r]));
  // CRITICAL for restart safety: generate all 5,000 rows against only non-seed
  // requests. Including previously inserted seed rows here changes RNG choices
  // and can make a resumed run produce a different dataset.
  const active = allExisting.filter(r =>
    !seedIdSet.has(r.id) && (r.status === 'pending' || r.status === 'approved')
  );
  const annual = new Map<string, number>();
  function balanceKey(userId: string, date: string) { return `${userId}:${date.slice(0, 4)}`; }
  for (const row of active) {
    if (row.leave_type !== 'annual') continue;
    const key = balanceKey(row.user_id, row.start_date);
    annual.set(key, (annual.get(key) ?? 0) + row.working_days);
  }

  const statuses: Status[] = [
    ...Array<Status>(3250).fill('approved'),
    ...Array<Status>(600).fill('rejected'),
    ...Array<Status>(500).fill('cancelled'),
    ...Array<Status>(650).fill('pending'),
  ];
  for (let i = statuses.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [statuses[i], statuses[j]] = [statuses[j], statuses[i]];
  }

  const rows: SeedRow[] = [];
  let alreadyPresent = 0;
  const end2026 = '2026-11-15'; // historical only, before this assessment date
  for (let i = 0; i < TOTAL; i++) {
    const id = seededId(i);
    const status = statuses[i];
    let generated: SeedRow | null = null;
    for (let attempt = 0; attempt < 3000; attempt++) {
      const person = choose(seedEmployees);
      const year = random() < 0.5 ? 2025 : 2026;
      const from = year === 2025 ? '2025-01-01' : '2026-01-01';
      const until = year === 2025 ? '2025-12-30' : end2026;
      const range = Math.round((utcDate(until).getTime() - utcDate(from).getTime()) / 86400000);
      const start = plusDays(from, Math.floor(random() * range));
      const end = plusDays(start, random() < 0.9 ? 0 : 1);
      if (end > until) continue;
      const working_days = daysBetween(start, end, holidays);
      if (working_days === 0) continue;
      const committed = status === 'approved' || status === 'pending';
      if (committed && active.some(r => r.user_id === person.id && overlap(r, { start_date: start, end_date: end }))) continue;
      let leave_type: LeaveType = choose<LeaveType>(['annual', 'sick', 'unpaid']);
      const balanceId = balanceKey(person.id, start);
      if (committed && leave_type === 'annual' && (annual.get(balanceId) ?? 0) + working_days > (person.annual_entitlement ?? 0)) {
        leave_type = choose<LeaveType>(['sick', 'unpaid']);
      }
      const reviewer = person.role === 'manager' ? hr :
        managers.find(p => p.department_id === person.department_id) ?? hr;
      generated = {
        id, user_id: person.id, department_id: person.department_id!, leave_type,
        start_date: start, end_date: end, working_days, status,
        reason: 'Historical demo leave request',
        decided_by: status === 'approved' || status === 'rejected' ? reviewer.id : null,
        decision_comment: status === 'rejected' ? 'Historical demo rejection' : null,
        created_at: `${plusDays(start, -(3 + Math.floor(random() * 20)))}T10:00:00Z`,
        updated_at: `${plusDays(start, -(status === 'pending' ? 3 : 1))}T12:00:00Z`,
      };
      if (committed) {
        active.push(generated);
        if (leave_type === 'annual') annual.set(balanceId, (annual.get(balanceId) ?? 0) + working_days);
      }
      break;
    }
    if (!generated) throw new Error(`Unable to fit historical request ${i + 1} without breaking balance/overlap rules.`);
    const present = existingSeedRows.get(id);
    if (present) {
      // Detect an incompatible partial seed instead of silently overwriting it.
      if (
        present.user_id !== generated.user_id ||
        present.leave_type !== generated.leave_type ||
        present.start_date !== generated.start_date ||
        present.end_date !== generated.end_date ||
        present.working_days !== generated.working_days ||
        present.status !== generated.status
      ) {
        throw new Error(`Existing seeded row ${id} differs from the deterministic dataset. Stop and investigate; no rows written.`);
      }
      alreadyPresent++;
    } else {
      rows.push(generated);
    }
  }
  console.log(`Existing requests: ${allExisting.length}, seed rows already present: ${alreadyPresent}, new rows to insert: ${rows.length}`);
  const counts = statuses.reduce<Record<string, number>>((result, status) => {
    result[status] = (result[status] ?? 0) + 1; return result;
  }, {});
  console.log('Target status mix:', counts);
  if (!WRITE) { console.log('DRY RUN: no rows inserted. Review output before enabling SEED_HISTORY_WRITE.'); return; }

  for (let offset = 0; offset < rows.length; offset += BATCH) {
    const chunk = rows.slice(offset, offset + BATCH);
    const { error } = await db.from('leave_requests').insert(chunk);
    if (error) throw new Error(`Insert batch ${offset / BATCH + 1} failed: ${error.message}`);
    console.log(`Inserted ${Math.min(offset + BATCH, rows.length)} / ${rows.length} new requests`);
  }
  // Add audit rows to represent the request creation and historical decisions.
  // Re-runs repair audit rows if a previous run was interrupted.
  const seedMap = new Map<string, Existing | SeedRow>([
    ...existingSeedRows.entries(),
    ...rows.map(r => [r.id, r] as const),
  ]);
  for (let offset = 0; offset < seedIds.length; offset += BATCH) {
    const ids = seedIds.slice(offset, offset + BATCH);
    const { data: existingAudits, error: auditReadError } = await db.from('leave_audit')
      .select('request_id,old_status,new_status').in('request_id', ids);
    if (auditReadError) throw new Error(`Audit lookup failed: ${auditReadError.message}`);
    const seen = new Set((existingAudits ?? []).map(a => `${a.request_id}:${a.old_status ?? 'null'}:${a.new_status}`));
    const audits: AuditRow[] = [];
    for (const id of ids) {
      const record = seedMap.get(id);
      if (!record) continue;
      const employeeId = record.user_id;
      if (!seen.has(`${id}:null:pending`)) audits.push({ request_id: id, old_status: null, new_status: 'pending', changed_by: employeeId, comment: 'Historical demo seed', changed_at: record.created_at });
      if (record.status !== 'pending' && !seen.has(`${id}:pending:${record.status}`)) {
        const actor = ('decided_by' in record && record.decided_by) ? String(record.decided_by) : employeeId;
        audits.push({ request_id: id, old_status: 'pending', new_status: record.status as Status, changed_by: actor, comment: 'Historical demo seed', changed_at: record.updated_at });
      }
    }
    if (audits.length) {
      const { error } = await db.from('leave_audit').insert(audits);
      if (error) throw new Error(`Audit insert failed: ${error.message}`);
    }
  }
  // Verify all deterministic IDs exist, not just the overall row count.
  for (let offset = 0; offset < seedIds.length; offset += BATCH) {
    const batchIds = seedIds.slice(offset, offset + BATCH);
    const { data, error } = await db.from('leave_requests').select('id').in('id', batchIds);
    if (error) throw new Error(`Verification of seed IDs failed: ${error.message}`);
    if ((data ?? []).length !== batchIds.length) {
      throw new Error(`Missing seeded rows after insert in batch ${offset / BATCH + 1}.`);
    }
  }
  const { count, error: countError } = await db.from('leave_requests').select('id', { count: 'exact', head: true });
  if (countError) throw new Error(`Verification failed: ${countError.message}`);
  console.log(`SUCCESS: database now contains ${count} total leave requests (${TOTAL} deterministic seed IDs plus pre-existing records).`);
}
main().catch(e => { console.error(`Seed failed: ${e instanceof Error ? e.message : String(e)}`); process.exitCode = 1; });
