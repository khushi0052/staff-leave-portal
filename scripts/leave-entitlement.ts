
export type AnnualLeaveRequest = {
  start: string;
  end: string;
  leaveType: 'annual' | 'sick' | 'unpaid';
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  workingDays: number;
};

/**
 * Calculate how many annual leave days can still be requested.
 *
 * Pending annual leave reserves days.
 * Approved annual leave uses days.
 * Rejected, cancelled, sick and unpaid leave do not count.
 */
export function getAvailableAnnualDays(
  entitlement: number,
  year: number,
  requests: AnnualLeaveRequest[]
): number {
  if (!Number.isInteger(entitlement) || entitlement < 0) {
    throw new Error('Invalid annual entitlement');
  }

  if (!Number.isInteger(year) || year < 1 || year > 9999) {
    throw new Error('Invalid year');
  }

  let committedDays = 0;

  for (const request of requests) {
    if (request.leaveType !== 'annual') {
      continue;
    }

    if (
      request.status !== 'pending' &&
      request.status !== 'approved'
    ) {
      continue;
    }

    if (
      request.start.slice(0, 4) !== String(year) ||
      request.end.slice(0, 4) !== String(year)
    ) {
      continue;
    }

    if (
      !Number.isInteger(request.workingDays) ||
      request.workingDays <= 0
    ) {
      throw new Error('Invalid working day count');
    }

    committedDays += request.workingDays;
  }

  return entitlement - committedDays;
}

/**
 * Decide whether a new annual request fits
 * within the employee's available entitlement.
 */
export function canRequestAnnualLeave(
  entitlement: number,
  year: number,
  requestedDays: number,
  existingRequests: AnnualLeaveRequest[]
): boolean {
  if (!Number.isInteger(requestedDays) || requestedDays <= 0) {
    return false;
  }

  return (
    getAvailableAnnualDays(
      entitlement,
      year,
      existingRequests
    ) >= requestedDays
  );
}
