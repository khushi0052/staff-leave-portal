
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

type Role = 'staff' | 'manager' | 'hr';
type LeaveType = 'annual' | 'sick' | 'unpaid';
type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

type Profile = {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  department_id: string | null;
  annual_entitlement: number | null;
};

type LeaveRecord = {
  id: string;
  user_id: string;
  department_id: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  working_days: number;
  reason: string | null;
  status: LeaveStatus;
  decided_by: string | null;
  decision_comment: string | null;
  created_at: string;
  updated_at: string;
};

type Balance = {
  entitlement: number | null;
  used: number;
  reserved: number;
  remaining: number | null;
  available: number | null;
};

const RECORD_COLUMNS =
  'id,user_id,department_id,leave_type,start_date,end_date,working_days,reason,status,decided_by,decision_comment,created_at,updated_at' as const;

function displayDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// Escape spreadsheet cells and protect against
// formula injection when the CSV is opened in Excel.
function csvCell(value: unknown): string {
  let text = value === null || value === undefined
    ? ''
    : String(value);

  if (/^[\s]*[=+\-@]/.test(text)) {
    text = `'${text}`;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

export default function HRDashboard() {
  const [employees, setEmployees] = useState<Profile[]>([]);
  const [pendingManagerRequests, setPendingManagerRequests] =
    useState<LeaveRecord[]>([]);
  const [managerApprovedRecords, setManagerApprovedRecords] =
    useState<LeaveRecord[]>([]);

  const [year, setYear] = useState(new Date().getFullYear());
  const [balances, setBalances] =
    useState<Record<string, Balance>>({});
  const [balanceLoading, setBalanceLoading] =
    useState<string | null>(null);

  const [entitlements, setEntitlements] =
    useState<Record<string, string>>({});
  const [reviewComments, setReviewComments] =
    useState<Record<string, string>>({});

  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      // HR can see only profiles allowed by database RLS.
      const { data: profileData, error: profileError } =
        await supabase
          .from('profiles')
          .select(
            'id, full_name, email, role, department_id, annual_entitlement'
          )
          .order('full_name');

      if (profileError) throw profileError;

      const people = (profileData ?? []) as Profile[];
      setEmployees(people);

      setEntitlements(
        Object.fromEntries(
          people.map((person) => [
            person.id,
            person.annual_entitlement === null
              ? ''
              : String(person.annual_entitlement),
          ])
        )
      );

      const managerIds = people
        .filter((person) => person.role === 'manager')
        .map((person) => person.id);

      const staffIds = people
        .filter((person) => person.role === 'staff')
        .map((person) => person.id);

      // Pending requests made by managers.
      if (managerIds.length > 0) {
        const { data, error: requestError } =
          await supabase
            .from('leave_requests')
            .select(RECORD_COLUMNS)
            .eq('status', 'pending')
            .in('user_id', managerIds)
            .order('created_at', { ascending: false })
            .limit(100);

        if (requestError) throw requestError;

        setPendingManagerRequests(
          (data ?? []) as LeaveRecord[]
        );
      } else {
        setPendingManagerRequests([]);
      }

      // Staff requests already approved by managers.
      if (managerIds.length > 0 && staffIds.length > 0) {
        const { data, error: approvalError } =
          await supabase
            .from('leave_requests')
            .select(RECORD_COLUMNS)
            .eq('status', 'approved')
            .in('decided_by', managerIds)
            .in('user_id', staffIds)
            .order('updated_at', { ascending: false })
            .limit(100);

        if (approvalError) throw approvalError;

        setManagerApprovedRecords(
          (data ?? []) as LeaveRecord[]
        );
      } else {
        setManagerApprovedRecords([]);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to load HR dashboard.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function loadBalance(userId: string) {
    setBalanceLoading(userId);
    setError('');

    try {
      const { data, error: balanceError } =
        await supabase.rpc('leave_balance', {
          p_user: userId,
          p_year: year,
        });

      if (balanceError) throw balanceError;

      const balance = (data as Balance[] | null)?.[0];

      if (!balance) {
        throw new Error('No balance returned for this employee.');
      }

      setBalances((previous) => ({
        ...previous,
        [userId]: balance,
      }));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to load employee balance.'
      );
    } finally {
      setBalanceLoading(null);
    }
  }

  function updateYear(value: number) {
    if (!Number.isInteger(value)) return;
    if (value < 2000 || value > 2100) return;

    setYear(value);
    setBalances({});
  }

  async function updateEntitlement(person: Profile) {
    const raw = entitlements[person.id]?.trim() ?? '';
    const amount = Number(raw);

    if (
      raw === '' ||
      !Number.isSafeInteger(amount) ||
      amount < 0
    ) {
      setError('Enter a valid non-negative whole number.');
      return;
    }

    const comment = window.prompt(
      `Why are you changing ${person.full_name}'s entitlement?`
    );

    if (comment === null) return;

    if (!comment.trim()) {
      setError('A reason for the HR change is required.');
      return;
    }

    if (comment.length > 1000) {
      setError('The comment must be at most 1000 characters.');
      return;
    }

    setBusyId(person.id);
    setError('');
    setMessage('');

    try {
      const { error: updateError } =
        await supabase.rpc('set_annual_entitlement', {
          p_user: person.id,
          p_entitlement: amount,
          p_comment: comment.trim(),
        });

      if (updateError) throw updateError;

      setMessage(
        `Entitlement updated for ${person.full_name}.`
      );

      setBalances((previous) => {
        const updated = { ...previous };
        delete updated[person.id];
        return updated;
      });

      await loadData();
      await loadBalance(person.id);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to update entitlement.'
      );
    } finally {
      setBusyId(null);
    }
  }

  async function reviewManagerRequest(
    requestId: string,
    decision: 'approved' | 'rejected'
  ) {
    setBusyId(requestId);
    setError('');
    setMessage('');

    try {
      const { error: reviewError } =
        await supabase.rpc('review_leave', {
          p_id: requestId,
          p_decision: decision,
          p_comment: reviewComments[requestId]?.trim() || null,
        });

      if (reviewError) throw reviewError;

      setMessage(`Manager's request ${decision}.`);
      setBalances({});
      await loadData();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to review leave.'
      );
    } finally {
      setBusyId(null);
    }
  }

  function personName(userId: string | null): string {
    if (!userId) return 'Not assigned';

    return (
      employees.find((person) => person.id === userId)
        ?.full_name ?? userId
    );
  }

  // Export all leave records accessible to the HR session,
  // loading them in pages rather than limiting to 100 rows.
  async function exportRecords() {
    if (exporting) return;

    setExporting(true);
    setError('');
    setMessage('');

    try {
      const allRecords: LeaveRecord[] = [];
      const pageSize = 500;

      for (let offset = 0; ; offset += pageSize) {
        const { data, error: queryError } =
          await supabase
            .from('leave_requests')
            .select(RECORD_COLUMNS)
            .order('created_at', { ascending: true })
            .order('id', { ascending: true })
            .range(offset, offset + pageSize - 1);

        if (queryError) throw queryError;

        const page = (data ?? []) as LeaveRecord[];
        allRecords.push(...page);

        if (page.length < pageSize) break;
      }

      const headers = [
        'Request ID',
        'Employee',
        'Employee Email',
        'Employee Role',
        'Department ID',
        'Leave Type',
        'Start Date',
        'End Date',
        'Working Days',
        'Status',
        'Reason',
        'Decided By',
        'Decision Comment',
        'Created At',
        'Updated At',
      ];

      const rows = allRecords.map((record) => {
        const employee = employees.find(
          (person) => person.id === record.user_id
        );

        return [
          record.id,
          employee?.full_name ?? record.user_id,
          employee?.email ?? '',
          employee?.role ?? '',
          record.department_id,
          record.leave_type,
          record.start_date,
          record.end_date,
          record.working_days,
          record.status,
          record.reason,
          personName(record.decided_by),
          record.decision_comment,
          record.created_at,
          record.updated_at,
        ];
      });

      const csv = [
        headers.map(csvCell).join(','),
        ...rows.map((row) => row.map(csvCell).join(',')),
      ].join('\r\n');

      // UTF-8 BOM helps Excel open the file correctly.
      const blob = new Blob(['\uFEFF', csv], {
        type: 'text/csv;charset=utf-8;',
      });

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');

      link.href = url;
      link.download = `staff-leave-records-${new Date()
        .toISOString()
        .slice(0, 10)}.csv`;

      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      setMessage(
        `${allRecords.length} leave records exported.`
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to export leave records.'
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="hr-dashboard">
      <h2>HR Head Dashboard</h2>

      <p className="subtitle">
        Manage employee entitlements, approvals and records.
      </p>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {message && (
        <p className="success" role="status">
          {message}
        </p>
      )}

      {loading ? (
        <p>Loading HR information...</p>
      ) : (
        <>
          {/* EMPLOYEE DIRECTORY */}
          <section className="hr-section">
            <h3>Employee Directory</h3>

            <label htmlFor="balance-year">
              Balance year
            </label>

            <input
              id="balance-year"
              type="number"
              value={year}
              min={2000}
              max={2100}
              onChange={(event) =>
                updateYear(Number(event.target.value))
              }
            />

            <p className="field-hint">
              Click an employee's name to see details.
            </p>

            {employees.map((person) => {
              const balance = balances[person.id];

              return (
                <details
                  className="hr-employee"
                  key={person.id}
                  onToggle={(event) => {
                    if (event.currentTarget.open) {
                      void loadBalance(person.id);
                    }
                  }}
                >
                  <summary>{person.full_name}</summary>

                  <div className="hr-employee-details">
                    <p>Email: {person.email}</p>
                    <p>Role: {person.role}</p>

                    <p>
                      HR-assigned entitlement:{' '}
                      <strong>
                        {person.annual_entitlement === null
                          ? 'Not assigned'
                          : `${person.annual_entitlement} days`}
                      </strong>
                    </p>

                    <h4>Annual Leave Balance — {year}</h4>

                    {balanceLoading === person.id ? (
                      <p>Loading balance...</p>
                    ) : balance ? (
                      <div className="hr-balance-grid">
                        <p>
                          <strong>Approved:</strong>{' '}
                          {balance.used} days
                        </p>

                        <p>
                          <strong>Pending:</strong>{' '}
                          {balance.reserved} days
                        </p>

                        <p>
                          <strong>Remaining:</strong>{' '}
                          {balance.remaining ?? 'Not assigned'}
                        </p>

                        <p>
                          <strong>Available:</strong>{' '}
                          {balance.available ?? 'Not assigned'}
                        </p>
                      </div>
                    ) : (
                      <p>Balance not loaded.</p>
                    )}

                    <label htmlFor={`entitlement-${person.id}`}>
                      Update Annual entitlement (days)
                    </label>

                    <input
                      id={`entitlement-${person.id}`}
                      type="number"
                      min="0"
                      step="1"
                      value={entitlements[person.id] ?? ''}
                      disabled={busyId !== null}
                      onChange={(event) =>
                        setEntitlements((previous) => ({
                          ...previous,
                          [person.id]: event.target.value,
                        }))
                      }
                    />

                    <button
                      type="button"
                      disabled={
                        busyId !== null ||
                        (entitlements[person.id] ?? '') === ''
                      }
                      onClick={() =>
                        void updateEntitlement(person)
                      }
                    >
                      {busyId === person.id
                        ? 'Updating...'
                        : 'Save Entitlement'}
                    </button>
                  </div>
                </details>
              );
            })}
          </section>

          {/* MANAGER REQUESTS AWAITING HR */}
          <section className="hr-section">
            <details>
              <summary>
                Pending Manager Leave Requests
                ({pendingManagerRequests.length})
              </summary>

              {pendingManagerRequests.length === 0 ? (
                <p>No manager requests awaiting HR approval.</p>
              ) : (
                pendingManagerRequests.map((request) => (
                  <article
                    className="request-item"
                    key={request.id}
                  >
                    <h4>{personName(request.user_id)}</h4>

                    <p>
                      {request.leave_type.toUpperCase()} Leave
                    </p>

                    <p>
                      {displayDate(request.start_date)}
                      {' — '}
                      {displayDate(request.end_date)}
                    </p>

                    <p>{request.working_days} working days</p>

                    {request.reason && (
                      <p>Reason: {request.reason}</p>
                    )}

                    <label
                      htmlFor={`hr-comment-${request.id}`}
                    >
                      Decision comment
                    </label>

                    <textarea
                      id={`hr-comment-${request.id}`}
                      rows={2}
                      maxLength={1000}
                      value={reviewComments[request.id] ?? ''}
                      disabled={busyId !== null}
                      onChange={(event) =>
                        setReviewComments((previous) => ({
                          ...previous,
                          [request.id]: event.target.value,
                        }))
                      }
                    />

                    <div className="request-actions">
                      <button
                        type="button"
                        disabled={busyId !== null}
                        onClick={() =>
                          void reviewManagerRequest(
                            request.id,
                            'approved'
                          )
                        }
                      >
                        Approve
                      </button>

                      <button
                        type="button"
                        disabled={busyId !== null}
                        onClick={() =>
                          void reviewManagerRequest(
                            request.id,
                            'rejected'
                          )
                        }
                      >
                        Reject
                      </button>
                    </div>
                  </article>
                ))
              )}
            </details>
          </section>

          {/* MANAGER-APPROVED STAFF RECORDS */}
          <section className="hr-section">
            <details>
              <summary>
                Staff Leave Approved by Managers
                ({managerApprovedRecords.length})
              </summary>

              {managerApprovedRecords.length === 0 ? (
                <p>No manager-approved staff leave visible.</p>
              ) : (
                managerApprovedRecords.map((record) => (
                  <article
                    className="request-item"
                    key={record.id}
                  >
                    <h4>{personName(record.user_id)}</h4>

                    <p>Leave type: {record.leave_type}</p>

                    <p>
                      {displayDate(record.start_date)}
                      {' — '}
                      {displayDate(record.end_date)}
                    </p>

                    <p>
                      Working days: {record.working_days}
                    </p>

                    <p>
                      Approved by:{' '}
                      <strong>
                        {personName(record.decided_by)}
                      </strong>
                    </p>

                    {record.decision_comment && (
                      <p>
                        Decision comment:{' '}
                        {record.decision_comment}
                      </p>
                    )}

                    <span className="request-status status-approved">
                      Approved
                    </span>
                  </article>
                ))
              )}
            </details>
          </section>

          {/* SPREADSHEET EXPORT */}
          <section className="hr-section">
            <h3>Export Leave Records</h3>

            <p>
              Download all leave records accessible to HR,
              including employee names, dates, leave types,
              statuses and approval details.
            </p>

            <button
              type="button"
              disabled={exporting}
              onClick={() => void exportRecords()}
            >
              {exporting
                ? 'Preparing spreadsheet...'
                : 'Download Leave Records (CSV)'}
            </button>
          </section>
        </>
      )}
    </section>
  );
}
