
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

type StaffProfile = {
  id: string;
  full_name: string;
  email: string;
};

type TeamRequest = {
  id: string;
  user_id: string;
  leave_type: 'annual' | 'sick' | 'unpaid';
  start_date: string;
  end_date: string;
  working_days: number;
  reason: string | null;
  status: string;
};

type ManagerDashboardProps = {
  managerId: string;
  departmentId: string;
};

export default function ManagerDashboard({
  managerId,
  departmentId,
}: ManagerDashboardProps) {
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [requests, setRequests] = useState<TeamRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;

    async function loadTeamRequests() {
      setLoading(true);
      setError('');

      try {
        // Find staff members belonging to this department.
        const { data: staffData, error: staffError } =
          await supabase
            .from('profiles')
            .select('id, full_name, email')
            .eq('department_id', departmentId)
            .eq('role', 'staff')
            .neq('id', managerId);

        if (staffError) throw staffError;

        const employees = (staffData ?? []) as StaffProfile[];

        if (!active) return;

        setStaff(employees);

        if (employees.length === 0) {
          setRequests([]);
          return;
        }

        // Fetch pending leave requests for those staff.
        const { data: leaveData, error: leaveError } =
          await supabase
            .from('leave_requests')
            .select(
              'id, user_id, leave_type, start_date, end_date, working_days, reason, status'
            )
            .eq('department_id', departmentId)
            .eq('status', 'pending')
            .in(
              'user_id',
              employees.map((employee) => employee.id)
            )
            .order('start_date', { ascending: true })
            .limit(100);

        if (leaveError) throw leaveError;

        if (active) {
          setRequests((leaveData ?? []) as TeamRequest[]);
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : 'Unable to load team requests.'
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadTeamRequests();

    return () => {
      active = false;
    };
  }, [managerId, departmentId, refreshKey]);

  async function handleDecision(
    requestId: string,
    decision: 'approved' | 'rejected'
  ) {
    if (actionId !== null) return;

    setError('');
    setMessage('');
    setActionId(requestId);

    try {
      const { error: reviewError } = await supabase.rpc(
        'review_leave',
        {
          p_id: requestId,
          p_decision: decision,
          p_comment: comments[requestId]?.trim() || null,
        }
      );

      if (reviewError) throw reviewError;

      setMessage(
        `Leave request ${decision} successfully.`
      );

      setRefreshKey((value) => value + 1);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to review leave request.'
      );
    } finally {
      setActionId(null);
    }
  }

  function employeeName(userId: string) {
    return (
      staff.find((employee) => employee.id === userId)?.full_name
      ?? 'Employee'
    );
  }

  if (loading) {
    return <p>Loading team leave requests...</p>;
  }

  return (
    <section className="my-requests">
      <h2>Manager Approval Dashboard</h2>

      <p className="subtitle">
        Review Pending leave requests from your department.
      </p>

      {error && <p className="error" role="alert">{error}</p>}

      {message && (
        <p className="success" role="status">{message}</p>
      )}

      {requests.length === 0 ? (
        <p>No pending team leave requests.</p>
      ) : (
        <div className="requests-list">
          {requests.map((request) => (
            <article className="request-item" key={request.id}>
              <div className="request-item-header">
                <h4>{employeeName(request.user_id)}</h4>
                <span className="request-status status-pending">
                  Pending
                </span>
              </div>

              <p>
                <strong>Leave:</strong> {request.leave_type}
              </p>

              <p>
                <strong>Dates:</strong> {request.start_date}
                {' to '}
                {request.end_date}
              </p>

              <p>
                <strong>Working days:</strong> {request.working_days}
              </p>

              {request.reason && (
                <p><strong>Reason:</strong> {request.reason}</p>
              )}

              <label htmlFor={`comment-${request.id}`}>
                Decision comment (optional)
              </label>

              <textarea
                id={`comment-${request.id}`}
                rows={2}
                maxLength={1000}
                value={comments[request.id] ?? ''}
                disabled={actionId !== null}
                onChange={(event) =>
                  setComments((previous) => ({
                    ...previous,
                    [request.id]: event.target.value,
                  }))
                }
              />

              <div className="request-actions">
                <button
                  type="button"
                  disabled={actionId !== null}
                  onClick={() =>
                    void handleDecision(request.id, 'approved')
                  }
                >
                  {actionId === request.id
                    ? 'Processing...'
                    : 'Approve'}
                </button>

                <button
                  type="button"
                  disabled={actionId !== null}
                  onClick={() =>
                    void handleDecision(request.id, 'rejected')
                  }
                >
                  Reject
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
