
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

