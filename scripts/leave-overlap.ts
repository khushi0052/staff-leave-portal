
// Statuses used by our leave request system.
export type LeaveStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'cancelled';

// Information needed to check overlapping requests.
export type LeavePeriod = {
  employeeEmail: string;
  start: string;
  end: string;
  status: LeaveStatus;
};

// Check whether a proposed request overlaps active leave.
export function hasActiveOverlap(
  proposed: LeavePeriod,
  existingRequests: LeavePeriod[]
): boolean {
  return existingRequests.some((existing) => {
    // Requests from different employees do not conflict.
    if (existing.employeeEmail !== proposed.employeeEmail) {
      return false;
    }

    // Only pending and approved requests block new dates.
    const isActive =
      existing.status === 'pending' ||
      existing.status === 'approved';

    if (!isActive) {
      return false;
    }

    // ISO dates in YYYY-MM-DD format can be compared
    // as strings when correctly formatted.
    const datesOverlap =
      proposed.start <= existing.end &&
      proposed.end >= existing.start;

    return datesOverlap;
  });
}
