import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';

type LeaveType = 'annual' | 'sick' | 'unpaid';
type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

type StaffProfile = {
  id: string;
  full_name: string;
  email: string;
  annual_entitlement: number | null;
};

type TeamRequest = {
  id: string;
  user_id: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  working_days: number;
  reason: string | null;
  status: LeaveStatus;
  decision_comment: string | null;
  created_at: string;
};

type Balance = {
  entitlement: number | null;
  used: number;
  reserved: number;
  remaining: number | null;
  available: number | null;
};

type ManagerDashboardProps = {
  managerId: string;
  departmentId: string;
};

function localDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function readableDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function readableType(value: LeaveType): string {
  return `${value[0].toUpperCase()}${value.slice(1)} Leave`;
}

function parseBalance(value: unknown): Balance | null {
  const record = Array.isArray(value) ? value[0] : value;
  if (!record || typeof record !== 'object') return null;
  const row = record as Record<string, unknown>;
  const optionalNumber = (x: unknown): number | null =>
    x === null || x === undefined ? null : Number(x);

  return {
    entitlement: optionalNumber(row.entitlement),
    used: Number(row.used ?? 0),
    reserved: Number(row.reserved ?? 0),
    remaining: optionalNumber(row.remaining),
    available: optionalNumber(row.available),
  };
}

function StatusPill({ status }: { status: LeaveStatus | 'none' }) {
  return (
    <span className={`md-status md-status-${status}`}>
      {status === 'none'
        ? 'No Request'
        : status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export default function ManagerDashboard({
  managerId,
  departmentId,
}: ManagerDashboardProps) {
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [requests, setRequests] = useState<TeamRequest[]>([]);
  const [departmentName, setDepartmentName] = useState('Department');
  const [balances, setBalances] = useState<Record<string, Balance>>({});
  const [managerBalance, setManagerBalance] = useState<Balance | null>(null);
  const [selectedDate, setSelectedDate] = useState(localDate(new Date()));
  const [comments, setComments] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [authorized, setAuthorized] = useState(false);

  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const today = localDate(new Date());

  const loadDashboard = useCallback(async (alive: () => boolean) => {
    setLoading(true);
    setError('');
    setAuthorized(false);

    try {
      // Frontend guard: verify the signed-in manager and department.
      // Supabase RLS remains the actual data-access security boundary.
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!auth.user || auth.user.id !== managerId) {
        throw new Error('Please sign in as the department manager.');
      }

      const { data: ownProfile, error: ownError } = await supabase
        .from('profiles')
        .select('id, role, department_id')
        .eq('id', managerId)
        .single();
      if (ownError) throw ownError;
      if (ownProfile.role !== 'manager' || ownProfile.department_id !== departmentId) {
        throw new Error('Manager access is required for this department.');
      }
      if (!alive()) return;
      setAuthorized(true);

      const [peopleResult, departmentResult] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, email, annual_entitlement')
          .eq('department_id', departmentId)
          .eq('role', 'staff')
          .order('full_name'),
        supabase.from('departments').select('name').eq('id', departmentId).single(),
      ]);
      if (peopleResult.error) throw peopleResult.error;
      if (departmentResult.error) throw departmentResult.error;

      const employees = (peopleResult.data ?? []) as StaffProfile[];
      const staffIds = new Set(employees.map((person) => person.id));
      const allRequests: TeamRequest[] = [];
      const pageSize = 500;

      // Load every status so that on-leave-today and date conflicts are accurate.
      for (let offset = 0; ; offset += pageSize) {
        const { data, error: leaveError } = await supabase
          .from('leave_requests')
          .select(
            'id, user_id, leave_type, start_date, end_date, working_days, reason, status, decision_comment, created_at'
          )
          .eq('department_id', departmentId)
          .order('id', { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (leaveError) throw leaveError;
        const page = (data ?? []) as TeamRequest[];
        allRequests.push(...page);
        if (page.length < pageSize) break;
      }

      const balanceResults = await Promise.all(
        employees.map(async (person) => {
          const { data, error: balanceError } = await supabase.rpc('leave_balance', {
            p_user: person.id,
            p_year: year,
          });
          if (balanceError) return [person.id, null] as const;
          return [person.id, parseBalance(data)] as const;
        })
      );
      const balanceByPerson: Record<string, Balance> = {};
      for (const [id, value] of balanceResults) {
        if (value) balanceByPerson[id] = value;
      }

      const { data: ownBalanceData, error: ownBalanceError } = await supabase.rpc(
        'leave_balance',
        { p_user: managerId, p_year: year }
      );
      if (ownBalanceError) throw ownBalanceError;

      if (!alive()) return;
      setStaff(employees);
      setDepartmentName(departmentResult.data.name);
      setRequests(allRequests.filter((request) => staffIds.has(request.user_id)));
      setBalances(balanceByPerson);
      setManagerBalance(parseBalance(ownBalanceData));
    } catch (err) {
      if (alive()) {
        setError(err instanceof Error ? err.message : 'Unable to load department dashboard.');
      }
    } finally {
      if (alive()) setLoading(false);
    }
  }, [departmentId, managerId, year]);

  useEffect(() => {
    let active = true;
    void loadDashboard(() => active);
    return () => { active = false; };
  }, [loadDashboard, refreshKey]);

  const staffById = useMemo(
    () => new Map(staff.map((person) => [person.id, person])),
    [staff]
  );

  const pendingRequests = useMemo(
    () => requests
      .filter((request) => request.status === 'pending')
      .sort((a, b) => a.start_date.localeCompare(b.start_date)),
    [requests]
  );

  const todayLeaves = useMemo(
    () => requests.filter(
      (request) => request.status === 'approved' &&
        request.start_date <= today && request.end_date >= today
    ),
    [requests, today]
  );

  const selectedDayLeaves = useMemo(
    () => requests.filter(
      (request) => request.status === 'approved' &&
        request.start_date <= selectedDate && request.end_date >= selectedDate
    ),
    [requests, selectedDate]
  );

  const latestByPerson = useMemo(() => {
    const latest = new Map<string, TeamRequest>();
    for (const request of requests) {
      const previous = latest.get(request.user_id);
      if (!previous || request.created_at > previous.created_at) {
        latest.set(request.user_id, request);
      }
    }
    return latest;
  }, [requests]);

  const averageRemaining = (() => {
    const values = staff
      .map((person) => balances[person.id]?.remaining)
      .filter((value): value is number => typeof value === 'number');
    if (values.length === 0) return '—';
    return `${(values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)} Days`;
  })();

  function employeeName(userId: string): string {
    return staffById.get(userId)?.full_name ?? 'Employee';
  }

  function overlappingApproved(request: TeamRequest): TeamRequest[] {
    return requests.filter((other) =>
      other.id !== request.id &&
      other.user_id !== request.user_id &&
      other.status === 'approved' &&
      other.start_date <= request.end_date &&
      other.end_date >= request.start_date
    );
  }

  async function handleDecision(
    requestId: string,
    decision: 'approved' | 'rejected'
  ) {
    if (actionId !== null) return;
    const comment = (comments[requestId] ?? '').trim();

    if (decision === 'rejected' && !comment) {
      setError('Enter a reason in the decision comment box before rejecting.');
      return;
    }

    setError('');
    setMessage('');
    setActionId(requestId);

    try {
      const { error: reviewError } = await supabase.rpc('review_leave', {
        p_id: requestId,
        p_decision: decision,
        p_comment: comment || null,
      });
      if (reviewError) throw reviewError;
      setMessage(`Leave request ${decision} successfully.`);
      setComments((previous) => ({ ...previous, [requestId]: '' }));
      setRefreshKey((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to review leave request.');
    } finally {
      setActionId(null);
    }
  }

  if (loading) return <p>Loading department dashboard...</p>;
  if (!authorized) return <p className="error" role="alert">{error || 'Manager access required.'}</p>;

  return (
    <section className="manager-compact">
      <style>{managerStyles}</style>
      <div className="md-heading">
        <div>
          <h2>{departmentName} Department Dashboard</h2>
          <p>Team leave overview, approvals, and your leave status.</p>
        </div>
        <select
          className="md-year"
          aria-label="Department dashboard year"
          value={year}
          onChange={(event) => setYear(Number(event.target.value))}
        >
          {Array.from({ length: 11 }, (_, index) => currentYear + 1 - index).map(
            (optionYear) => <option key={optionYear} value={optionYear}>{optionYear}</option>
          )}
        </select>
      </div>

      {error && <p className="md-error" role="alert">{error}</p>}
      {message && <p className="md-success" role="status">{message}</p>}

      <div className="md-stats">
        <div className="md-stat md-blue"><span className="md-stat-icon">♧</span><div><strong>{staff.length}</strong><span>Team Members</span></div></div>
        <div className="md-stat md-orange"><span className="md-stat-icon">▦</span><div><strong>{pendingRequests.length}</strong><span>Pending Team Requests</span></div></div>
        <div className="md-stat md-green"><span className="md-stat-icon">✓</span><div><strong>{new Set(todayLeaves.map((r) => r.user_id)).size}</strong><span>On Leave Today</span></div></div>
        <div className="md-stat md-purple"><span className="md-stat-icon">◉</span><div><strong>{averageRemaining}</strong><span>Avg. Team Leave Balance</span></div></div>
      </div>

      <div className="md-grid">
        <section className="md-panel">
          <div className="md-panel-heading"><h3>Team Leave Status</h3><p>Team members, balances and latest request status.</p></div>
          <div className="md-scroll">
            <table className="md-table">
              <thead><tr><th>Employee</th><th>Leave Balance</th><th>Latest Request Status</th><th>On Leave Today</th></tr></thead>
              <tbody>
                {staff.map((person) => (
                  <tr key={person.id}>
                    <td data-label="Employee"><strong>{person.full_name}</strong></td>
                    <td data-label="Leave Balance">{balances[person.id]?.remaining === null || balances[person.id]?.remaining === undefined ? '—' : `${balances[person.id].remaining} Days`}</td>
                    <td data-label="Latest Request Status"><StatusPill status={latestByPerson.get(person.id)?.status ?? 'none'} /></td>
                    <td data-label="On Leave Today"><span className={`md-yesno ${todayLeaves.some((r) => r.user_id === person.id) ? 'yes' : 'no'}`}>{todayLeaves.some((r) => r.user_id === person.id) ? 'Yes' : 'No'}</span></td>
                  </tr>
                ))}
                {staff.length === 0 && <tr><td colSpan={4}>No staff assigned to this department.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className="md-panel">
          <div className="md-panel-heading"><h3>Pending Team Leave Requests</h3><p>Review leave requests from department staff.</p></div>
          {pendingRequests.length === 0 ? <p className="md-empty">No pending team leave requests.</p> : (
            <div className="md-scroll md-approvals-scroll">
              <table className="md-table">
                <thead><tr><th>Employee</th><th>Leave Type</th><th>Dates</th><th>Days</th><th>Remaining Balance</th><th>Action</th></tr></thead>
                <tbody>
                  {pendingRequests.map((request) => {
                    const conflicts = overlappingApproved(request);
                    return (
                      <tr key={request.id}>
                        <td data-label="Employee"><strong>{employeeName(request.user_id)}</strong>{request.reason && <small className="md-cell-note">Reason: {request.reason}</small>}</td>
                        <td data-label="Leave Type">{readableType(request.leave_type)}</td>
                        <td data-label="Dates">{readableDate(request.start_date)} – {readableDate(request.end_date)}</td>
                        <td data-label="Days">{request.working_days}</td>
                        <td data-label="Remaining Balance">{balances[request.user_id]?.remaining == null ? '—' : `${balances[request.user_id].remaining} Days`}</td>
                        <td data-label="Action" className="md-action-cell">
                          {conflicts.length > 0 ? (
                            <div className="md-conflict">{new Set(conflicts.map((r) => r.user_id)).size} already on leave: {Array.from(new Set(conflicts.map((r) => employeeName(r.user_id)))).join(', ')}</div>
                          ) : <span className="md-no-conflict">No overlapping approved leave</span>}
                          <label className="md-comment-label" htmlFor={`manager-comment-${request.id}`}>Decision comment</label>
                          <textarea
                            id={`manager-comment-${request.id}`}
                            rows={2}
                            maxLength={1000}
                            placeholder="Required for rejection"
                            value={comments[request.id] ?? ''}
                            disabled={actionId !== null}
                            onChange={(event) => setComments((previous) => ({ ...previous, [request.id]: event.target.value }))}
                          />
                          <div className="md-actions">
                            <button type="button" className="md-button md-approve" disabled={actionId !== null} onClick={() => void handleDecision(request.id, 'approved')}>✓ Approve</button>
                            <button type="button" className="md-button md-reject" disabled={actionId !== null} onClick={() => void handleDecision(request.id, 'rejected')}>× Reject</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <div className="md-bottom">
        <section className="md-panel">
          <div className="md-panel-heading"><h3>My Leave Status</h3><p>Your annual leave entitlement, usage and balance.</p></div>
          <div className="md-own-stats">
            <div><span>Entitlement</span><strong>{managerBalance?.entitlement ?? '—'}</strong></div>
            <div><span>Used Leave</span><strong>{managerBalance?.used ?? '—'}</strong></div>
            <div><span>Remaining Balance</span><strong>{managerBalance?.remaining ?? '—'}</strong></div>
          </div>
        </section>

        <section className="md-panel">
          <div className="md-panel-heading"><h3>Who Is on Leave?</h3><p>Approved department leave on the selected day.</p></div>
          <label className="md-date-label" htmlFor="manager-day">Select date</label>
          <input type="date" id="manager-day" className="md-date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
          <div className="md-day-list">
            {selectedDayLeaves.length === 0 ? <p className="md-empty">No team members on approved leave this day.</p> : selectedDayLeaves.map((request) => (
              <div className="md-day-person" key={request.id}>
                <div><strong>{employeeName(request.user_id)}</strong><small>{readableType(request.leave_type)} · {readableDate(request.start_date)} – {readableDate(request.end_date)}</small></div>
                <StatusPill status="approved" />
              </div>
            ))}
          </div>
        </section>

        <section className="md-panel">
          <div className="md-panel-heading"><h3>Team Calendar Snapshot</h3><p>Today's approved leave in your department.</p></div>
          <div className="md-today-number">{new Set(todayLeaves.map((r) => r.user_id)).size}<span> Team Members on Leave Today</span></div>
          <div className="md-day-list">
            {todayLeaves.length === 0 ? <p className="md-empty">No team members on approved leave today.</p> : todayLeaves.map((request) => (
              <div className="md-day-person" key={request.id}><strong>{employeeName(request.user_id)}</strong><small>{readableType(request.leave_type)}</small></div>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}

const managerStyles = `
.manager-compact{width:100%;font-family:inherit;color:#10234f;font-size:12px}
.manager-compact *{box-sizing:border-box}
.manager-compact .md-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;flex-wrap:wrap}
.manager-compact .md-heading h2{margin:0;font-size:22px;font-weight:800;color:#10234f}
.manager-compact .md-heading p{margin:3px 0 0;color:#64748b;font-size:12px}
.manager-compact .md-year{padding:8px 28px 8px 12px;border:1px solid #dce4f3;border-radius:8px;background:#fff;color:#10234f;font:inherit;font-weight:700;min-width:104px;width:104px;box-sizing:border-box;cursor:pointer}
.manager-compact .md-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:10px}
.manager-compact .md-stat{display:flex;align-items:center;gap:12px;min-height:78px;border-radius:11px;padding:12px}
.manager-compact .md-blue{background:#eaf3ff}.manager-compact .md-orange{background:#fff5e7}.manager-compact .md-green{background:#eaf9ef}.manager-compact .md-purple{background:#f2ecff}
.manager-compact .md-stat-icon{display:grid;place-items:center;width:44px;height:44px;background:#ffffffa8;border-radius:10px;font-size:24px;color:#0f2a5c;flex-shrink:0}
.manager-compact .md-stat strong{display:block;font-size:23px;line-height:1.1;font-weight:800;color:#10234f}
.manager-compact .md-stat span:last-child{display:block;margin-top:3px;color:#334155;font-size:11px}
.manager-compact .md-grid{display:grid;grid-template-columns:1fr 1.25fr;gap:10px;align-items:start}
.manager-compact .md-bottom{display:grid;grid-template-columns:1fr 1.2fr 1fr;gap:10px;margin-top:10px;align-items:start}
.manager-compact .md-panel{min-width:0;padding:12px;background:#fff;border:1px solid #dce4f3;border-radius:12px;box-shadow:0 3px 14px #0f2a5c09}
.manager-compact .md-panel-heading{margin-bottom:8px}
.manager-compact .md-panel-heading h3{font-size:15px;font-weight:800;margin:0;color:#10234f}
.manager-compact .md-panel-heading p{margin:3px 0 0;font-size:11px;color:#64748b}
.manager-compact .md-scroll{overflow-x:auto;max-height:360px;overflow-y:auto}
.manager-compact .md-approvals-scroll{max-height:360px}
.manager-compact .md-table{width:100%;border-collapse:collapse;text-align:left;font-size:11px}
.manager-compact .md-table th{background:#edf1f7;color:#10234f;font-weight:800;padding:9px 7px;white-space:nowrap;position:sticky;top:0;z-index:1}
.manager-compact .md-table td{border-bottom:1px solid #e5eaf3;padding:8px 7px;vertical-align:top;min-height:44px}
.manager-compact .md-table td strong{font-size:11px}
.manager-compact .md-cell-note{display:block;margin-top:5px;color:#64748b;max-width:170px;overflow-wrap:anywhere}
.manager-compact .md-status{display:inline-flex;align-items:center;justify-content:center;padding:5px 9px;border-radius:7px;font-weight:700;font-size:10px;white-space:nowrap}
.manager-compact .md-status-pending{background:#fef3c7;color:#b45309}.manager-compact .md-status-approved{background:#dcfce7;color:#15803d}.manager-compact .md-status-rejected{background:#fee2e2;color:#b91c1c}.manager-compact .md-status-cancelled,.manager-compact .md-status-none{background:#f3f4f6;color:#4b5563}
.manager-compact .md-yesno{display:inline-block;min-width:36px;text-align:center;padding:5px 8px;border-radius:6px;font-size:10px;font-weight:700}
.manager-compact .md-yesno.yes{background:#dcfce7;color:#15803d}.manager-compact .md-yesno.no{background:#f3f4f6;color:#4b5563}
.manager-compact .md-action-cell{min-width:176px}
.manager-compact .md-conflict{background:#fff5e7;color:#92400e;border-radius:6px;padding:6px;margin-bottom:6px;font-size:10px;line-height:1.4}
.manager-compact .md-no-conflict{display:block;color:#64748b;margin-bottom:6px;font-size:10px}
.manager-compact .md-comment-label{display:block;font-size:10px;font-weight:700;margin:5px 0}
.manager-compact .md-action-cell textarea{display:block;width:100%;min-height:44px;border:1px solid #cbd5e1;border-radius:6px;padding:6px;background:#fff;color:#10234f;font:inherit;resize:vertical}
.manager-compact .md-actions{display:flex;gap:6px;margin-top:6px}
.manager-compact .md-button{border-radius:7px;min-height:44px;padding:8px 10px;font-size:11px;font-weight:700;cursor:pointer}
.manager-compact .md-approve{background:#0f2a5c;color:#fff;border:1px solid #0f2a5c}.manager-compact .md-reject{background:#fff;color:#0f2a5c;border:1px solid #a9bdd9}
.manager-compact .md-button:disabled{opacity:.55;cursor:not-allowed}
.manager-compact .md-error,.manager-compact .md-success{padding:9px 12px;border-radius:8px;margin:0 0 12px}
.manager-compact .md-error{background:#fee2e2;color:#b91c1c}.manager-compact .md-success{background:#dcfce7;color:#15803d}
.manager-compact .md-empty{font-size:11px;color:#64748b;margin:4px 0 0;line-height:1.5}
.manager-compact .md-own-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}
.manager-compact .md-own-stats div{background:#eaf3ff;border-radius:8px;padding:11px 7px;min-width:0}
.manager-compact .md-own-stats div:nth-child(2){background:#fff5e7}.manager-compact .md-own-stats div:nth-child(3){background:#eaf9ef}
.manager-compact .md-own-stats span{font-size:10px;display:block;color:#475569}.manager-compact .md-own-stats strong{font-size:19px;display:block;margin-top:4px}
.manager-compact .md-date-label{display:block;font-size:11px;color:#475569;font-weight:700;margin-bottom:5px}
.manager-compact .md-date{width:100%;max-width:190px;padding:9px;border-radius:7px;border:1px solid #cbd5e1;background:#fff;color:#10234f;min-height:44px}
.manager-compact .md-day-list{max-height:160px;overflow-y:auto;margin-top:9px}
.manager-compact .md-day-person{display:flex;align-items:center;justify-content:space-between;gap:8px;border-bottom:1px solid #e5eaf3;padding:7px 0;font-size:11px}
.manager-compact .md-day-person small{display:block;color:#64748b;font-size:10px;margin-top:3px}
.manager-compact .md-today-number{background:#eaf3ff;border-radius:8px;padding:11px;font-size:22px;font-weight:800}
.manager-compact .md-today-number span{font-size:11px;font-weight:600}
.manager-compact button:focus-visible,.manager-compact select:focus-visible,.manager-compact input:focus-visible,.manager-compact textarea:focus-visible{outline:3px solid #93c5fd;outline-offset:2px}
@media(max-width:1100px){.manager-compact .md-grid{grid-template-columns:1fr}.manager-compact .md-bottom{grid-template-columns:repeat(2,minmax(0,1fr))}.manager-compact .md-stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:700px){.manager-compact .md-heading h2{font-size:18px}.manager-compact .md-year{margin-left:auto}.manager-compact .md-stats,.manager-compact .md-bottom{grid-template-columns:1fr}.manager-compact .md-stat{min-height:68px}.manager-compact .md-table thead{display:none}.manager-compact .md-table,.manager-compact .md-table tbody,.manager-compact .md-table tr{display:block}.manager-compact .md-table tr{border:1px solid #dce4f3;border-radius:9px;margin-bottom:9px;padding:6px}.manager-compact .md-table td{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;min-height:44px}.manager-compact .md-table td:before{content:attr(data-label);font-weight:700;color:#64748b;flex:0 0 90px}.manager-compact .md-table .md-action-cell{display:block;min-width:0}.manager-compact .md-table .md-action-cell:before{display:block;margin-bottom:5px}.manager-compact .md-table .md-action-cell .md-actions{justify-content:flex-end}.manager-compact .md-scroll{max-height:none}}
`;
