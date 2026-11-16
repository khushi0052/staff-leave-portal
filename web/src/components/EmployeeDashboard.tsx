import { useEffect, useState } from 'react';
import './LeaveDeskDashboardLayout.css';

import { supabase } from '../lib/supabase';
import LeaveRequestForm from './LeaveRequestForm';
import MyLeaveRequests from './MyLeaveRequests';
import ManagerDashboard from './ManagerDashboard';
import HRDashboard from './HRDashboard';
import TeamCalendar from './TeamCalendar';
import StaffLeaveCalendar from './StaffLeaveCalendar';

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

type SnapshotRequest = {
  id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  working_days: number;
  status: string;
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
  {
    id: 'approvals',
    label: 'Department Dashboard',
    icon: '⌂',
  },
  {
    id: 'overview',
    label: 'My Leave',
    icon: '◷',
  },
  {
    id: 'calendar',
    label: 'Team Calendar',
    icon: '▦',
  },
];
const hrNavigation: NavigationItem[] = [
  { id: 'hr', label: 'HR Head Dashboard', icon: '⌂' },
  { id: 'hr-requests', label: 'Leave Requests & Reports', icon: '▤' },
  { id: 'hr-employees', label: 'Employees', icon: '♙' },
];

const pageTitles: Record<Page, string> = {
  overview: 'My Leave Dashboard',
  request: 'Request Leave',
  requests: 'My Leave Requests',
  calendar: 'Team Leave Calendar',
  approvals: 'Department Dashboard',
  hr: 'HR Head Dashboard',
  'hr-requests': 'Leave Requests & Reports',
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
  const [snapshotRequests, setSnapshotRequests] = useState<SnapshotRequest[]>([]);
  const [staffDialog, setStaffDialog] = useState<'apply' | 'requests' | null>(null);


  // Null means that the user has not selected a tab yet.
  // The starting tab is determined by their role.
  const [activePage, setActivePage] = useState<Page | null>(null);

  // Keep personal leave and team calendar current after changes in other sessions.
  useEffect(() => {
    const channel = supabase
      .channel(`employee-leave-refresh-${userId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'leave_requests',
      }, () => setRefreshKey((value) => value + 1))
      .subscribe();
    const onFocus = () => setRefreshKey((value) => value + 1);
    const onVisible = () => {
      if (document.visibilityState === 'visible') onFocus();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  const currentYear = new Date().getFullYear();
  const [selectedHRYear, setSelectedHRYear] = useState(currentYear);
  const [selectedStaffYear, setSelectedStaffYear] = useState(currentYear);

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
            .gte('start_date', `${selectedStaffYear}-01-01`)
            .lte('end_date', `${selectedStaffYear}-12-31`)
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
  }, [userId, selectedStaffYear, refreshKey]);

  // Count personal pending applications in the selected year.
  useEffect(() => {
    if (profile?.role !== 'staff' && profile?.role !== 'manager') return;
    let active = true;
    async function countPending() {
      const { count, error: countError } = await supabase.from('leave_requests')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'pending')
        .gte('start_date', `${selectedStaffYear}-01-01`)
        .lte('end_date', `${selectedStaffYear}-12-31`);
      if (active && !countError) setPendingRequestCount(count ?? 0);
    }
    void countPending();
    return () => { active = false; };
  }, [userId, profile?.role, selectedStaffYear, refreshKey]);

  useEffect(() => {
    let active = true;
    async function loadSnapshot() {
      const { data, error: snapshotError } = await supabase.from('leave_requests')
        .select('id, leave_type, start_date, end_date, working_days, status')
        .eq('user_id', userId)
        .gte('start_date', `${selectedStaffYear}-01-01`)
        .lte('start_date', `${selectedStaffYear}-12-31`)
        .order('created_at', { ascending: false })
        .limit(100);
      if (active && !snapshotError) setSnapshotRequests((data ?? []) as SnapshotRequest[]);
    }
    void loadSnapshot();
    return () => { active = false; };
  }, [userId, selectedStaffYear, refreshKey]);

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
      : role === 'manager' && (requestedPage === 'request' || requestedPage === 'requests')
        ? 'overview'
        : requestedPage;

  const todayISO = (() => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  })();
  const upcoming = [...snapshotRequests]
    .filter((r) => r.status === 'approved' && r.end_date >= todayISO)
    .sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
  const leaveLabel = (type: string) => `${type.charAt(0).toUpperCase()}${type.slice(1)} Leave`;
  const shortDate = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

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
      year={selectedStaffYear}
    />
  );

  const calendar = role === 'staff' ? (
    <StaffLeaveCalendar userId={userId} refreshKey={refreshKey} />
  ) : (
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
              onClick={() => { setActivePage(item.id); setRefreshKey((value) => value + 1); }}
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

      <main className={`ld-main${role === 'hr' ? ' ld-main-hr-compact' : ''}`}>
        {role === 'hr' && (
          <style>{`
            .ld-main-hr-compact { padding-top: 12px !important; }
            .ld-main-hr-compact .ld-page-header {
              margin-top: 0 !important;
              margin-bottom: 12px !important;
              padding-top: 0 !important;
              padding-bottom: 0 !important;
              gap: 12px;
              align-items: center;
            }
            .ld-main-hr-compact .ld-page-title { gap: 8px; }
            .ld-main-hr-compact .ld-page-title h1 { margin: 0; line-height: 1.25; }
            .ld-main-hr-compact .ld-page-title p { margin: 3px 0 0; }
            .ld-main-hr-compact .hr-summary-grid { margin-top: 0 !important; }
            .ld-main-hr-compact .ld-year-select {
              font: inherit;
              border: 1px solid #cbd5e1;
              background: #fff;
              color: #10234f;
              border-radius: 8px;
              padding: 7px 10px;
              min-width: 104px;
              width: 104px;
              box-sizing: border-box;
              cursor: pointer;
            }
            .ld-main-hr-compact .ld-year-select:focus-visible {
              outline: 2px solid #1d4ed8;
              outline-offset: 2px;
            }
            @media (max-width: 640px) {
              .ld-main-hr-compact { padding-top: 8px !important; }
              .ld-main-hr-compact .ld-page-header { gap: 8px; flex-wrap: wrap; }
              .ld-main-hr-compact .ld-page-title { min-width: 0; }
              .ld-main-hr-compact .ld-page-title h1 { font-size: 20px; }
              .ld-main-hr-compact .ld-year-select { min-width: 104px; }
            }
          `}</style>
        )}
        {!(role === 'manager' && visiblePage === 'approvals') && (
        <div className="ld-page-header">
          <div className="ld-page-title">
            <div>
              <h1>{role === 'staff' && visiblePage === 'calendar'
                ? 'My Leave Calendar' : pageTitles[visiblePage]}</h1>
              <p>{visiblePage === 'overview' && role !== 'hr'
                ? 'Apply for leave, view your balance, and track your request status.'
                : role === 'staff' && visiblePage === 'calendar'
                  ? 'View your own approved, pending, rejected and cancelled leave requests.'
                  : pageDescriptions[visiblePage]}</p>
            </div>
          </div>

          {role === 'hr' ? (
            <label className="ld-year-picker" htmlFor="hr-dashboard-year">
              <select
                id="hr-dashboard-year"
                className="ld-year-select"
                aria-label="Dashboard year"
                value={selectedHRYear}
                onChange={(event) => setSelectedHRYear(Number(event.target.value))}
              >
                {Array.from({ length: 11 }, (_, index) => currentYear + 1 - index).map(
                  (year) => <option value={year} key={year}>{year}</option>
                )}
              </select>
            </label>
          ) : visiblePage === 'overview' ? (
            <label className="ld-year-picker" htmlFor="staff-dashboard-year" style={{ display: 'flex', alignItems: 'center' }}>
              <select
                id="staff-dashboard-year"
                aria-label="Dashboard year"
                value={selectedStaffYear}
                onChange={(event) => setSelectedStaffYear(Number(event.target.value))}
                style={{ width: 100, minWidth: 100, padding: '7px 12px', borderRadius: 8, border: '1px solid #cbd5e1', backgroundColor: '#fff', color: '#10234f' }}
              >
                {Array.from({ length: 7 }, (_, i) => currentYear + 1 - i).map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
          ) : null}
        </div>
        )}

        {authError && (
          <p className="ld-alert error" role="alert">
            {authError}
          </p>
        )}

        {/* SHARED MY LEAVE: Staff and Manager use the same layout and personal data. */}
        {(role === 'staff' || role === 'manager') && visiblePage === 'overview' && (
          <div className="staff-my-leave">
            <style>{`
              .staff-my-leave { display: grid; gap: 10px; }
              .staff-my-leave * { box-sizing: border-box; }
              .staff-my-leave .sm-stats { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 10px; }
              .staff-my-leave .sm-columns { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.27fr); gap: 12px; align-items: start; }
              .staff-my-leave .sm-column { display: grid; gap: 12px; min-width: 0; }
              .staff-my-leave .sm-stats .ld-stat-card { min-height: 98px; height: 100%; }
              .staff-my-leave .sm-panel { border: 1px solid #dce4f3; background: #fff; border-radius: 12px; padding: 12px; min-width: 0; box-shadow: 0 3px 14px rgba(15,42,92,.06); }
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
              <StatCard label="Annual Entitlement" value={`${displayValue(balance.entitlement)} Days`} color="blue" icon="▦" />
              <StatCard label="Approved Leave" value={`${balance.approved} Days`} color="orange" icon="◷" />
              <StatCard label="Remaining Balance" value={`${displayValue(balance.remaining)} Days`} color="green" icon="✓" />
              <StatCard label="Pending Requests" value={String(pendingRequestCount)} color="purple" icon="♙" />
            </div>

            <div className="sm-at-a-glance">
              <section className="sm-panel sm-visual-balance">
                <h2>◈ Leave Balance Overview</h2>
                <div className="sm-balance-visual">
                  
<div
  className="sm-donut"
  style={{
    background:
      balance.entitlement !== null && balance.entitlement > 0
        ? (() => {
            const total = balance.entitlement;

            const approved = Math.min(
              total,
              Math.max(0, balance.approved)
            );

            const pending = Math.min(
              total - approved,
              Math.max(0, balance.pending)
            );

            const approvedPercent = (approved / total) * 100;
            const pendingEndPercent =
              ((approved + pending) / total) * 100;

            return `conic-gradient(
              #3b82f6 0% ${approvedPercent}%,
              #f59e0b ${approvedPercent}% ${pendingEndPercent}%,
              #22c55e ${pendingEndPercent}% 100%
            )`;
          })()
        : 'conic-gradient(#e2e8f0 0% 100%)',
  }}
>
  <div>
    <strong>{displayValue(balance.entitlement)}</strong>
    <span>Days Entitlement</span>
  </div>
</div>

                  <div className="sm-donut-legend">
                    <div><span><i className="sm-key available"/> Available</span><strong>{displayValue(balance.available)} Days</strong></div>
                    <div><span><i className="sm-key approved"/> Approved</span><strong>{balance.approved} Days</strong></div>
                    <div><span><i className="sm-key pending"/> Pending</span><strong>{balance.pending} Days</strong></div>
                    <div className="sm-caption">Remaining balance: {displayValue(balance.remaining)} days</div>
                  </div>
                </div>
              </section>
              <section className="sm-panel sm-recent-panel">
                <div className="sm-panel-head"><h2>▤ My Leave Requests (Recent)</h2><button type="button" onClick={() => setStaffDialog('requests')}>View All Requests ›</button></div>
                <table className="sm-mini-table">
                  <thead><tr><th>Leave Dates</th><th>Type</th><th>Duration</th><th>Status</th></tr></thead>
                  <tbody>{snapshotRequests.slice(0, 4).map((r) => (
                    <tr key={r.id}>
                      <td>{shortDate(r.start_date)} – {shortDate(r.end_date)}</td>
                      <td>{leaveLabel(r.leave_type)}</td>
                      <td>{r.working_days} Days</td>
                      <td><span className={`sm-mini-pill ${r.status}`}>{r.status.charAt(0).toUpperCase() + r.status.slice(1)}</span></td>
                    </tr>
                  ))}</tbody>
                </table>
                {snapshotRequests.length === 0 && <p className="sm-quiet">No leave requests for {selectedStaffYear}.</p>}
              </section>
              <section className="sm-panel sm-actions-panel">
                <h2>Quick Actions</h2>
                <button type="button" className="sm-primary-action" onClick={() => setStaffDialog('apply')}>▦ Apply for Leave <span>›</span></button>
                                <button type="button" onClick={() => setStaffDialog('requests')}>◈ My Leave History <span>›</span></button>
                <p>Annual · Sick · Unpaid</p>
              </section>
              <section className="sm-panel sm-upcoming-panel">
                <h2>▦ My Upcoming Leave</h2>
                {upcoming ? <div className="sm-upcoming-highlight">
                  <strong>{shortDate(upcoming.start_date)} – {shortDate(upcoming.end_date)} {upcoming.end_date.slice(0,4)}</strong>
                  <span>{leaveLabel(upcoming.leave_type)} · {upcoming.working_days} working days</span>
                </div> : <p className="sm-quiet">No upcoming approved leave.</p>}
                <p className="sm-quiet">Leave Policy: Annual, Sick and Unpaid. Unpaid leave requires a reason.</p>
              </section>
              <section className="sm-panel sm-calendar-panel">
                {role === 'staff' ? <StaffLeaveCalendar userId={userId} refreshKey={refreshKey} /> :
                  <div><h2>Team Calendar</h2><button type="button" className="sm-primary-action" onClick={() => setActivePage('calendar')}>View Team Calendar ›</button></div>}
              </section>
            </div>

            {staffDialog && <div className="sm-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setStaffDialog(null); }}>
              <section className="sm-modal" role="dialog" aria-modal="true" aria-label={staffDialog === 'apply' ? 'Apply for Leave' : 'My Leave Requests'}>
                <header className="sm-modal-head"><h2>{staffDialog === 'apply' ? 'Apply for Leave' : 'My Leave Requests'}</h2><button type="button" onClick={() => setStaffDialog(null)} aria-label="Close dialog">✕</button></header>
                {staffDialog === 'apply' ? requestForm : myRequests}
              </section>
            </div>}
          </div>
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
              <section className="ld-panel" style={{ padding: 0, border: 0, background: "transparent", boxShadow: "none" }}>
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
            key={selectedHRYear}
            year={selectedHRYear}
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
