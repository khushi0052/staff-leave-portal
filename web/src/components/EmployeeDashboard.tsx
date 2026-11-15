
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
  { id: 'overview', label: 'Dashboard', icon: '⌂' },
  { id: 'request', label: 'Request Leave', icon: '✚' },
  { id: 'requests', label: 'My Requests', icon: '▤' },
  { id: 'calendar', label: 'Team Calendar', icon: '▦' },
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

  const visiblePage: Page = activePage ?? defaultPage;

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
              <h1>{pageTitles[visiblePage]}</h1>
              <p>{pageDescriptions[visiblePage]}</p>
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

        {/* STAFF / MANAGER PERSONAL OVERVIEW */}

        {visiblePage === 'overview' && role !== 'hr' && (
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

        {visiblePage === 'request' && role !== 'hr' && (
          <section className="ld-panel">
            {requestForm}
          </section>
        )}

        {/* MY LEAVE REQUESTS */}

        {visiblePage === 'requests' && role !== 'hr' && (
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
