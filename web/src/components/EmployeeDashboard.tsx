import { useEffect, useState } from 'react';

import { supabase } from '../lib/supabase';
import LeaveRequestForm from './LeaveRequestForm';
import MyLeaveRequests from './MyLeaveRequests';
import ManagerDashboard from './ManagerDashboard';
import HRDashboard from './HRDashboard';
import TeamCalendar from './TeamCalendar';

// --------------------------------------------
// TYPES
// --------------------------------------------

type Role = 'staff' | 'manager' | 'hr';

type HRPage =
  | 'hr'
  | 'hr-requests'
  | 'hr-employees'
  | 'hr-reports';

type Page =
  | 'overview'
  | 'request'
  | 'requests'
  | 'calendar'
  | 'approvals'
  | HRPage;

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

type LatestLeaveRequest = {
  id: string;
  leave_type: 'annual' | 'sick' | 'unpaid';
  start_date: string;
  end_date: string;
  working_days: number;
  status: 'approved' | 'pending' | 'rejected' | 'cancelled';
  decision_comment: string | null;
};

function formatLeaveDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function leaveTypeLabel(type: LatestLeaveRequest['leave_type']): string {
  if (type === 'annual') return 'Annual Leave';
  if (type === 'sick') return 'Sick Leave';
  return 'Unpaid Leave';
}


type LeaveBalance = {
  entitlement: number | null;
  approved: number;
  pending: number;
  remaining: number | null;
  available: number | null;
};

type Props = {
  userId: string;
  email: string;
  onLogout: () => void | Promise<void>;
  loggingOut?: boolean;
  authError?: string;
};

type NavigationItem = {
  id: Page;
  label: string;
  icon: string;
};

// --------------------------------------------
// NAVIGATION
// --------------------------------------------

const staffNavigation: NavigationItem[] = [
  {
    id: 'overview',
    label: 'My Leave',
    icon: '▦',
  },
  {
    id: 'calendar',
    label: 'My Leave Calendar',
    icon: '▦',
  },
];
const managerNavigation: NavigationItem[] = [
  { id: 'approvals', label: 'Department Dashboard', icon: '⌂' },
  { id: 'request', label: 'Request Leave', icon: '✚' },
  { id: 'requests', label: 'My Requests', icon: '▤' },
  { id: 'calendar', label: 'Team Calendar', icon: '▦' },
  { id: 'overview', label: 'My Leave', icon: '◷' },
];

const hrNavigation: NavigationItem[] = [
  { id: 'hr', label: 'HR Head Dashboard', icon: '⌂' },
  { id: 'hr-requests', label: 'Leave Requests', icon: '▤' },
  { id: 'hr-employees', label: 'Employees', icon: '♙' },
  { id: 'hr-reports', label: 'Reports', icon: '▥' },
];

const pageTitles: Record<Page, string> = {
  overview: 'My Leave Dashboard',
  request: 'Request Leave',
  requests: 'My Leave Requests',
  calendar: 'Team Leave Calendar',
  approvals: 'Department Dashboard',
  hr: 'HR Head Dashboard',
  'hr-requests': 'Leave Requests',
  'hr-employees': 'Employee Directory',
  'hr-reports': 'Reports',
};

const pageDescriptions: Record<Page, string> = {
  overview: 'View your leave balances and recent activity.',
  request: 'Submit a new leave request for approval.',
  requests: 'Track, edit, postpone or cancel your requests.',
  calendar: 'View approved team leave and your pending leave.',
  approvals: 'Review leave requests from your department.',
  hr: 'Overall leave status, department overview and employee management.',
  'hr-requests': 'Review department manager leave requests.',
  'hr-employees': 'View staff and manage annual leave entitlements.',
  'hr-reports': 'View leave records and export reports.',
};

function isRole(value: string): value is Role {
  return value === 'staff' || value === 'manager' || value === 'hr';
}

function isHRPage(value: Page): value is HRPage {
  return (
    value === 'hr' ||
    value === 'hr-requests' ||
    value === 'hr-employees' ||
    value === 'hr-reports'
  );
}

function getNavigation(role: Role): NavigationItem[] {
  if (role === 'hr') return hrNavigation;
  if (role === 'manager') return managerNavigation;
  return staffNavigation;
}

// --------------------------------------------
// REUSABLE LEAVE SUMMARY CARD
// --------------------------------------------

function StatCard({
  label,
  value,
  color,
  icon,
}: {
  label: string;
  value: string;
  color: 'blue' | 'green' | 'orange' | 'purple';
  icon: string;
}) {
  return (
    <article className={`ld-stat-card ${color}`}>
      <div className="ld-stat-icon" aria-hidden="true">
        {icon}
      </div>

      <div className="ld-stat-content">
        <strong className="ld-stat-value">
          {value}
        </strong>
        <span className="ld-stat-label">
          {label}
        </span>
      </div>
    </article>
  );
}

// --------------------------------------------
// MAIN EMPLOYEE DASHBOARD
// --------------------------------------------

export default function EmployeeDashboard({
  userId,
  email,
  onLogout,
  loggingOut = false,
  authError = '',
}: Props) {
  const [profile, setProfile] =
    useState<EmployeeProfile | null>(null);

  const [balance, setBalance] =
    useState<LeaveBalance | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [pendingRequestCount, setPendingRequestCount] = useState(0);
  const [latestRequest, setLatestRequest] =
    useState<LatestLeaveRequest | null>(null);
  const [departmentManagerName, setDepartmentManagerName] =
    useState('Department Manager');


  // Null means that the user has not selected a tab yet.
  // The starting tab is determined by their role.
  const [activePage, setActivePage] = useState<Page | null>(null);

  const currentYear = new Date().getFullYear();

  // ------------------------------------------
  // LOAD PROFILE AND ANNUAL LEAVE BALANCE
  // ------------------------------------------

  useEffect(() => {
    let active = true;

    async function loadDashboard() {
      setLoading(true);
      setError('');

      try {
        const { data: profileData, error: profileError } =
          await supabase
            .from('profiles')
            .select(
              'id, full_name, role, department_id, annual_entitlement'
            )
            .eq('id', userId)
            .single();

        if (profileError) throw profileError;

        const { data: requestData, error: requestError } =
          await supabase
            .from('leave_requests')
            .select('working_days, status')
            .eq('user_id', userId)
            .eq('leave_type', 'annual')
            .gte('start_date', `${currentYear}-01-01`)
            .lte('end_date', `${currentYear}-12-31`)
            .in('status', ['approved', 'pending']);

        if (requestError) throw requestError;

        const annualRequests =
          (requestData ?? []) as AnnualLeaveRequest[];

        const approved = annualRequests
          .filter((item) => item.status === 'approved')
          .reduce(
            (sum, item) => sum + item.working_days,
            0
          );

        const pending = annualRequests
          .filter((item) => item.status === 'pending')
          .reduce(
            (sum, item) => sum + item.working_days,
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
            : 'Unable to load your dashboard.'
        );
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadDashboard();

    return () => {
      active = false;
    };
  }, [userId, currentYear, refreshKey]);

  // Staff-only read queries. The logged-in user ID filters both queries.
  // Supabase RLS remains the security boundary.
  useEffect(() => {
    if (profile?.role !== 'staff') return;

    let active = true;

    async function loadStaffSummary() {
      const [countResult, latestResult] = await Promise.all([
        supabase
          .from('leave_requests')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('status', 'pending'),
        supabase
          .from('leave_requests')
          .select('id, leave_type, start_date, end_date, working_days, status, decision_comment')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(1),
      ]);

      if (!active) return;
      if (!countResult.error) setPendingRequestCount(countResult.count ?? 0);
      if (!latestResult.error) {
        setLatestRequest((latestResult.data?.[0] ?? null) as LatestLeaveRequest | null);
      }
    }

    void loadStaffSummary();
    return () => { active = false; };
  }, [userId, profile?.role, refreshKey]);

  useEffect(() => {
    if (profile?.role !== 'staff' || !profile.department_id) return;
    let active = true;

    async function loadDepartmentManager() {
      const { data, error: managerError } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('department_id', profile!.department_id!)
        .eq('role', 'manager')
        .limit(1);

      if (active && !managerError && data?.[0]?.full_name) {
        setDepartmentManagerName(data[0].full_name);
      }
    }

    void loadDepartmentManager();
    return () => { active = false; };
  }, [profile?.role, profile?.department_id]);

  function refreshDashboard() {
    setRefreshKey((value) => value + 1);
  }

  // ------------------------------------------
  // LOADING / ERROR STATES
  // ------------------------------------------

  if (loading) {
    return (
      <div className="leavedesk">
        <main className="ld-main">
          <p>Loading LeaveDesk...</p>
        </main>
      </div>
    );
  }

  if (error || !profile || !balance) {
    return (
      <div className="leavedesk">
        <main className="ld-main">
          <p className="ld-alert error" role="alert">
            {error || 'Employee information is unavailable.'}
          </p>
          <button
            type="button"
            className="ld-btn ld-btn-outline"
            onClick={() => void onLogout()}
          >
            Sign Out
          </button>
        </main>
      </div>
    );
  }

  if (!isRole(profile.role)) {
    return (
      <div className="leavedesk">
        <main className="ld-main">
          <p className="ld-alert error" role="alert">
            Your account has an unrecognized role.
            Please contact HR.
          </p>
          <button
            type="button"
            className="ld-btn ld-btn-outline"
            onClick={() => void onLogout()}
          >
            Sign Out
          </button>
        </main>
      </div>
    );
  }

  // ------------------------------------------
  // ROLE-AWARE PAGE SELECTION
  // ------------------------------------------

  const role: Role = profile.role;
  const navigation = getNavigation(role);

  // HR opens HR Head Dashboard.
  // Manager opens Department Dashboard.
  // Staff opens My Leave Dashboard.
  const defaultPage: Page =
    role === 'hr'
      ? 'hr'
      : role === 'manager'
        ? 'approvals'
        : 'overview';

  const requestedPage: Page = activePage ?? defaultPage;
  // Staff can only open My Leave or their personal calendar.
  // UI visibility is not authorization; Supabase RLS enforces data access.
  const visiblePage: Page =
    role === 'staff' && requestedPage !== 'calendar'
      ? 'overview'
      : requestedPage;

  const displayValue = (value: number | null) =>
    value === null ? '—' : String(value);

  // Existing working components.
  const requestForm = (
    <LeaveRequestForm onSuccess={refreshDashboard} />
  );

  const myRequests = (
    <MyLeaveRequests
      userId={userId}
      refreshKey={refreshKey}
      onChanged={refreshDashboard}
    />
  );

  const calendar = (
    <TeamCalendar
      userId={userId}
      role={role}
      departmentId={profile.department_id}
      refreshKey={refreshKey}
    />
  );

  return (
    <div className="leavedesk">
      {/* =====================================
          TOP NAVIGATION
          ===================================== */}

      <header className="ld-topbar">
        <div className="ld-brand">
          <span
            className="ld-brand-icon"
            aria-hidden="true"
          >
            ▦
          </span>

          <strong className="ld-brand-name">
            LeaveDesk
          </strong>
        </div>

        <span className="ld-brand-subtitle">
          Staff Leave Management Portal
        </span>

        <nav
          className="ld-navigation"
          aria-label="Main navigation"
        >
          {navigation.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`ld-nav-link ${
                visiblePage === item.id ? 'active' : ''
              }`}
              aria-current={
                visiblePage === item.id
                  ? 'page'
                  : undefined
              }
              onClick={() => setActivePage(item.id)}
            >
              <span
                className="ld-nav-icon"
                aria-hidden="true"
              >
                {item.icon}
              </span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="ld-topbar-right">
          <div className="ld-account">
            <span className="ld-avatar">
              {profile.full_name.charAt(0).toUpperCase()}
            </span>

            <div className="ld-account-info">
              <strong>{profile.full_name}</strong>
              <span>
                {role === 'hr'
                  ? 'HR Head'
                  : role === 'manager'
                    ? 'Department Manager'
                    : 'Staff'}
              </span>
            </div>
          </div>

          <button
            type="button"
            className="ld-logout"
            onClick={() => void onLogout()}
            disabled={loggingOut}
          >
            {loggingOut ? 'Signing out...' : 'Sign Out'}
          </button>
        </div>
      </header>

      {/* =====================================
          PAGE CONTENT
          ===================================== */}

      <main className="ld-main">
        <div className="ld-page-header">
          <div className="ld-page-title">
            <span
              className="ld-page-avatar"
              aria-hidden="true"
            >
              {profile.full_name.charAt(0).toUpperCase()}
            </span>

            <div>
              <h1>{role === 'staff' && visiblePage === 'calendar'
                ? 'My Leave Calendar' : pageTitles[visiblePage]}</h1>
              <p>{role === 'staff'
                ? visiblePage === 'calendar'
                  ? 'View your own approved, pending, rejected and cancelled leave requests.'
                  : 'Apply for leave, view your balance, and track your request status.'
                : pageDescriptions[visiblePage]}</p>
            </div>
          </div>

          <span className="ld-year-picker">
            {currentYear}
          </span>
        </div>

        {authError && (
          <p className="ld-alert error" role="alert">
            {authError}
          </p>
        )}

        {/* STAFF MY LEAVE: all sections are visible on one page. */}
        {role === 'staff' && visiblePage === 'overview' && (
          <div className="staff-my-leave">
            <style>{`
              .staff-my-leave { display: grid; gap: 14px; }
              .staff-my-leave * { box-sizing: border-box; }
              .staff-my-leave .sm-stats { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 10px; }
              .staff-my-leave .sm-columns { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.27fr); gap: 12px; align-items: start; }
              .staff-my-leave .sm-column { display: grid; gap: 12px; min-width: 0; }
              .staff-my-leave .sm-panel { border: 1px solid #dce4f3; background: #fff; border-radius: 12px; padding: 14px; min-width: 0; box-shadow: 0 3px 14px rgba(15,42,92,.06); }
              .staff-my-leave .sm-panel h2 { margin: 0; font-size: 16px; font-weight: 800; color: #10234f; }
              .staff-my-leave .sm-subtitle { color: #64748b; font-size: 11px; margin: 3px 0 11px; }
              .staff-my-leave .sm-balance { display: grid; grid-template-columns: repeat(5, minmax(0,1fr)); gap: 4px; }
              .staff-my-leave .sm-balance-item { min-width: 0; padding: 10px 4px; text-align: center; border-radius: 8px; background: #f0f5ff; }
              .staff-my-leave .sm-balance-item.approved { background: #ecfdf3; }
              .staff-my-leave .sm-balance-item.pending { background: #fff5e7; }
              .staff-my-leave .sm-balance-item span { min-height: 28px; display: block; color: #10234f; font-size: 10px; line-height: 1.35; font-weight: 600; }
              .staff-my-leave .sm-balance-item strong { display: block; color: #10234f; margin-top: 7px; font-size: 15px; }
              .staff-my-leave .sm-balance-item.approved strong { color: #15803d; }
              .staff-my-leave .sm-balance-item.pending strong { color: #b45309; }
              .staff-my-leave .sm-detail-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0,.88fr); gap: 10px; }
              .staff-my-leave .sm-detail-table { display: grid; gap: 0; border: 1px solid #e4eaf5; border-radius: 8px; overflow: hidden; }
              .staff-my-leave .sm-detail-row { display: grid; grid-template-columns: 43% 57%; min-height: 39px; border-bottom: 1px solid #e4eaf5; font-size: 11px; }
              .staff-my-leave .sm-detail-row:last-child { border-bottom: 0; }
              .staff-my-leave .sm-detail-row strong { background: #f1f5fa; padding: 10px; color: #10234f; }
              .staff-my-leave .sm-detail-row span { padding: 10px; overflow-wrap: anywhere; }
              .staff-my-leave .sm-policy { background: #eaf3ff; border-radius: 10px; padding: 12px; }
              .staff-my-leave .sm-policy h3 { margin: 0 0 7px; color: #10234f; font-size: 13px; }
              .staff-my-leave .sm-policy ul { margin: 0; padding-left: 18px; font-size: 11px; line-height: 1.55; }
              .staff-my-leave .sm-policy li + li { margin-top: 7px; }
              .staff-my-leave .sm-status { display: inline-block; width: fit-content; padding: 4px 8px !important; border-radius: 7px; font-weight: 700; }
              .staff-my-leave .sm-status.approved { background: #dcfce7; color: #15803d; }
              .staff-my-leave .sm-status.pending { background: #fef3c7; color: #b45309; }
              .staff-my-leave .sm-status.rejected { background: #fee2e2; color: #b91c1c; }
              .staff-my-leave .sm-status.cancelled { background: #f3f4f6; color: #4b5563; }
              .staff-my-leave .leave-range-form { max-width: 100%; }
              @media (max-width: 1100px) { .staff-my-leave .sm-stats { grid-template-columns: repeat(2,minmax(0,1fr)); } .staff-my-leave .sm-columns { grid-template-columns: 1fr; } }
              @media (max-width: 620px) { .staff-my-leave .sm-stats { grid-template-columns: 1fr; } .staff-my-leave .sm-balance { grid-template-columns: repeat(2,minmax(0,1fr)); } .staff-my-leave .sm-detail-layout { grid-template-columns: 1fr; } .staff-my-leave .sm-panel { padding: 11px; } }
            `}</style>

            <div className="sm-stats">
              <StatCard label="Entitlement" value={`${displayValue(balance.entitlement)} Days`} color="blue" icon="▦" />
              <StatCard label="Used" value={`${balance.approved} Days`} color="orange" icon="◷" />
              <StatCard label="Remaining" value={`${displayValue(balance.remaining)} Days`} color="green" icon="✓" />
              <StatCard label="Pending Request" value={String(pendingRequestCount)} color="purple" icon="♙" />
            </div>

            <div className="sm-columns">
              <div className="sm-column">
                <section className="sm-panel">
                  <h2>▦ Annual Leave Balance — {currentYear}</h2>
                  <p className="sm-subtitle">Your annual leave summary for the selected year.</p>
                  <div className="sm-balance">
                    <div className="sm-balance-item"><span>Entitlement</span><strong>{displayValue(balance.entitlement)} Days</strong></div>
                    <div className="sm-balance-item approved"><span>Approved Annual Leave</span><strong>{balance.approved} Days</strong></div>
                    <div className="sm-balance-item pending"><span>Pending Annual Leave</span><strong>{balance.pending} Days</strong></div>
                    <div className="sm-balance-item"><span>Remaining Balance</span><strong>{displayValue(balance.remaining)} Days</strong></div>
                    <div className="sm-balance-item"><span>Available to Request</span><strong>{displayValue(balance.available)} Days</strong></div>
                  </div>
                </section>
                <section className="sm-panel" aria-label="Request Leave">
                  {requestForm}
                </section>
              </div>

              <div className="sm-column">
                <section className="sm-panel" aria-label="My Leave Requests">
                  {myRequests}
                </section>
                <section className="sm-panel">
                  <h2>ⓘ Latest Request Status</h2>
                  <p className="sm-subtitle">Details of your most recent leave request.</p>
                  <div className="sm-detail-layout">
                    <div className="sm-detail-table">
                      <div className="sm-detail-row"><strong>Leave Type</strong><span>{latestRequest ? leaveTypeLabel(latestRequest.leave_type) : 'No Request'}</span></div>
                      <div className="sm-detail-row"><strong>Dates</strong><span>{latestRequest ? `${formatLeaveDate(latestRequest.start_date)} – ${formatLeaveDate(latestRequest.end_date)} (${latestRequest.working_days} Days)` : '—'}</span></div>
                      <div className="sm-detail-row"><strong>Status</strong><span>{latestRequest ? <span className={`sm-status ${latestRequest.status}`}>{latestRequest.status.charAt(0).toUpperCase() + latestRequest.status.slice(1)}</span> : 'No Request'}</span></div>
                      <div className="sm-detail-row"><strong>Approver</strong><span>{departmentManagerName}</span></div>
                      <div className="sm-detail-row"><strong>Manager Comment</strong><span><i>{latestRequest?.decision_comment || (latestRequest?.status === 'pending' ? 'Awaiting review.' : '—')}</i></span></div>
                    </div>
                    <aside className="sm-policy">
                      <h3>▤ Leave Policy Reminders</h3>
                      <ul>
                        <li>Annual leave uses your assigned balance for the year ({displayValue(balance.entitlement)} Days in {currentYear}).</li>
                        <li>Unpaid leave requires a clear reason and is subject to approval.</li>
                        <li>Sick leave should be used for health-related absences.</li>
                      </ul>
                    </aside>
                  </div>
                </section>
              </div>
            </div>
          </div>
        )}

        {/* MANAGER PERSONAL OVERVIEW: unchanged */}

        {visiblePage === 'overview' && role === 'manager' && (
          <>
            <div className="ld-stats-grid three">
              <StatCard
                label="Assigned Annual Leave"
                value={displayValue(balance.entitlement)}
                color="blue"
                icon="▦"
              />

              <StatCard
                label="Approved Annual Leave"
                value={String(balance.approved)}
                color="green"
                icon="✓"
              />

              <StatCard
                label="Pending Annual Leave"
                value={String(balance.pending)}
                color="orange"
                icon="◷"
              />
            </div>

            <div className="ld-content-grid">
              <section className="ld-panel ld-col-6">
                <div className="ld-panel-header">
                  <div className="ld-panel-title">
                    <span className="ld-panel-icon">
                      ▦
                    </span>
                    <div>
                      <h2>Annual Leave Balance</h2>
                      <p>
                        Your leave summary for {currentYear}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="ld-balance-grid three">
                  <div className="ld-balance-tile">
                    <span>Assigned</span>
                    <strong>
                      {displayValue(balance.entitlement)}
                    </strong>
                  </div>

                  <div className="ld-balance-tile green">
                    <span>Approved</span>
                    <strong>{balance.approved}</strong>
                  </div>

                  <div className="ld-balance-tile orange">
                    <span>Pending</span>
                    <strong>{balance.pending}</strong>
                  </div>
                </div>

                <p className="ld-muted">
                  Remaining: {displayValue(balance.remaining)}
                  {' · '}
                  Available to request:{' '}
                  {displayValue(balance.available)} days
                </p>
              </section>

              <section className="ld-panel ld-col-6">
                <div className="ld-panel-header">
                  <div className="ld-panel-title">
                    <span className="ld-panel-icon">
                      ✦
                    </span>
                    <div>
                      <h2>Quick Actions</h2>
                      <p>Manage your leave.</p>
                    </div>
                  </div>
                </div>

                <div className="ld-quick-actions">
                  <button
                    type="button"
                    className="ld-btn ld-btn-primary"
                    onClick={() => setActivePage('request')}
                  >
                    Request Leave
                  </button>

                  <button
                    type="button"
                    className="ld-btn ld-btn-outline"
                    onClick={() => setActivePage('requests')}
                  >
                    View My Requests
                  </button>

                  <button
                    type="button"
                    className="ld-btn ld-btn-outline"
                    onClick={() => setActivePage('calendar')}
                  >
                    Open Team Calendar
                  </button>
                </div>
              </section>
            </div>
          </>
        )}

        {/* LEAVE REQUEST FORM */}

        {visiblePage === 'request' && role === 'manager' && (
          <section className="ld-panel">
            {requestForm}
          </section>
        )}

        {/* MY LEAVE REQUESTS */}

        {visiblePage === 'requests' && role === 'manager' && (
          <section className="ld-panel">
            {myRequests}
          </section>
        )}

        {/* TEAM CALENDAR */}

        {visiblePage === 'calendar' && role !== 'hr' && (
          <section className="ld-panel">
            {calendar}
          </section>
        )}

        {/* MANAGER-ONLY APPROVAL DASHBOARD */}

        {visiblePage === 'approvals' &&
          role === 'manager' &&
          (
            profile.department_id ? (
              <section className="ld-panel">
                <ManagerDashboard
                  managerId={userId}
                  departmentId={profile.department_id}
                />
              </section>
            ) : (
              <p className="ld-alert error" role="alert">
                No department is assigned to this manager.
              </p>
            )
          )}

        {/* HR-ONLY PAGES
            This frontend role check controls visibility.
            Supabase RLS remains the security boundary.
        */}

        {role === 'hr' && isHRPage(visiblePage) && (
          <HRDashboard
            view={visiblePage}
            onNavigate={(page) => setActivePage(page)}
          />
        )}

        <footer
          style={{
            marginTop: 22,
            color: '#94a3b8',
            fontSize: 11,
            textAlign: 'center',
          }}
        >
          LeaveDesk · Staff Leave Management Portal
          {' · '}
          {email}
        </footer>
      </main>
    </div>
  );
}
