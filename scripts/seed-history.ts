
import { demoUsers } from './demo-users';
import { validateHistoricalPeriod } from './validate-history';

// =====================================================
// 1. TYPES AND CONFIGURATION
// =====================================================

// Number of historical requests required by the assessment.
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

// =====================================================
// 2. DETERMINISTIC RANDOM NUMBER GENERATOR
// =====================================================

// The same seed produces the same random sequence.
function createRandom(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

const random = createRandom(42);

// =====================================================
// 3. REQUEST STATUS DISTRIBUTION
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

// Shuffle statuses using the deterministic random generator.
for (let i = statuses.length - 1; i > 0; i--) {
  const j = Math.floor(random() * (i + 1));

  [statuses[i], statuses[j]] = [
    statuses[j],
    statuses[i],
  ];
}

// =====================================================
// 4. GENERATE INITIAL REQUEST PREVIEWS
// =====================================================

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

// =====================================================
// 5. DEMONSTRATION PUBLIC HOLIDAYS
// =====================================================

// These dates match our current demonstration holiday seed.
// Later, we'll load holidays directly from PostgreSQL.
const holidays = new Set<string>([
  '2025-01-01',
  '2025-05-01',
  '2025-12-25',
  '2026-01-01',
  '2026-05-01',
  '2026-12-25',
]);

// =====================================================
// 6. GENERATE A RANDOM START DATE
// =====================================================

function randomLeaveDate(): string {
  const year = random() < 0.5 ? 2025 : 2026;

  // JavaScript months start at 0.
  const month = Math.floor(random() * 12);

  // Choose day 1 to 28 to avoid invalid month dates.
  const day = Math.floor(random() * 28) + 1;

  const date = new Date(Date.UTC(year, month, day));

  return date.toISOString().slice(0, 10);
}

// =====================================================
// 7. GENERATE A VALID LEAVE PERIOD
// =====================================================

function generateLeavePeriod() {
  // Try a maximum of 1000 times.
  for (let attempt = 0; attempt < 1000; attempt++) {
    const start = randomLeaveDate();

    const startDate = new Date(`${start}T00:00:00Z`);

    // Leave lasts between 1 and 5 calendar days.
    const duration = Math.floor(random() * 5) + 1;

    const endDate = new Date(startDate);

    endDate.setUTCDate(
      endDate.getUTCDate() + duration - 1
    );

    const end = endDate.toISOString().slice(0, 10);

    // Validate the dates and calculate working days.
    const validPeriod = validateHistoricalPeriod(
      start,
      end,
      holidays
    );

    // Return only valid leave periods.
    if (validPeriod !== null) {
      return validPeriod;
    }
  }

  // Fail clearly instead of returning invalid data.
  throw new Error(
    'Could not generate a valid leave period after 1000 attempts'
  );
}

// =====================================================
// 8. DISPLAY FIVE SAMPLE LEAVE PERIODS
// =====================================================

console.log('\nSample leave periods:');

for (let i = 0; i < 5; i++) {
  const period = generateLeavePeriod();

  console.log(period);
}
