
/**
 * Count working days between two dates.
 *
 * Rules:
 * - Start and end dates are included.
 * - Monday to Friday count.
 * - Saturday and Sunday do not count.
 * - Public holidays do not count.
 */

export function countWorkingDays(
  startDate: string,
  endDate: string,
  holidays: Set<string>
): number {

  // Ensure the dates use YYYY-MM-DD format.
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;

  if (
    !datePattern.test(startDate) ||
    !datePattern.test(endDate)
  ) {
    throw new Error('Dates must use YYYY-MM-DD format');
  }

  // Convert strings into UTC dates.
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);

  // Reject invalid calendar dates.
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    start.toISOString().slice(0, 10) !== startDate ||
    end.toISOString().slice(0, 10) !== endDate
  ) {
    throw new Error('Invalid calendar date');
  }

  if (end < start) {
    throw new Error('End date cannot be before start date');
  }

  let workingDays = 0;

  // Visit every date, including the end date.
  for (
    const current = new Date(start);
    current <= end;
    current.setUTCDate(current.getUTCDate() + 1)
  ) {
    const day = current.getUTCDay();

    // Sunday = 0, Saturday = 6.
    const isWeekday = day >= 1 && day <= 5;

    const dateString = current.toISOString().slice(0, 10);

    const isHoliday = holidays.has(dateString);

    if (isWeekday && !isHoliday) {
      workingDays++;
    }
  }

  return workingDays;
}
