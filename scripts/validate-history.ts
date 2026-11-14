
import { countWorkingDays } from './working-days';

export type ValidatedLeavePeriod = {
  start: string;
  end: string;
  workingDays: number;
};

export function validateHistoricalPeriod(
  start: string,
  end: string,
  holidays: Set<string>
): ValidatedLeavePeriod | null {
  // A request must remain within one calendar year.
  if (start.slice(0, 4) !== end.slice(0, 4)) {
    return null;
  }

  // Count weekdays, excluding public holidays.
  let workingDays: number;

  try {
    workingDays = countWorkingDays(start, end, holidays);
  } catch {
    return null;
  }

  // Reject periods with no working days.
  if (workingDays <= 0) {
    return null;
  }

  return {
    start,
    end,
    workingDays,
  };
}
