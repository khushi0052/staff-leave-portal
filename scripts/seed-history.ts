
import { demoUsers } from './demo-users';

// The assessment requires approximately 5,000 requests.
const TOTAL_REQUESTS = 5000;

type LeaveStatus =
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'pending';

type LeaveType = 'annual' | 'sick' | 'unpaid';

type HistoricalRequest = {
  employeeEmail: string;
  leaveType: LeaveType;
  status: LeaveStatus;
};

// A deterministic random number generator.
// The same seed produces the same sequence.
function createRandom(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

const random = createRandom(42);

const statuses: LeaveStatus[] = [
  ...Array<LeaveStatus>(3250).fill('approved'),
  ...Array<LeaveStatus>(600).fill('rejected'),
  ...Array<LeaveStatus>(500).fill('cancelled'),
  ...Array<LeaveStatus>(650).fill('pending'),
];

const leaveTypes: LeaveType[] = [
  'annual',
  'sick',
  'unpaid',
];

// Shuffle statuses so they aren't grouped together.
for (let i = statuses.length - 1; i > 0; i--) {
  const j = Math.floor(random() * (i + 1));

  [statuses[i], statuses[j]] = [
    statuses[j],
    statuses[i],
  ];
}

// Generate the initial request records.
function generateRequests(): HistoricalRequest[] {
  const requests: HistoricalRequest[] = [];

  for (let i = 0; i < TOTAL_REQUESTS; i++) {
    const employee =
      demoUsers[Math.floor(random() * demoUsers.length)];

    const leaveType =
      leaveTypes[Math.floor(random() * leaveTypes.length)];

    requests.push({
      employeeEmail: employee.email,
      leaveType,
      status: statuses[i],
    });
  }

  return requests;
}

const requests = generateRequests();

console.log('Total requests:', requests.length);

for (const status of [
  'approved',
  'rejected',
  'cancelled',
  'pending',
] as const) {
  const count = requests.filter(
    (request) => request.status === status
  ).length;

  console.log(`${status}: ${count}`);
}

console.log('Historical data preview generated.');


import { countWorkingDays } from './working-days';

// Temporary holiday dates matching our demo holiday seed.
// Later we will load these directly from Supabase.
const holidays = new Set([
  '2025-01-01',
  '2025-05-01',
  '2025-12-25',
  '2026-01-01',
  '2026-05-01',
  '2026-12-25',
]);

// Generate a date in 2025 or 2026.
function randomLeaveDate(): string {
  const year = random() < 0.5 ? 2025 : 2026;
  const month = Math.floor(random() * 12);
  const day = Math.floor(random() * 28) + 1;

  const date = new Date(Date.UTC(year, month, day));

  return date.toISOString().slice(0, 10);
}

// Generate a short leave period.
function generateLeavePeriod() {
  const start = randomLeaveDate();

  const startDate = new Date(`${start}T00:00:00Z`);

  // Leave lasts between 1 and 5 calendar days.
  const duration = Math.floor(random() * 5) + 1;

  const endDate = new Date(startDate);
  endDate.setUTCDate(endDate.getUTCDate() + duration - 1);

  const end = endDate.toISOString().slice(0, 10);

  const workingDays = countWorkingDays(
    start,
    end,
    holidays
  );

  return {
    start,
    end,
    workingDays,
  };
}

// Print five example leave periods.
console.log('\nSample leave periods:');

for (let i = 0; i < 5; i++) {
  const period = generateLeavePeriod();

  console.log(period);
}
