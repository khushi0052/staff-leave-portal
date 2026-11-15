
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

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
};

export default function MyLeaveRequests({
  userId,
  refreshKey,
}: MyLeaveRequestsProps) {
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

  function formatLeaveType(type: string): string {
    return type.charAt(0).toUpperCase() + type.slice(1);
  }

  if (loading) {
    return <p>Loading your leave requests...</p>;
  }

  if (error) {
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  }

  return (
    <section className="my-requests">
      <h3>My Leave Requests</h3>

      {requests.length === 0 ? (
        <p>You haven't submitted any leave requests yet.</p>
      ) : (
        <div className="requests-list">
          {requests.map((request) => (
            <article className="request-item" key={request.id}>
              <div>
                <h4>
                  {formatLeaveType(request.leave_type)} Leave
                </h4>

                <p>
                  {formatDate(request.start_date)}
                  {' — '}
                  {formatDate(request.end_date)}
                </p>

                <p>
                  {request.working_days} working
                  {request.working_days === 1 ? ' day' : ' days'}
                </p>

                {request.reason && (
                  <p>Reason: {request.reason}</p>
                )}

                {request.decision_comment && (
                  <p>
                    Decision comment: {request.decision_comment}
                  </p>
                )}
              </div>

              <span
                className={`request-status status-${request.status}`}
              >
                {request.status}
              </span>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
