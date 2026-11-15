
export type LeaveType = 'annual' | 'sick' | 'unpaid';

export function isValidDateRange(start: string, end: string): boolean {
  if (!start || !end) return false;

  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);

  if (
    Number.isNaN(startDate.getTime()) ||
    Number.isNaN(endDate.getTime())
  ) {
    return false;
  }

  return startDate <= endDate;
}

export function isReasonRequired(type: LeaveType): boolean {
  return type === 'unpaid';
}

export function isValidEntitlement(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
