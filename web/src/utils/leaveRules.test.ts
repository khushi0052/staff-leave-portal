
import { describe, expect, it } from 'vitest';
import {
  isReasonRequired,
  isValidDateRange,
  isValidEntitlement,
} from './leaveRules';

describe('Leave date validation', () => {
  it('accepts a valid date range', () => {
    expect(isValidDateRange('2026-11-20', '2026-11-22')).toBe(true);
  });

  it('rejects an end date before the start date', () => {
    expect(isValidDateRange('2026-11-22', '2026-11-20')).toBe(false);
  });

  it('rejects missing dates', () => {
    expect(isValidDateRange('', '2026-11-20')).toBe(false);
  });
});

describe('Leave reason requirements', () => {
  it('requires a reason for unpaid leave', () => {
    expect(isReasonRequired('unpaid')).toBe(true);
  });

  it('does not require a reason for annual leave', () => {
    expect(isReasonRequired('annual')).toBe(false);
  });

  it('does not require a reason for sick leave', () => {
    expect(isReasonRequired('sick')).toBe(false);
  });
});

describe('HR entitlement validation', () => {
  it('accepts zero and positive whole numbers', () => {
    expect(isValidEntitlement(0)).toBe(true);
    expect(isValidEntitlement(24)).toBe(true);
  });

  it('rejects negative values', () => {
    expect(isValidEntitlement(-1)).toBe(false);
  });

  it('rejects fractional values', () => {
    expect(isValidEntitlement(12.5)).toBe(false);
  });
});
