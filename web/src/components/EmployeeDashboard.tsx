
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import LeaveRequestForm from './LeaveRequestForm';
import MyLeaveRequests from './MyLeaveRequests';
import ManagerDashboard from './ManagerDashboard';
import HRDashboard from './HRDashboard';

type EmployeeProfile = {
  id: string;
  full_name: string;
  role: string;
  department_id: string | null;
  annual_entitlement: number | null;
};

type AnnualLeaveRequest = {
  working_days: number;
  status: string;
};

type EmployeeDashboardProps = {
  userId: string;
  email: string;
};

type LeaveBalance = {
  entitlement: number | null;
  approved: number;
  pending: number;
  remaining: number | null;
  available: number | null;
};

export default function EmployeeDashboard({
  userId,
  email,
}: EmployeeDashboardProps) {
  const [profile, setProfile] =
    useState<EmployeeProfile | null>(null);

  const [balance, setBalance] =
    useState<LeaveBalance | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;

    async function loadDashboard() {
      setLoading(true);
      setError('');

      try {
        const currentYear = new Date().getFullYear();

        // Retrieve employee information.
        const { data: profileData, error: profileError } =
          await supabase
            .from('profiles')
            .select(
              'id, full_name, role, department_id, annual_entitlement'
            )
            .eq('id', userId)
            .single();

        if (profileError) {
          throw profileError;
        }

        // Retrieve annual leave for this calendar year.
        const { data: requestData, error: requestError } =
          await supabase
            .from('leave_requests')
            .select('working_days, status')
            .eq('user_id', userId)
            .eq('leave_type', 'annual')
            .gte('start_date', `${currentYear}-01-01`)
            .lte('end_date', `${currentYear}-12-31`)
            .in('status', ['approved', 'pending']);

        if (requestError) {
          throw requestError;
        }

        const annualRequests =
          (requestData ?? []) as AnnualLeaveRequest[];

        const approved = annualRequests
          .filter((request) => request.status === 'approved')
          .reduce(
            (total, request) => total + request.working_days,
            0
          );

        const pending = annualRequests
          .filter((request) => request.status === 'pending')
          .reduce(
            (total, request) => total + request.working_days,
            0
          );

        const entitlement = profileData.annual_entitlement;

        const remaining =
          entitlement === null
            ? null
            : entitlement - approved;

        const available =
          remaining === null
            ? null
            : remaining - pending;

        if (!active) return;

        setProfile(profileData);
        setBalance({
          entitlement,
          approved,
          pending,
          remaining,
          available,
        });
      } catch (err) {
        if (!active) return;

        setError(
          err instanceof Error
            ? err.message
            : 'Unable to load your leave dashboard'
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadDashboard();

    return () => {
      active = false;
    };
  }, [userId, refreshKey]);

  // Refresh the employee's balance after a successful submission.
  function refreshDashboard() {
    setRefreshKey((current) => current + 1);
  }

  if (loading) {
    return <p>Loading your employee dashboard...</p>;
  }

  if (error) {
    return (
      <p role="alert" className="error">
        Unable to load dashboard: {error}
      </p>
    );
  }

  if (!profile || !balance) {
    return <p>Employee information is unavailable.</p>;
  }

  const formatDays = (days: number | null) =>
    days === null ? 'Not assigned by HR' : `${days} days`;

  return (
    <section>
      <h2>Employee Dashboard</h2>

      <p>
        Welcome, <strong>{profile.full_name}</strong>
      </p>

      <p>Email: {email}</p>
      <p>Role: {profile.role}</p>

      <h3>Annual Leave Balance — {new Date().getFullYear()}</h3>

      <div className="welcome-box">
        <p>
          <strong>HR-assigned entitlement:</strong>
          {' '}{formatDays(balance.entitlement)}
        </p>

        <p>
          <strong>Approved Annual leave:</strong>
          {' '}{formatDays(balance.approved)}
        </p>

        <p>
          <strong>Pending Annual leave:</strong>
          {' '}{formatDays(balance.pending)}
        </p>

        <p>
          <strong>Remaining balance:</strong>
          {' '}{formatDays(balance.remaining)}
        </p>

        <p>
          <strong>Available to request:</strong>
          {' '}{formatDays(balance.available)}
        </p>
      </div>

      <LeaveRequestForm onSuccess={refreshDashboard} />

      <MyLeaveRequests
        userId={userId}
        refreshKey={refreshKey}
        onChanged={refreshDashboard}
      />

      {profile.role === 'manager' && profile.department_id && (
        <ManagerDashboard
          managerId={userId}
          departmentId={profile.department_id}
        />
      )}
{profile.role === 'hr' && <HRDashboard />}
    </section>
  );
}