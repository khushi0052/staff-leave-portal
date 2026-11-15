
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import EditLeaveForm from './EditLeaveForm';

type LeaveType = 'annual' | 'sick' | 'unpaid';

type LeaveStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'cancelled';

type LeaveRequest = {
  id: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  working_days: number;
  status: LeaveStatus;
  reason: string | null;
  decision_comment: string | null;
  created_at: string;
};

type MyLeaveRequestsProps = {
  userId: string;
  refreshKey: number;
  onChanged: () => void;
};

// Convert a database date into a local Date object.
function parseDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

// Convert a Date object into YYYY-MM-DD.
function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function formatDate(value: string): string {
  return parseDate(value).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// Display Annual Leave, Sick Leave or Unpaid Leave.
function leaveTypeLabel(type: LeaveType): string {
  if (type === 'annual') return 'Annual Leave';
  if (type === 'sick') return 'Sick Leave';
  return 'Unpaid Leave';
}

// Calculate the first working day after the leave ends.
// Saturdays, Sundays and public holidays are skipped.
function calculateReportingDate(
  endDate: string,
  publicHolidays: Set<string>
): string | null {
  const date = parseDate(endDate);

  date.setDate(date.getDate() + 1);

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const dayOfWeek = date.getDay();
    const key = dateKey(date);

    const isWeekend =
      dayOfWeek === 0 || dayOfWeek === 6;

    const isHoliday = publicHolidays.has(key);

    if (!isWeekend && !isHoliday) {
      return key;
    }

    date.setDate(date.getDate() + 1);
  }

  return null;
}

export default function MyLeaveRequests({
  userId,
  refreshKey,
  onChanged,
}: MyLeaveRequestsProps) {
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [holidays, setHolidays] = useState<Set<string>>(
    new Set()
  );

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionId, setActionId] = useState<string | null>(
    null
  );
  const [editingId, setEditingId] = useState<string | null>(
    null
  );

  useEffect(() => {
    let active = true;

    async function loadRequests() {
      setLoading(true);
      setError('');

      try {
        // Load only the signed-in employee's requests.
        // Supabase RLS remains the security boundary.
        const {
          data,
          error: queryError,
        } = await supabase
          .from('leave_requests')
          .select(
            'id, leave_type, start_date, end_date, working_days, status, reason, decision_comment, created_at'
          )
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(100);

        if (queryError) {
          throw queryError;
        }

        const employeeRequests =
          (data ?? []) as LeaveRequest[];

        // Load public holidays covering all reporting dates.
        let holidayDates = new Set<string>();

        if (employeeRequests.length > 0) {
          const endDates = employeeRequests.map(
            (request) => request.end_date
          );

          const earliestEndDate = endDates.reduce(
            (earliest, current) =>
              current < earliest ? current : earliest
          );

          const latestEndDate = endDates.reduce(
            (latest, current) =>
              current > latest ? current : latest
          );

          const rangeEnd = parseDate(latestEndDate);
          rangeEnd.setDate(rangeEnd.getDate() + 60);

          const {
            data: holidayData,
            error: holidayError,
          } = await supabase
            .from('public_holidays')
            .select('date')
            .gte('date', earliestEndDate)
            .lte('date', dateKey(rangeEnd));

          if (holidayError) {
            throw holidayError;
          }

          holidayDates = new Set(
            (holidayData ?? []).map(
              (holiday) => holiday.date as string
            )
          );
        }

        if (!active) return;

        setRequests(employeeRequests);
        setHolidays(holidayDates);
      } catch (err) {
        if (!active) return;

        setRequests([]);

        setError(
          err instanceof Error
            ? err.message
            : 'Unable to load leave requests.'
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadRequests();

    return () => {
      active = false;
    };
  }, [userId, refreshKey]);

  // Keep the existing cancellation rules and RPC.
  async function handleCancel(request: LeaveRequest) {
    if (
      request.status !== 'pending' &&
      request.status !== 'approved'
    ) {
      return;
    }

    const confirmed = window.confirm(
      `Cancel your ${request.status} ${request.leave_type} leave request?`
    );

    if (!confirmed) return;

    setError('');
    setActionId(request.id);

    try {
      const { error: cancelError } = await supabase.rpc(
        'cancel_leave',
        {
          p_id: request.id,
          p_comment: 'Cancelled by employee',
        }
      );

      if (cancelError) {
        throw cancelError;
      }

      // Refresh request list and annual leave balance.
      onChanged();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to cancel leave request.'
      );
    } finally {
      setActionId(null);
    }
  }

  function handleEditSuccess() {
    setEditingId(null);
    onChanged();
  }

  if (loading) {
    return <p>Loading your leave requests...</p>;
  }

  return (
    <section className="my-requests">
      <h3>My Leave Requests</h3>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {requests.length === 0 ? (
        <p>You haven't submitted any leave requests yet.</p>
      ) : (
        <div className="requests-list">
          {requests.map((request) => {
            const editable =
              request.status === 'pending' ||
              request.status === 'approved';

            const isEditing = editingId === request.id;

            const reportingDate = calculateReportingDate(
              request.end_date,
              holidays
            );

            return (
              <article
                className="request-item"
                key={request.id}
              >
                <div className="request-item-header">
                  <h4>
                    {leaveTypeLabel(request.leave_type)}
                  </h4>

                  <span
                    className={
                      `request-status status-${request.status}`
                    }
                  >
                    {request.status.charAt(0).toUpperCase() +
                      request.status.slice(1)}
                  </span>
                </div>

                <p>
                  {formatDate(request.start_date)}
                  {' — '}
                  {formatDate(request.end_date)}
                </p>

                <p>
                  {request.working_days} working day(s)
                </p>

                {/* NEW: AUTOMATIC REPORTING DATE */}

                <p
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    color: '#15803d',
                    fontSize: 13,
                    marginTop: 8,
                    marginBottom: 8,
                  }}
                >
                  <span aria-hidden="true">▣</span>

                  <strong>Reporting Date:</strong>

                  <span>
                    {reportingDate
                      ? formatDate(reportingDate)
                      : 'Unavailable'}
                  </span>
                </p>

                {request.reason && (
                  <p>
                    Reason: {request.reason}
                  </p>
                )}

                {request.decision_comment && (
                  <p>
                    Decision comment:{' '}
                    {request.decision_comment}
                  </p>
                )}

                {editable && (
                  <div className="request-actions">
                    <button
                      type="button"
                      disabled={actionId !== null}
                      onClick={() =>
                        setEditingId(
                          isEditing ? null : request.id
                        )
                      }
                    >
                      {isEditing
                        ? 'Close Edit Form'
                        : 'Edit / Postpone'}
                    </button>

                    <button
                      type="button"
                      disabled={actionId !== null}
                      onClick={() =>
                        void handleCancel(request)
                      }
                    >
                      {actionId === request.id
                        ? 'Cancelling...'
                        : 'Cancel Request'}
                    </button>
                  </div>
                )}

                {editable && isEditing && (
                  <EditLeaveForm
                    key={request.id}
                    request={{
                      id: request.id,
                      leave_type: request.leave_type,
                      start_date: request.start_date,
                      end_date: request.end_date,
                      reason: request.reason,
                      status: request.status as 'pending' | 'approved',
                    }}
                    onSuccess={handleEditSuccess}
                    onClose={() => setEditingId(null)}
                  />
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
