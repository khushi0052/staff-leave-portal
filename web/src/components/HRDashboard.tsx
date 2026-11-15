
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import ExcelJS from 'exceljs';
import AddEmployeeForm from './AddEmployeeForm';

type Role = 'staff' | 'manager' | 'hr';
type LeaveType = 'annual' | 'sick' | 'unpaid';
type Status = 'pending' | 'approved' | 'rejected' | 'cancelled';

const LEAVE_STATUSES: Status[] = [
  'approved',
  'pending',
  'rejected',
  'cancelled',
];

type HRView =
  | 'hr'
  | 'hr-requests'
  | 'hr-employees'
  | 'hr-reports';

type Props = {
  view: HRView;
  onNavigate: (view: HRView) => void;
};

type Profile = {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  department_id: string | null;
  annual_entitlement: number | null;
};

type Department = {
  id: string;
  name: string;
};

type Request = {
  id: string;
  user_id: string;
  department_id: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  working_days: number;
  reason: string | null;
  status: Status;
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

// Treat any user-entered text as literal worksheet data.
// ExcelJS writes these values as strings, never as formulas.
function excelText(value: string): string {
  return /^[\s]*[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function Stat({
  label,
  value,
  color,
  icon,
}: {
  label: string;
  value: string | number;
  color: string;
  icon: string;
}) {
  return (
    <div className={`hr-summary-card ${color}`}>
      <span className="hr-stat-icon" aria-hidden="true">
        {icon}
      </span>

      <div>
        <strong className="hr-summary-value">
          {value}
        </strong>
        <span className="hr-summary-label">
          {label}
        </span>
      </div>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="hr-card">
      <header className="hr-panel-heading">
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </header>
      {children}
    </section>
  );
}

function Pill({
  value,
  kind,
}: {
  value: string | number;
  kind: 'pending' | 'on-leave' | 'yes' | 'no';
}) {
  return (
    <span className={`hr-count ${kind}`}>
      {value}
    </span>
  );
}

export default function HRDashboard({
  view,
  onNavigate,
}: Props) {
  const [authorized, setAuthorized] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [requests, setRequests] = useState<Request[]>([]);

  const year = new Date().getFullYear();
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');

  const [balance, setBalance] = useState<Balance | null>(null);
  const [entitlementInput, setEntitlementInput] = useState('');
  const [comments] = useState<Record<string, string>>({});


  const [loading, setLoading] = useState(true);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [showAddEmployee, setShowAddEmployee] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      // UI role check only. Database RLS is the real guard.
      const { data: authData, error: authError } =
        await supabase.auth.getUser();

      if (authError) throw authError;
      if (!authData.user) throw new Error('Please sign in.');

      const { data: myProfile, error: myError } =
        await supabase
          .from('profiles')
          .select('role')
          .eq('id', authData.user.id)
          .single();

      if (myError) throw myError;

      if (myProfile.role !== 'hr') {
        setAuthorized(false);
        throw new Error('This page is restricted to HR.');
      }

      setAuthorized(true);

      const [
        peopleResult,
        departmentResult,
      ] = await Promise.all([
        supabase
          .from('profiles')
          .select(
            'id, full_name, email, role, department_id, annual_entitlement'
          )
          .order('full_name'),
        supabase
          .from('departments')
          .select('id, name')
          .order('name'),
      ]);

      if (peopleResult.error) throw peopleResult.error;
      if (departmentResult.error) throw departmentResult.error;

      const people = (peopleResult.data ?? []) as Profile[];
      const departmentsData =
        (departmentResult.data ?? []) as Department[];

      // Paginate so the dashboard can read more than
      // Supabase's default 1,000-row response limit.
      const records: Request[] = [];
      const pageSize = 500;

      for (let offset = 0; ; offset += pageSize) {
        const { data, error: requestError } =
          await supabase
            .from('leave_requests')
            .select(
              'id, user_id, department_id, leave_type, start_date, end_date, working_days, reason, status, decided_by, decision_comment, created_at, updated_at'
            )
            .order('id', { ascending: true })
            .range(offset, offset + pageSize - 1);

        if (requestError) throw requestError;

        const page = (data ?? []) as Request[];
        records.push(...page);

        if (page.length < pageSize) break;
      }

      setProfiles(people);
      setDepartments(departmentsData);
      setRequests(records);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to load HR information.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const peopleById = useMemo(
    () => new Map(profiles.map((p) => [p.id, p])),
    [profiles]
  );

  const departmentsById = useMemo(
    () => new Map(departments.map((d) => [d.id, d])),
    [departments]
  );

  const today = new Date();
  const todayKey =
    `${today.getFullYear()}-` +
    `${String(today.getMonth() + 1).padStart(2, '0')}-` +
    String(today.getDate()).padStart(2, '0');

  function personName(id: string | null): string {
    if (!id) return 'Not assigned';
    return peopleById.get(id)?.full_name ?? 'Unknown employee';
  }

  function departmentName(id: string | null): string {
    if (!id) return 'Unassigned';
    return departmentsById.get(id)?.name ?? 'Unknown department';
  }

  function onLeaveToday(userId: string): boolean {
    return requests.some(
      (r) =>
        r.user_id === userId &&
        r.status === 'approved' &&
        r.start_date <= todayKey &&
        r.end_date >= todayKey
    );
  }

  function annualApproved(userId: string): number {
    return requests
      .filter(
        (r) =>
          r.user_id === userId &&
          r.leave_type === 'annual' &&
          r.status === 'approved' &&
          r.start_date >= `${year}-01-01` &&
          r.end_date <= `${year}-12-31`
      )
      .reduce((sum, r) => sum + r.working_days, 0);
  }

  function remainingBalance(person: Profile): number | null {
    if (person.annual_entitlement === null) return null;

    return (
      person.annual_entitlement -
      annualApproved(person.id)
    );
  }

  function averageBalance(people: Profile[]): string {
    const values = people
      .map(remainingBalance)
      .filter((value): value is number => value !== null);

    if (values.length === 0) return '—';

    const average =
      values.reduce((sum, value) => sum + value, 0) /
      values.length;

    return `${average.toFixed(1)} Days`;
  }

  const managers = profiles.filter((p) => p.role === 'manager');
  const employees = profiles.filter((p) => p.role !== 'hr');

  const pendingStaff = requests.filter(
    (r) =>
      r.status === 'pending' &&
      peopleById.get(r.user_id)?.role === 'staff'
  );

  const pendingManagers = requests.filter(
    (r) =>
      r.status === 'pending' &&
      peopleById.get(r.user_id)?.role === 'manager'
  );

  const approvedToday = employees.filter((person) =>
    onLeaveToday(person.id)
  ).length;

  const managerIds = new Set(managers.map((p) => p.id));

  const approvedByManagers = requests.filter(
    (r) =>
      r.status === 'approved' &&
      r.decided_by !== null &&
      managerIds.has(r.decided_by)
  );

  const selectedEmployee =
    peopleById.get(selectedUserId) ?? null;

  const filteredEmployees = profiles.filter((person) => {
    const matchesDepartment =
      !departmentFilter ||
      person.department_id === departmentFilter;

    const search = employeeSearch.trim().toLowerCase();

    const matchesSearch =
      !search ||
      person.full_name.toLowerCase().includes(search) ||
      person.email.toLowerCase().includes(search);

    return matchesDepartment && matchesSearch;
  });

  async function selectEmployee(person: Profile) {
    setSelectedUserId(person.id);
    setEntitlementInput(
      person.annual_entitlement === null
        ? ''
        : String(person.annual_entitlement)
    );
    setBalance(null);
    setBalanceLoading(true);
    setError('');

    try {
      const { data, error: balanceError } =
        await supabase.rpc('leave_balance', {
          p_user: person.id,
          p_year: year,
        });

      if (balanceError) throw balanceError;

      setBalance((data as Balance[] | null)?.[0] ?? null);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to load leave balance.'
      );
    } finally {
      setBalanceLoading(false);
    }
  }

  async function saveEntitlement() {
    if (!selectedEmployee) return;

    const raw = entitlementInput.trim();
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
      `Reason for changing ${selectedEmployee.full_name}'s entitlement:`
    );

    if (comment === null) return;

    if (!comment.trim()) {
      setError('A reason is required.');
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');

    try {
      const { error: updateError } =
        await supabase.rpc('set_annual_entitlement', {
          p_user: selectedEmployee.id,
          p_entitlement: amount,
          p_comment: comment.trim(),
        });

      if (updateError) throw updateError;

      setMessage('Annual entitlement updated.');
      await loadData();
      await selectEmployee({
        ...selectedEmployee,
        annual_entitlement: amount,
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to update entitlement.'
      );
    } finally {
      setBusy(false);
    }
  }

  async function reviewRequest(
    requestId: string,
    decision: 'approved' | 'rejected'
  ) {
    let comment = comments[requestId]?.trim() ?? '';

    if (decision === 'rejected' && !comment) {
      const reason = window.prompt(
        'Enter the reason for rejecting this leave request:'
      );

      if (reason === null) return;
      comment = reason.trim();

      if (!comment) {
        setError('A rejection reason is required.');
        return;
      }
    }

    if (comment.length > 1000) {
      setError('The decision comment is too long.');
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');

    try {
      const { error: reviewError } =
        await supabase.rpc('review_leave', {
          p_id: requestId,
          p_decision: decision,
          p_comment: comment || null,
        });

      if (reviewError) throw reviewError;

      setMessage(`Leave request ${decision}.`);
      await loadData();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to review leave.'
      );
    } finally {
      setBusy(false);
    }
  }

  async function exportExcel() {
    if (busy) return;

    setBusy(true);
    setError('');
    setMessage('');

    try {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'LeaveDesk';
      workbook.title = 'Employee Leave Records';

      const worksheet = workbook.addWorksheet('Leave Records');
      worksheet.columns = [
        { header: 'Employee Name', key: 'employeeName', width: 27 },
        { header: 'Department', key: 'department', width: 23 },
        { header: 'Leave Type', key: 'leaveType', width: 18 },
        { header: 'Start Date', key: 'startDate', width: 18 },
        { header: 'End Date', key: 'endDate', width: 18 },
        { header: 'Status', key: 'status', width: 17 },
        { header: 'Approved By', key: 'approvedBy', width: 27 },
        { header: 'Total Days of Leave', key: 'totalDays', width: 23 },
      ];

      // All records were loaded in pages by loadData(), subject to HR RLS.
      // Each row represents one request, not one employee.
      for (const request of requests) {
        const employee = peopleById.get(request.user_id);
        const leaveType =
          request.leave_type === 'annual'
            ? 'Annual Leave'
            : request.leave_type === 'sick'
              ? 'Sick Leave'
              : 'Unpaid Leave';

        const approvedBy =
          request.status === 'approved' && request.decided_by
            ? personName(request.decided_by)
            : '';

        worksheet.addRow({
          employeeName: excelText(employee?.full_name ?? 'Unknown'),
          department: excelText(departmentName(request.department_id)),
          leaveType,
          startDate: new Date(`${request.start_date}T00:00:00`),
          endDate: new Date(`${request.end_date}T00:00:00`),
          status: request.status.charAt(0).toUpperCase() + request.status.slice(1),
          approvedBy: excelText(approvedBy),
          totalDays: request.working_days,
        });
      }

      const heading = worksheet.getRow(1);
      heading.height = 30;
      heading.font = {
        bold: true,
        color: { argb: 'FFFFFFFF' },
      };
      heading.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF0F2A5C' },
      };
      heading.alignment = {
        vertical: 'middle',
        horizontal: 'center',
      };

      for (let index = 2; index <= worksheet.rowCount; index += 1) {
        const row = worksheet.getRow(index);
        row.height = 25;
        row.alignment = { vertical: 'middle' };
        row.getCell(4).numFmt = 'dd mmm yyyy';
        row.getCell(5).numFmt = 'dd mmm yyyy';
        row.getCell(8).numFmt = '0';

        if (index % 2 === 0) {
          row.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF0F5FF' },
          };
        }
      }

      worksheet.autoFilter = { from: 'A1', to: 'H1' };
      worksheet.views = [{ state: 'frozen', ySplit: 1 }];

      const buffer = await workbook.xlsx.writeBuffer();
      const bytes = new Uint8Array(buffer);
      const copiedBuffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(copiedBuffer).set(bytes);
      const blob = new Blob([copiedBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `LeaveDesk_Leave_Records_${todayKey}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Release the generated object URL after triggering the download.
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);

      setMessage(`${requests.length} leave records exported to Excel.`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to export Excel records.'
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <p>Loading HR dashboard information...</p>;
  }

  if (!authorized) {
    return (
      <p className="error" role="alert">
        {error || 'HR access required.'}
      </p>
    );
  }

  return (
    <div className="hr-leavedesk">
      <div className="hr-page">
        {error && (
          <p className="error" role="alert">{error}</p>
        )}

        {message && (
          <p className="success" role="status">{message}</p>
        )}

        {view === 'hr' && showAddEmployee && (
          <AddEmployeeForm
            departments={departments}
            onClose={() => setShowAddEmployee(false)}
            onCreated={async () => {
              setShowAddEmployee(false);
              setMessage('Employee account created successfully.');
              await loadData();
            }}
          />
        )}

        {/* ======================================
            PAGE 1 — HR HEAD DASHBOARD
            ====================================== */}

        {view === 'hr' && (
          <>
            <div className="hr-summary-grid">
              <Stat
                icon="♙"
                label="Total Staff"
                value={employees.length}
                color="blue"
              />
              <Stat
                icon="▦"
                label="Departments"
                value={departments.length}
                color="orange"
              />
              <Stat
                icon="◷"
                label="Pending Staff Requests"
                value={pendingStaff.length}
                color="orange"
              />
              <Stat
                icon="♙"
                label="Pending Dept. Head Requests"
                value={pendingManagers.length}
                color="purple"
              />
              <Stat
                icon="✓"
                label="Approved / On Leave Today"
                value={approvedToday}
                color="green"
              />
              <Stat
                icon="▣"
                label="Avg. Annual Leave Balance"
                value={averageBalance(employees)}
                color="lavender"
              />
            </div>

            <div className="hr-grid">
              <div className="hr-span-6">
                <Panel
                  title="Department Overview"
                  subtitle="Leave status by department."
                >
                  <div className="hr-table-scroll">
                    <table className="hr-table">
                      <thead>
                        <tr>
                          <th>Department</th>
                          <th>Staff</th>
                          <th>Pending Requests</th>
                          <th>On Leave Today</th>
                          <th>Avg. Leave Balance</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {departments.map((dept) => {
                          const people = employees.filter(
                            (p) => p.department_id === dept.id
                          );

                          const deptPending = pendingStaff.filter(
                            (r) => r.department_id === dept.id
                          ).length;

                          const onLeave = people.filter(
                            (p) => onLeaveToday(p.id)
                          ).length;

                          return (
                            <tr key={dept.id}>
                              <td data-label="Department">
                                <strong>{dept.name}</strong>
                              </td>
                              <td data-label="Staff">
                                {people.length}
                              </td>
                              <td data-label="Pending Requests">
                                <Pill
                                  value={deptPending}
                                  kind="pending"
                                />
                              </td>
                              <td data-label="On Leave Today">
                                <Pill
                                  value={onLeave}
                                  kind="on-leave"
                                />
                              </td>
                              <td data-label="Avg. Leave Balance">
                                {averageBalance(people)}
                              </td>
                              <td data-label="Action">
                                <button
                                  type="button"
                                  className="hr-button outline"
                                  onClick={() => {
                                    setDepartmentFilter(dept.id);
                                    setSelectedUserId('');
                                    onNavigate('hr-employees');
                                  }}
                                >
                                  View Department ›
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              </div>

              <div className="hr-span-6">
                <Panel
                  title="Department Head Leave Requests"
                  subtitle="Managers awaiting HR approval."
                >
                  {pendingManagers.length === 0 ? (
                    <p>No pending department head requests.</p>
                  ) : (
                    <div className="hr-table-scroll">
                      <table className="hr-table">
                        <thead>
                          <tr>
                            <th>Requestor</th>
                            <th>Department</th>
                            <th>Leave Type</th>
                            <th>Dates</th>
                            <th>Days</th>
                            <th>Status / Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pendingManagers.slice(0, 5).map((r) => (
                            <tr key={r.id}>
                              <td data-label="Requestor">
                                {personName(r.user_id)}
                              </td>
                              <td data-label="Department">
                                {departmentName(r.department_id)}
                              </td>
                              <td data-label="Leave Type">
                                {r.leave_type}
                              </td>
                              <td data-label="Dates">
                                {formatDate(r.start_date)} –{' '}
                                {formatDate(r.end_date)}
                              </td>
                              <td data-label="Days">
                                {r.working_days}
                              </td>
                              <td data-label="Action">
                                <div className="hr-actions">
                                  <button
                                    type="button"
                                    className="hr-button approve"
                                    disabled={busy}
                                    onClick={() =>
                                      void reviewRequest(r.id, 'approved')
                                    }
                                  >
                                    ✓ Approve
                                  </button>
                                  <button
                                    type="button"
                                    className="hr-button reject"
                                    disabled={busy}
                                    onClick={() =>
                                      void reviewRequest(r.id, 'rejected')
                                    }
                                  >
                                    × Reject
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Panel>
              </div>

              <div className="hr-span-4">
                <Panel
                  title="Company Leave Status"
                  subtitle="All leave requests visible to HR."
                >
                  <table className="hr-table">
                    <thead>
                      <tr>
                        <th>Status</th>
                        <th>Requests</th>
                        <th>% of Total</th>
                      </tr>
                    </thead>
                     
<tbody>
  {LEAVE_STATUSES.map((status) => {
    const count = requests.filter(
      (request) => request.status === status
    ).length;

    const percent =
      requests.length > 0
        ? Math.round((count / requests.length) * 100)
        : 0;

    return (
      <tr key={status}>
        <td data-label="Status">
          <span className={`hr-status ${status}`}>
            {status}
          </span>
        </td>

        <td data-label="Requests">
          {count}
        </td>

        <td data-label="% of Total">
          {percent}%
        </td>
      </tr>
    );
  })}
</tbody>

                  </table>
                </Panel>
              </div>

              <div className="hr-span-4">
                <Panel
                  title="Employee Directory"
                  subtitle="Search and view employee records."
                >
                  <input
                    className="hr-search"
                    placeholder="Search employee..."
                    value={employeeSearch}
                    onChange={(e) =>
                      setEmployeeSearch(e.target.value)
                    }
                    aria-label="Search employees"
                  />

                  <div className="hr-table-scroll">
                    <table className="hr-table">
                      <thead>
                        <tr>
                          <th>Employee</th>
                          <th>Department</th>
                          <th>On Leave</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredEmployees
                          .filter((p) => p.role !== 'hr')
                          .slice(0, 5)
                          .map((person) => (
                            <tr key={person.id}>
                              <td data-label="Employee">
                                {person.full_name}
                              </td>
                              <td data-label="Department">
                                {departmentName(person.department_id)}
                              </td>
                              <td data-label="On Leave">
                                <Pill
                                  kind={
                                    onLeaveToday(person.id)
                                      ? 'yes'
                                      : 'no'
                                  }
                                  value={
                                    onLeaveToday(person.id)
                                      ? 'Yes'
                                      : 'No'
                                  }
                                />
                              </td>
                              <td data-label="Action">
                                <button
                                  type="button"
                                  className="hr-button outline"
                                  onClick={() => {
                                    setDepartmentFilter('');
                                    onNavigate('hr-employees');
                                    void selectEmployee(person);
                                  }}
                                >
                                  View Record ›
                                </button>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              </div>

              <div className="hr-span-4">
                <Panel
                  title="Quick Actions"
                  subtitle="Common HR Head tasks."
                >
                  <div className="hr-quick-actions">
                    <button
                      type="button"
                      className="hr-button primary"
                      onClick={() => setShowAddEmployee(true)}
                    >
                      + Add Employee
                    </button>
                    <button
                      type="button"
                      className="hr-button primary"
                      disabled={busy}
                      onClick={() => onNavigate('hr-reports')}
                    >
                      Export Leave Records (Excel) ›
                    </button>
                    <button
                      type="button"
                      className="hr-button outline"
                      onClick={() => onNavigate('hr-employees')}
                    >
                      Adjust Leave Balances ›
                    </button>
                  </div>
                </Panel>
              </div>
            </div>
          </>
        )}

        {/* ======================================
            PAGE 2 — LEAVE REQUESTS
            ====================================== */}

        {view === 'hr-requests' && (
          <Panel
            title="Department Head Leave Requests"
            subtitle="Review pending manager leave requests."
          >
            {pendingManagers.length === 0 ? (
              <p>No manager leave requests awaiting HR approval.</p>
            ) : (
              <div className="hr-table-scroll">
                <table className="hr-table">
                  <thead>
                    <tr>
                      <th>Requestor</th>
                      <th>Department</th>
                      <th>Leave Type</th>
                      <th>Dates</th>
                      <th>Days</th>
                      <th>Status / Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingManagers.map((request) => (
                      <tr key={request.id}>
                        <td data-label="Requestor">
                          {personName(request.user_id)}
                        </td>
                        <td data-label="Department">
                          {departmentName(request.department_id)}
                        </td>
                        <td data-label="Leave Type">
                          {request.leave_type}
                        </td>
                        <td data-label="Dates">
                          {formatDate(request.start_date)} –{' '}
                          {formatDate(request.end_date)}
                        </td>
                        <td data-label="Days">
                          {request.working_days}
                        </td>
                        <td data-label="Action">
                          <div className="hr-actions">
                            <button
                              type="button"
                              className="hr-button approve"
                              disabled={busy}
                              onClick={() =>
                                void reviewRequest(
                                  request.id,
                                  'approved'
                                )
                              }
                            >
                              ✓ Approve
                            </button>
                            <button
                              type="button"
                              className="hr-button reject"
                              disabled={busy}
                              onClick={() =>
                                void reviewRequest(
                                  request.id,
                                  'rejected'
                                )
                              }
                            >
                              × Reject
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        )}

        {/* ======================================
            PAGE 3 — EMPLOYEES
            ====================================== */}

        {view === 'hr-employees' && (
          <Panel
            title="Employee Directory"
            subtitle="Choose a department and employee to view balances."
          >
            <div className="hr-filters">
              <label>
                Department
                <select
                  value={departmentFilter}
                  onChange={(e) => {
                    setDepartmentFilter(e.target.value);
                    setSelectedUserId('');
                    setBalance(null);
                  }}
                >
                  <option value="">All departments</option>
                  {departments.map((dept) => (
                    <option key={dept.id} value={dept.id}>
                      {dept.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Employee search
                <input
                  type="search"
                  value={employeeSearch}
                  onChange={(e) =>
                    setEmployeeSearch(e.target.value)
                  }
                  placeholder="Name or email"
                />
              </label>
            </div>

            {departmentFilter && (
              <p className="hr-manager-name">
                Department Manager:{' '}
                <strong>
                  {profiles
                    .filter(
                      (p) =>
                        p.department_id === departmentFilter &&
                        p.role === 'manager'
                    )
                    .map((p) => p.full_name)
                    .join(', ') || 'Not assigned'}
                </strong>
              </p>
            )}

            <div className="hr-employee-list">
              {filteredEmployees.map((person) => (
                <button
                  key={person.id}
                  type="button"
                  className="hr-employee-button"
                  onClick={() => void selectEmployee(person)}
                >
                  <span>{person.full_name}</span>
                  <small>
                    {departmentName(person.department_id)}
                    {' · '}
                    {person.role}
                  </small>
                  <span aria-hidden="true">›</span>
                </button>
              ))}
            </div>

            {selectedEmployee && (
              <section className="hr-selected-employee">
                <h3>{selectedEmployee.full_name}</h3>
                <p>{selectedEmployee.email}</p>

                {balanceLoading ? (
                  <p>Loading balance...</p>
                ) : balance ? (
                  <div className="hr-balance-three">
                    <Stat
                      icon="▦"
                      label="Assigned"
                      value={balance.entitlement ?? 'Not assigned'}
                      color="blue"
                    />
                    <Stat
                      icon="✓"
                      label="Approved"
                      value={balance.used}
                      color="green"
                    />
                    <Stat
                      icon="◷"
                      label="Pending"
                      value={balance.reserved}
                      color="orange"
                    />
                  </div>
                ) : (
                  <p>No balance available.</p>
                )}

                <div className="hr-entitlement-editor">
                  <label htmlFor="hr-entitlement">
                    Annual entitlement (days)
                  </label>

                  <input
                    id="hr-entitlement"
                    type="number"
                    min="0"
                    step="1"
                    value={entitlementInput}
                    onChange={(e) =>
                      setEntitlementInput(e.target.value)
                    }
                  />

                  <button
                    type="button"
                    className="hr-button primary"
                    disabled={busy}
                    onClick={() => void saveEntitlement()}
                  >
                    Update Entitlement
                  </button>
                </div>
              </section>
            )}
          </Panel>
        )}

        {/* ======================================
            PAGE 4 — REPORTS
            ====================================== */}

        {view === 'hr-reports' && (
          <>
            <Panel
              title="Reports & Export"
              subtitle="Download all leave records accessible to HR."
            >
              <button
                type="button"
                className="hr-button primary"
                disabled={busy}
                onClick={() => void exportExcel()}
              >
                {busy
                  ? 'Preparing records...'
                  : 'Export Leave Records (Excel)'}
              </button>

              <p>
                Total records: <strong>{requests.length}</strong>
              </p>
            </Panel>

            <div className="hr-report-history">
              <Panel
                title="Staff Leave Approved by Managers"
                subtitle="Approved staff leave and approval details."
              >
                {approvedByManagers.length === 0 ? (
                  <p>No manager-approved staff leave found.</p>
                ) : (
                  <div className="hr-table-scroll">
                    <table className="hr-table">
                      <thead>
                        <tr>
                          <th>Employee</th>
                          <th>Department</th>
                          <th>Leave Type</th>
                          <th>Dates</th>
                          <th>Days</th>
                          <th>Approved By</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {approvedByManagers
                          .slice(0, 100)
                          .map((r) => (
                            <tr key={r.id}>
                              <td data-label="Employee">
                                {personName(r.user_id)}
                              </td>
                              <td data-label="Department">
                                {departmentName(r.department_id)}
                              </td>
                              <td data-label="Leave Type">
                                {r.leave_type}
                              </td>
                              <td data-label="Dates">
                                {formatDate(r.start_date)} –{' '}
                                {formatDate(r.end_date)}
                              </td>
                              <td data-label="Days">
                                {r.working_days}
                              </td>
                              <td data-label="Approved By">
                                {personName(r.decided_by)}
                              </td>
                              <td data-label="Status">
                                <span className="hr-status approved">
                                  ✓ Approved
                                </span>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
