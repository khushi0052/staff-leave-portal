
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import EditLeaveForm from './EditLeaveForm';

type LeaveRequest = {
  id: string;
  leave_type: 'annual' | 'sick' | 'unpaid';
  start_date: string;
  end_date: string;
  working_days: number;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reason: string | null;
  decision_comment: string | null;
  created_at: string;
};

type MyLeaveRequestsProps = {
  userId: string;
  refreshKey: number;
  onChanged: () => void;
};

export default function MyLeaveRequests({
  userId,
  refreshKey,
  onChanged,
}: MyLeaveRequestsProps) {
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionId, setActionId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadRequests() {
      setLoading(true);
      setError('');

      try {
        const { data, error: queryError } = await supabase
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

        if (active) {
          setRequests((data ?? []) as LeaveRequest[]);
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : 'Unable to load leave requests.'
          );
        }
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

      // Refresh the list and the Annual leave balance.
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

  function formatDate(date: string): string {
    return new Date(`${date}T00:00:00`).toLocaleDateString(
      'en-IN',
      {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }
    );
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

            return (
              <article className="request-item" key={request.id}>
                <div className="request-item-header">
                  <h4>
                    {request.leave_type.toUpperCase()} Leave
                  </h4>

                  <span
                    className={`request-status status-${request.status}`}
                  >
                    {request.status}
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

                {request.reason && (
                  <p>Reason: {request.reason}</p>
                )}

                {request.decision_comment && (
                  <p>
                    Decision comment: {request.decision_comment}
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
                      onClick={() => handleCancel(request)}
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
