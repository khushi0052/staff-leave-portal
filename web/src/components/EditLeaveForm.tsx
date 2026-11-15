
import { useState } from 'react';
import type { FormEvent } from 'react';
import { supabase } from '../lib/supabase';

type LeaveType = 'annual' | 'sick' | 'unpaid';

type EditableRequest = {
  id: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: 'pending' | 'approved';
};

type EditLeaveFormProps = {
  request: EditableRequest;
  onSuccess: () => void;
  onClose: () => void;
};

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function addMonths(date: Date, months: number): Date {
  const target = new Date(
    date.getFullYear(),
    date.getMonth() + months,
    1
  );

  const lastDay = new Date(
    target.getFullYear(),
    target.getMonth() + 1,
    0
  ).getDate();

  target.setDate(Math.min(date.getDate(), lastDay));
  return target;
}

export default function EditLeaveForm({
  request,
  onSuccess,
  onClose,
}: EditLeaveFormProps) {
  const [leaveType, setLeaveType] = useState<LeaveType>(
    request.leave_type
  );

  const [startDate, setStartDate] = useState(
    request.start_date
  );

  const [endDate, setEndDate] = useState(
    request.end_date
  );

  const [reason, setReason] = useState(
    request.reason ?? ''
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const today = new Date();

  const earliestDate =
    leaveType === 'sick'
      ? formatLocalDate(addDays(today, -10))
      : formatLocalDate(today);

  const latestDate = formatLocalDate(
    addMonths(today, 12)
  );

  const reasonRequired = leaveType === 'unpaid';

  const datesValid =
    startDate !== '' &&
    endDate !== '' &&
    startDate <= endDate &&
    startDate >= earliestDate &&
    endDate <= latestDate &&
    startDate.slice(0, 4) === endDate.slice(0, 4);

  const reasonValid =
    !reasonRequired || reason.trim().length > 0;

  const hasChanges =
    leaveType !== request.leave_type ||
    startDate !== request.start_date ||
    endDate !== request.end_date ||
    reason.trim() !== (request.reason ?? '').trim();

  const canSave =
    datesValid &&
    reasonValid &&
    reason.length <= 1000 &&
    hasChanges &&
    !saving;

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (!canSave) return;

    setError('');
    setSaving(true);

    try {
      const { error: updateError } =
        await supabase.rpc('edit_leave', {
          p_id: request.id,
          p_type: leaveType,
          p_start: startDate,
          p_end: endDate,
          p_reason: reason.trim(),
        });

      if (updateError) {
        throw updateError;
      }

      onSuccess();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to update your leave request.'
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="leave-form-section">
      <h3>Edit / Postpone Leave</h3>

      {request.status === 'approved' && (
        <p className="field-hint">
          Editing approved leave will change its status
          to Pending and require fresh approval.
        </p>
      )}

      <form onSubmit={handleSubmit}>
        <label htmlFor={`edit-type-${request.id}`}>
          Leave Type *
        </label>

        <select
          id={`edit-type-${request.id}`}
          value={leaveType}
          disabled={saving}
          onChange={(event) => {
            setLeaveType(event.target.value as LeaveType);
            setError('');
          }}
        >
          <option value="annual">Annual Leave</option>
          <option value="sick">Sick Leave</option>
          <option value="unpaid">Unpaid Leave</option>
        </select>

        <label htmlFor={`edit-start-${request.id}`}>
          Start Date *
        </label>

        <input
          id={`edit-start-${request.id}`}
          type="date"
          value={startDate}
          min={earliestDate}
          max={latestDate}
          disabled={saving}
          required
          onChange={(event) => {
            setStartDate(event.target.value);
            setError('');
          }}
        />

        <label htmlFor={`edit-end-${request.id}`}>
          End Date *
        </label>

        <input
          id={`edit-end-${request.id}`}
          type="date"
          value={endDate}
          min={startDate || earliestDate}
          max={latestDate}
          disabled={saving}
          required
          onChange={(event) => {
            setEndDate(event.target.value);
            setError('');
          }}
        />

        <label htmlFor={`edit-reason-${request.id}`}>
          Reason {reasonRequired ? '*' : '(Optional)'}
        </label>

        <textarea
          id={`edit-reason-${request.id}`}
          value={reason}
          rows={3}
          maxLength={1000}
          required={reasonRequired}
          disabled={saving}
          onChange={(event) => {
            setReason(event.target.value);
            setError('');
          }}
        />

        {reasonRequired && (
          <p className="field-hint">
            A reason is mandatory for Unpaid leave.
          </p>
        )}

        {!datesValid && (
          <p className="field-hint">
            Select valid dates. Annual and Unpaid leave
            cannot start in the past; Sick leave can
            start up to 10 days ago. All leave types
            are limited to 12 months ahead and cannot
            cross calendar years.
          </p>
        )}

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" disabled={!canSave}>
          {saving ? 'Saving...' : 'Save Changes'}
        </button>

        <button
          type="button"
          onClick={onClose}
          disabled={saving}
        >
          Close Without Saving
        </button>
      </form>
    </section>
  );
}
