
import { demoUsers } from './demo-users';
import { validateHistoricalPeriod } from './validate-history';

// =====================================================
// 1. CONFIGURATION AND TYPES
// =====================================================

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
  start: string;
  end: string;
  workingDays: number;
};

// =====================================================
// 2. DETERMINISTIC RANDOM GENERATOR
// =====================================================

function createRandom(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

const random = createRandom(42);

// =====================================================
// 3. STATUSES AND LEAVE TYPES
// =====================================================

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

// Shuffle statuses.
for (let i = statuses.length - 1; i > 0; i--) {
  const j = Math.floor(random() * (i + 1));

  [statuses[i], statuses[j]] = [
    statuses[j],
    statuses[i],
  ];
}

// =====================================================
// 4. DEMONSTRATION HOLIDAYS
// =====================================================

// Temporary list used by the preview.
// The final database seed will load holidays from Supabase.
const holidays = new Set<string>([
  '2025-01-01',
  '2025-05-01',
  '2025-12-25',
  '2026-01-01',
  '2026-05-01',
  '2026-12-25',
]);

// =====================================================
// 5. DATE GENERATION
// =====================================================

function randomLeaveDate(): string {
  const year = random() < 0.5 ? 2025 : 2026;
  const month = Math.floor(random() * 12);
  const day = Math.floor(random() * 28) + 1;

  return new Date(
    Date.UTC(year, month, day)
  ).toISOString().slice(0, 10);
}

function generateLeavePeriod() {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const start = randomLeaveDate();

    const startDate = new Date(
      `${start}T00:00:00Z`
    );

    const duration = Math.floor(random() * 5) + 1;

    const endDate = new Date(startDate);

    endDate.setUTCDate(
      endDate.getUTCDate() + duration - 1
    );

    const end = endDate.toISOString().slice(0, 10);

    const period = validateHistoricalPeriod(
      start,
      end,
      holidays
    );

    if (period !== null) {
      return period;
    }
  }

  throw new Error(
    'Could not generate a valid historical leave period'
  );
}

// =====================================================
// 6. GENERATE ALL 5,000 REQUEST PREVIEWS
// =====================================================

function generateRequests(): HistoricalRequest[] {
  const requests: HistoricalRequest[] = [];

  if (demoUsers.length === 0) {
    throw new Error('No demo users available');
  }

  for (let i = 0; i < TOTAL_REQUESTS; i++) {
    const employee =
      demoUsers[Math.floor(random() * demoUsers.length)];

    const leaveType =
      leaveTypes[Math.floor(random() * leaveTypes.length)];

    // Each request receives its own valid date period.
    const period = generateLeavePeriod();

    requests.push({
      employeeEmail: employee.email,
      leaveType,
      status: statuses[i],
      start: period.start,
      end: period.end,
      workingDays: period.workingDays,
    });
  }

  return requests;
}

// =====================================================
// 7. GENERATE AND VERIFY THE PREVIEW
// =====================================================

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

// Confirm every request has a valid period.
const invalidRequests = requests.filter(
  (request) =>
    request.workingDays <= 0 ||
    request.start.slice(0, 4) !==
      request.end.slice(0, 4)
);

console.log(
  'Invalid date periods:',
  invalidRequests.length
);

// Confirm the number of unique employees.
const uniqueEmployees = new Set(
  requests.map((request) => request.employeeEmail)
);

console.log(
  'Employees represented:',
  uniqueEmployees.size
);

// =====================================================
// 8. DISPLAY FIVE COMPLETE REQUEST PREVIEWS
// =====================================================

console.log('\nSample historical requests:');

for (const request of requests.slice(0, 5)) {
  console.log(request);
}

console.log(
  '\nPreview complete. No database records inserted.'
);
