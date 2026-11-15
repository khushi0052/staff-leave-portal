
import { useState } from 'react';
import type { FormEvent } from 'react';
import { supabase } from '../lib/supabase';

type LeaveType = 'annual' | 'sick' | 'unpaid';

type LeaveRequestFormProps = {
  onSuccess?: () => void;
};

// Format dates using the employee's local calendar date.
function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

// Add calendar days to a date.
function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

// Add calendar months, handling shorter months correctly.
function addMonths(date: Date, months: number): Date {
  const result = new Date(
    date.getFullYear(),
    date.getMonth() + months,
    1
  );

  const lastDay = new Date(
    result.getFullYear(),
    result.getMonth() + 1,
    0
  ).getDate();

  result.setDate(Math.min(date.getDate(), lastDay));

  return result;
}

export default function LeaveRequestForm({
  onSuccess,
}: LeaveRequestFormProps) {
  const [leaveType, setLeaveType] =
    useState<LeaveType>('annual');

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Use today's date to calculate allowed date ranges.
  const today = new Date();
  const todayString = formatDate(today);

  // Sick leave can start up to 10 days in the past.
  const sickEarliestDate = formatDate(addDays(today, -10));

  // Annual leave can be requested up to 6 months ahead.
  const annualLatestDate = formatDate(
    addMonths(today, 12)
  );

  // Retain the general 12-month future limit
  // for Sick and Unpaid leave.
  const generalLatestDate = formatDate(
    addMonths(today, 12)
  );

  const minimumDate =
    leaveType === 'sick'
      ? sickEarliestDate
      : todayString;

  const maximumDate =
    leaveType === 'annual'
      ? annualLatestDate
      : generalLatestDate;

  // Only Unpaid leave requires a reason.
  const reasonRequired = leaveType === 'unpaid';

  // Validate dates before enabling the submit button.
  const datesPresent =
    startDate !== '' && endDate !== '';

  const datesInOrder =
    datesPresent && endDate >= startDate;

  const datesWithinRange =
    datesPresent &&
    startDate >= minimumDate &&
    startDate <= maximumDate &&
    endDate >= minimumDate &&
    endDate <= maximumDate;

  // Leave cannot cross into another calendar year.
  const sameCalendarYear =
    datesPresent &&
    startDate.slice(0, 4) === endDate.slice(0, 4);

  const hasValidDates =
    datesPresent &&
    datesInOrder &&
    datesWithinRange &&
    sameCalendarYear;

  const hasRequiredReason =
    !reasonRequired || reason.trim().length > 0;

  const canSubmit =
    hasValidDates &&
    hasRequiredReason &&
    !submitting;

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (!canSubmit) return;

    setError('');
    setSuccess('');
    setSubmitting(true);

    try {
      const { data, error: submitError } =
        await supabase.rpc('submit_leave', {
          p_type: leaveType,
          p_start: startDate,
          p_end: endDate,
          p_reason: reason.trim(),
        });

      if (submitError) {
        throw submitError;
      }

      setSuccess(
        `Leave request submitted successfully. Reference: ${data}`
      );

      setStartDate('');
      setEndDate('');
      setReason('');

      onSuccess?.();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to submit your leave request.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="leave-form-section">
      <h3>Request Leave</h3>

      <form onSubmit={handleSubmit}>
        <label htmlFor="leave-type">
          Leave Type *
        </label>

        <select
          id="leave-type"
          value={leaveType}
          disabled={submitting}
          onChange={(event) => {
            setLeaveType(
              event.target.value as LeaveType
            );

            // Reset dates because the permitted
            // range changes with leave type.
            setStartDate('');
            setEndDate('');
            setReason('');
            setError('');
            setSuccess('');
          }}
          required
        >
          <option value="annual">Annual Leave</option>
          <option value="sick">Sick Leave</option>
          <option value="unpaid">Unpaid Leave</option>
        </select>

        <label htmlFor="start-date">
          Start Date *
        </label>

        <input
          id="start-date"
          type="date"
          value={startDate}
          min={minimumDate}
          max={maximumDate}
          disabled={submitting}
          required
          onChange={(event) => {
            setStartDate(event.target.value);
            setError('');
            setSuccess('');
          }}
        />

        <label htmlFor="end-date">
          End Date *
        </label>

        <input
          id="end-date"
          type="date"
          value={endDate}
          min={startDate || minimumDate}
          max={maximumDate}
          disabled={submitting}
          required
          onChange={(event) => {
            setEndDate(event.target.value);
            setError('');
            setSuccess('');
          }}
        />

        <p className="field-hint">
          {leaveType === 'annual' &&
            'Annual leave: today through 12 months in advance.'}

          {leaveType === 'sick' &&
            'Sick leave: up to 10 days before today.'}

          {leaveType === 'unpaid' &&
            'Unpaid leave: past dates are not permitted.'}
        </p>

        <label htmlFor="leave-reason">
          Reason {reasonRequired ? '*' : '(Optional)'}
        </label>

        <textarea
          id="leave-reason"
          value={reason}
          disabled={submitting}
          required={reasonRequired}
          rows={4}
          placeholder={
            reasonRequired
              ? 'Reason is required for Unpaid leave'
              : 'You may add a reason (optional)'
          }
          onChange={(event) => {
            setReason(event.target.value);
            setError('');
            setSuccess('');
          }}
        />

        {reasonRequired && !reason.trim() && (
          <p className="field-hint">
            Please enter a reason to enable submission.
          </p>
        )}

        <p className="field-hint">
          {leaveType === 'annual'
            ? 'Annual leave uses your HR-assigned balance.'
            : 'This leave type does not reduce your Annual balance.'}
        </p>

        {datesPresent && !hasValidDates && (
          <p className="error" role="alert">
            Please select valid dates within the
            allowed range and calendar year.
          </p>
        )}

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        {success && (
          <p className="success" role="status">
            {success}
          </p>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
        >
          {submitting
            ? 'Submitting...'
            : 'Submit Leave Request'}
        </button>
      </form>
    </section>
  );
}
