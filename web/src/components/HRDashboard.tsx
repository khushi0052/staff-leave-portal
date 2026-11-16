
import './LeaveDeskDashboardLayout.css';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import ExcelJS from 'exceljs';
import AddEmployeeForm from './AddEmployeeForm';

type Role = 'staff' | 'manager' | 'hr';
type LeaveType = 'annual' | 'sick' | 'unpaid';
type Status = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'withdrawn';

const LEAVE_STATUSES: Status[] = [
  'approved',
  'pending',
  'rejected',
  'cancelled',
  'withdrawn',
];

type HRView =
  | 'hr'
  | 'hr-requests'
  | 'hr-employees'
  | 'hr-reports';

type Props = {
  view: HRView;
  year: number;
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

// Reuse HR data between navigation changes, avoiding repeated 5,000-row downloads.
let hrCache: { timestamp: number; people: Profile[]; departments: Department[]; records: Request[] } | null = null;
const HR_CACHE_MS = 30_000;

export default function HRDashboard({
  view,
  year,
  onNavigate,
}: Props) {
  const [authorized, setAuthorized] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [requests, setRequests] = useState<Request[]>([]);

  const [departmentFilter, setDepartmentFilter] = useState('');
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [employeePickerOpen, setEmployeePickerOpen] = useState(false);
  const [requestName, setRequestName] = useState('');
  const [reportMonths, setReportMonths] = useState<1 | 3 | 6 | 12>(1);
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
  const [requestsDepartment, setRequestsDepartment] = useState('');
  const [requestsRole, setRequestsRole] = useState('');
  const [requestsStatus, setRequestsStatus] = useState('');
  const [requestsPage, setRequestsPage] = useState(1);

  const loadData = useCallback(async (force = false) => {
    // Background refresh should not blank out a previously rendered dashboard.
    if (!hrCache) setLoading(true);
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

      // Verify the logged-in HR user before using cached company data.
      if (!force && hrCache && Date.now() - hrCache.timestamp < HR_CACHE_MS) {
        setProfiles(hrCache.people);
        setDepartments(hrCache.departments);
        setRequests(hrCache.records);
        setLoading(false);
        return;
      }

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

      // Fetch requests concurrently instead of waiting for 10+ sequential pages.
      // This reduces first-load latency while keeping Supabase RLS in place.
      const pageSize = 500;
      const columns = 'id, user_id, department_id, leave_type, start_date, end_date, working_days, reason, status, decided_by, decision_comment, created_at, updated_at';
      const { count, error: countError } = await supabase
        .from('leave_requests').select('id', { count: 'exact', head: true });
      if (countError) throw countError;
      const pages = Math.ceil((count ?? 0) / pageSize);
      const results = await Promise.all(
        Array.from({ length: pages }, (_, index) =>
          supabase.from('leave_requests').select(columns)
            .order('id', { ascending: true })
            .range(index * pageSize, (index + 1) * pageSize - 1)
        )
      );
      const records: Request[] = [];
      for (const result of results) {
        if (result.error) throw result.error;
        records.push(...((result.data ?? []) as Request[]));
      }
      hrCache = {
        timestamp: Date.now(),
        people,
        departments: departmentsData,
        records,
      };
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
    // Refresh when HR returns from another tab or window after decisions.
    const refreshOnFocus = () => { void loadData(); };
    window.addEventListener('focus', refreshOnFocus);
    // Live refresh for HR when an employee withdraws or a manager decides.
    // Also works on focus if Realtime is not enabled on the table.
    const channel = supabase.channel('hr-leave-status-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leave_requests' },
        () => { void loadData(true); })
      .subscribe();
    return () => {
      window.removeEventListener('focus', refreshOnFocus);
      void supabase.removeChannel(channel);
    };
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

  function remainingBalanceForYear(person: Profile, balanceYear: number): number | null {
    if (person.annual_entitlement === null) return null;
    const used = requests
      .filter((r) =>
        r.user_id === person.id &&
        r.leave_type === 'annual' &&
        r.status === 'approved' &&
        r.start_date.startsWith(`${balanceYear}-`)
      )
      .reduce((sum, r) => sum + r.working_days, 0);
    return person.annual_entitlement - used;
  }

  function remainingBalance(person: Profile): number | null {
    return remainingBalanceForYear(person, year);
  }

  function leaveTypeLabel(type: LeaveType): string {
    return type === 'annual' ? 'Annual Leave' :
      type === 'sick' ? 'Sick Leave' : 'Unpaid Leave';
  }

  // Unique colleagues whose APPROVED periods overlap this application.
  function overlappingApprovedStaff(request: Request): string[] {
    const others = new Set<string>();
    for (const other of requests) {
      if (
        other.id !== request.id &&
        other.user_id !== request.user_id &&
        other.department_id === request.department_id &&
        other.status === 'approved' &&
        other.start_date <= request.end_date &&
        other.end_date >= request.start_date
      ) {
        const person = peopleById.get(other.user_id);
        if (person?.role === 'staff' || person?.role === 'manager') {
          others.add(person.full_name);
        }
      }
    }
    return [...others].sort();
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
  const staff = profiles.filter((p) => p.role === 'staff');

  // Requests cannot span calendar years under the leave policy.
  // Use the start year so each request is counted exactly once.
  const yearRequests = requests.filter((r) =>
    r.start_date.startsWith(`${year}-`)
  );
  const yearCompanyRequests = yearRequests.filter((r) => {
    const role = peopleById.get(r.user_id)?.role;
    return role === 'staff' || role === 'manager';
  });

  // Allocate rounding remainders so the four percentages total 100.
  const statusCounts = LEAVE_STATUSES.map((status) =>
    yearCompanyRequests.filter((r) => r.status === status).length
  );
  const statusTotal = yearCompanyRequests.length;
  const statusPercentages = statusCounts.map((count) =>
    statusTotal ? Math.floor((count * 100) / statusTotal) : 0
  );
  if (statusTotal) {
    const remaining = 100 - statusPercentages.reduce((sum, pct) => sum + pct, 0);
    const byRemainder = statusCounts
      .map((count, index) => ({ index, remainder: (count * 100) % statusTotal }))
      .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
    for (let i = 0; i < remaining; i += 1) {
      statusPercentages[byRemainder[i].index] += 1;
    }
  }

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

  // The dashboard is a short preview, not the full HR approval queue.
  // Use the actual current month, independently of the dashboard year selector.
  const currentMonth = todayKey.slice(0, 7);
  const dashboardPendingManagers = pendingManagers
    .filter((request) => request.start_date.startsWith(currentMonth))
    .sort((a, b) =>
      b.start_date.localeCompare(a.start_date) ||
      b.created_at.localeCompare(a.created_at)
    )
    .slice(0, 2);

  // Company-wide view: Staff and Managers across every department.
  // Supabase RLS determines which records HR is permitted to read.
  const companyRequests = useMemo(
    () => requests
      .filter((request) => {
        const role = peopleById.get(request.user_id)?.role;
        return role === 'staff' || role === 'manager';
      })
      .sort((a, b) =>
        b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)
      ),
    [requests, peopleById]
  );

  const filteredCompanyRequests = companyRequests.filter((request) => {
    const role = peopleById.get(request.user_id)?.role;
    return (
      (!requestsDepartment || request.department_id === requestsDepartment) &&
      (!requestsRole || role === requestsRole) &&
      (!requestName.trim() || (peopleById.get(request.user_id)?.full_name ?? '')
        .toLowerCase().includes(requestName.trim().toLowerCase())) &&
      (!requestsStatus || request.status === requestsStatus)
    );
  });

  const requestPageSize = 25;
  const requestPageCount = Math.max(
    1,
    Math.ceil(filteredCompanyRequests.length / requestPageSize)
  );
  const currentRequestsPage = Math.min(requestsPage, requestPageCount);
  const displayedCompanyRequests = filteredCompanyRequests.slice(
    (currentRequestsPage - 1) * requestPageSize,
    currentRequestsPage * requestPageSize
  );

  // Only staff on currently approved leave are counted in this card.
  const approvedToday = staff.filter((person) =>
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

  // Year picker also refreshes the selected employee's balance.
  useEffect(() => {
    if (!selectedUserId) return;
    let active = true;
    setBalanceLoading(true);
    void supabase.rpc('leave_balance', {
      p_user: selectedUserId,
      p_year: year,
    }).then(({ data, error: balanceError }) => {
      if (!active) return;
      if (balanceError) {
        setError(balanceError.message);
        setBalance(null);
      } else {
        setBalance((data as Balance[] | null)?.[0] ?? null);
      }
      setBalanceLoading(false);
    });
    return () => { active = false; };
  }, [year, selectedUserId]);

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
      await loadData(true);
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
    // Never offer HR review actions for Staff requests.
    const target = requests.find((r) => r.id === requestId);
    if (!target || target.status !== 'pending' ||
        peopleById.get(target.user_id)?.role !== 'manager') {
      setError('Only pending Department Head requests can be reviewed by HR.');
      return;
    }
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
      await loadData(true);
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

      // Filter by leave START date, inclusive of the cutoff and today.
      const today = new Date();
      const cutoff = new Date(today.getFullYear(), today.getMonth() - reportMonths, today.getDate());
      const cutoffKey = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;
      const todayKeyForExport = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const exportRequests = requests.filter((request) =>
        request.start_date >= cutoffKey && request.start_date <= todayKeyForExport
      );
      // Each row is one request; never export more than HR may read.
      for (const request of exportRequests) {
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

      setMessage(`${exportRequests.length} leave records exported for the past ${reportMonths} month(s).`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to export Excel records.'
      );
    } finally {
      setBusy(false);
    }
  }

  function renderCompanyRequestsTable(records: Request[]) {
    if (records.length === 0) {
      return <p>No leave requests match the selected filters.</p>;
    }

    return (
      <div className="hr-table-scroll">
        <table className="hr-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Role</th>
              <th>Department</th>
              <th>Leave Type</th>
              <th>Start Date</th>
              <th>End Date</th>
              <th>Days</th>
              <th>Status</th>
              <th>Approved By</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {records.map((request) => {
              const employeeRole = peopleById.get(request.user_id)?.role;
              const canHRReview =
                employeeRole === 'manager' && request.status === 'pending';
              const leaveType =
                request.leave_type === 'annual'
                  ? 'Annual Leave'
                  : request.leave_type === 'sick'
                    ? 'Sick Leave'
                    : 'Unpaid Leave';

              return (
                <tr key={request.id}>
                  <td data-label="Employee">{personName(request.user_id)}</td>
                  <td data-label="Role">
                    {employeeRole === 'manager' ? 'Manager' : 'Staff'}
                  </td>
                  <td data-label="Department">
                    {departmentName(request.department_id)}
                  </td>
                  <td data-label="Leave Type">{leaveType}</td>
                  <td data-label="Start Date">{formatDate(request.start_date)}</td>
                  <td data-label="End Date">{formatDate(request.end_date)}</td>
                  <td data-label="Days">{request.working_days}</td>
                  <td data-label="Status">
                    <span className={`hr-status ${request.status}`}>
                      {request.status.charAt(0).toUpperCase() + request.status.slice(1)}
                    </span>
                  </td>
                  <td data-label="Approved By">
                    {request.status === 'approved'
                      ? personName(request.decided_by)
                      : '—'}
                  </td>
                  <td data-label="Action">
                    {canHRReview ? (
                      <div className="hr-actions">
                        <button
                          type="button"
                          className="hr-button approve"
                          disabled={busy}
                          onClick={() => void reviewRequest(request.id, 'approved')}
                        >
                          ✓ Approve
                        </button>
                        <button
                          type="button"
                          className="hr-button reject"
                          disabled={busy}
                          onClick={() => void reviewRequest(request.id, 'rejected')}
                        >
                          × Reject
                        </button>
                      </div>
                    ) : request.status === 'pending' ? (
                      <span>Department manager review</span>
                    ) : (
                      <span>—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
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
    <div className={`hr-leavedesk${view === 'hr' ? ' hr-overview-desktop' : ''}${view === 'hr' && showAddEmployee ? ' hr-add-open' : ''}`}>
      <div className="hr-page">
        {error && (
          <p className="error" role="alert">{error}</p>
        )}

        {message && (
          <p className="success" role="status">{message}</p>
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
                label="On Leave Today"
                value={approvedToday}
                color="green"
              />
              <Stat
                icon="▣"
                label="Avg. Annual Leave Balance"
                value={averageBalance(staff)}
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
                          <th
                            className="hr-approved-month-heading"
                            style={{
                              width: 76,
                              maxWidth: 76,
                              whiteSpace: 'normal',
                              overflowWrap: 'break-word',
                              lineHeight: 1.25,
                              textAlign: 'center',
                            }}
                          >
                            Approved Leaves This Month
                          </th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {departments.map((dept) => {
                          const people = staff.filter(
                            (p) => p.department_id === dept.id
                          );

                          const deptPending = pendingStaff.filter(
                            (r) => r.department_id === dept.id
                          ).length;

                          const onLeave = people.filter(
                            (p) => onLeaveToday(p.id)
                          ).length;

                          // Count approved requests overlapping the current
                          // calendar month (including Manager leave).
                          const monthStart = `${todayKey.slice(0, 7)}-01`;
                          const nextMonthStart = new Date(
                            Date.UTC(today.getFullYear(), today.getMonth() + 1, 1)
                          ).toISOString().slice(0, 10);
                          const approvedThisMonth = requests.filter((request) => {
                            const role = peopleById.get(request.user_id)?.role;
                            return (
                              request.department_id === dept.id &&
                              request.status === 'approved' &&
                              (role === 'staff' || role === 'manager') &&
                              request.start_date < nextMonthStart &&
                              request.end_date >= monthStart
                            );
                          }).length;

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
                              <td data-label="Approved Leaves This Month" style={{ textAlign: 'center' }}>
                                {approvedThisMonth}
                              </td>
                              <td data-label="Action">
                                <button
                                  type="button"
                                  className="hr-button outline hr-view-department"
                                  aria-label={`View ${dept.name} department`}
                                  title={`View ${dept.name} department`}
                                  onClick={() => {
                                    setDepartmentFilter(dept.id);
                                    setEmployeePickerOpen(true);
                                    setEmployeeSearch('');
                                    setSelectedUserId('');
                                    setBalance(null);
                                    onNavigate('hr-employees');
                                  }}
                                >
                                  View
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
                  subtitle="Up to 2 pending Manager applications starting this month."
                >
                  {dashboardPendingManagers.length === 0 ? (
                    <p style={{ margin: '4px 0' }}>No pending Department Head requests for this month.</p>
                  ) : (
                    <div className="hr-table-scroll">
                      <table className="hr-table hr-head-approval-table">
                        <thead>
                          <tr>
                            <th>Applicant</th>
                            <th>Department</th>
                            <th>Leave Type</th>
                            <th>Dates</th>
                            <th>Days</th>
                            <th>Approved Leave Queue</th>
                            <th>Decision</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dashboardPendingManagers.map((r) => {
                            const conflicts = overlappingApprovedStaff(r);
                            return (
                              <tr key={r.id}>
                                <td data-label="Applicant">{personName(r.user_id)}</td>
                                <td data-label="Department">{departmentName(r.department_id)}</td>
                                <td data-label="Leave Type" className="hr-head-leave-type">
                                  {leaveTypeLabel(r.leave_type)}
                                </td>
                                <td data-label="Dates" className="hr-head-leave-dates">
                                  <span>{formatDate(r.start_date)}</span>
                                  <span>to {formatDate(r.end_date)}</span>
                                </td>
                                <td data-label="Days">{r.working_days}</td>
                                <td data-label="Approved Leave Queue">
                                  {conflicts.length === 0
                                    ? 'None'
                                    : `${conflicts.length}: ${conflicts.slice(0, 3).join(', ')}${conflicts.length > 3 ? '…' : ''}`}
                                </td>
                                <td data-label="Decision">
                                  <div className="hr-actions">
                                    <button type="button" className="hr-button approve" disabled={busy}
                                      onClick={() => void reviewRequest(r.id, 'approved')}>
                                      ✓ Approve
                                    </button>
                                    <button type="button" className="hr-button reject" disabled={busy}
                                      onClick={() => void reviewRequest(r.id, 'rejected')}>
                                      × Reject
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Panel>
              </div>

              <div className="hr-span-6">
                <Panel
                  title="Company-Wide Leave Requests (Recent 5)"
                  subtitle="Latest Staff and Manager requests from all departments."
                >
                  {renderCompanyRequestsTable(companyRequests.slice(0, 5))}
                  <p style={{ marginTop: 12 }}>
                    Showing {Math.min(5, companyRequests.length)} of{' '}
                    {companyRequests.length} company requests.
                  </p>
                  <button
                    type="button"
                    className="hr-button outline"
                    onClick={() => onNavigate('hr-requests')}
                  >
                    View All Leave Requests ›
                  </button>
                </Panel>
              </div>

              <div className="hr-span-4">
                <Panel
                  title="Company Leave Status"
                  subtitle={`Staff and Manager requests for ${year}.`}
                >
                  <div className="hr-status-visual">
                    <div
                      className="hr-status-donut"
                      style={{
                        background: `conic-gradient(#38bd60 0% ${statusTotal ? statusCounts[0] / statusTotal * 100 : 0}%, #fbbf24 ${statusTotal ? statusCounts[0] / statusTotal * 100 : 0}% ${statusTotal ? (statusCounts[0] + statusCounts[1]) / statusTotal * 100 : 0}%, #f87171 ${statusTotal ? (statusCounts[0] + statusCounts[1]) / statusTotal * 100 : 0}% ${statusTotal ? (statusCounts[0] + statusCounts[1] + statusCounts[2]) / statusTotal * 100 : 0}%, #a855f7 ${statusTotal ? (statusCounts[0] + statusCounts[1] + statusCounts[2]) / statusTotal * 100 : 0}% ${statusTotal ? (statusCounts[0] + statusCounts[1] + statusCounts[2] + statusCounts[3]) / statusTotal * 100 : 0}%, #3b82f6 ${statusTotal ? (statusCounts[0] + statusCounts[1] + statusCounts[2] + statusCounts[3]) / statusTotal * 100 : 0}% 100%)`
                      }}
                      aria-label={`${statusTotal} total requests in ${year}`}
                    >
                      <div><strong>{statusTotal.toLocaleString('en-IN')}</strong><span>Requests</span></div>
                    </div>
                    <table className="hr-table">
                    <thead>
                      <tr>
                        <th>Status</th>
                        <th>Requests</th>
                        <th>% of Total</th>
                      </tr>
                    </thead>
                     
<tbody>
                      {LEAVE_STATUSES.map((status, index) => (
                        <tr key={status}>
                          <td data-label="Status">
                            <span className={`hr-status ${status}`}>
                              {status.charAt(0).toUpperCase() + status.slice(1)}
                            </span>
                          </td>
                          <td data-label="Requests">{statusCounts[index]}</td>
                          <td data-label="% of Total">{statusPercentages[index]}%</td>
                        </tr>
                      ))}
                      <tr>
                        <td data-label="Status"><strong>Total ({year})</strong></td>
                        <td data-label="Requests"><strong>{statusTotal}</strong></td>
                        <td data-label="% of Total"><strong>{statusTotal ? 100 : 0}%</strong></td>
                      </tr>
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
                      aria-expanded={showAddEmployee}
                      aria-controls="hr-add-employee-form"
                      onClick={() => setShowAddEmployee((open) => !open)}
                    >
                      {showAddEmployee ? '− Close Add Employee' : '+ Add Employee'}
                    </button>
                    {showAddEmployee && (
                      <div
                        id="hr-add-employee-form"
                        style={{ width: '100%', minWidth: 0 }}
                      >
                        <AddEmployeeForm
                          departments={departments}
                          onClose={() => setShowAddEmployee(false)}
                          onCreated={async () => {
                            setShowAddEmployee(false);
                            setMessage('Employee account created successfully.');
                            await loadData(true);
                          }}
                        />
                      </div>
                    )}
                    <label className="hr-export-range">
                      Report period
                      <select value={reportMonths} onChange={(e) => setReportMonths(Number(e.target.value) as 1 | 3 | 6 | 12)}>
                        <option value={1}>Last 1 month</option>
                        <option value={3}>Last 3 months</option>
                        <option value={6}>Last 6 months</option>
                        <option value={12}>Last 1 year</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      className="hr-button primary"
                      disabled={busy}
                      onClick={() => void exportExcel()}
                    >
                      {busy ? 'Preparing Excel...' : 'Export Leave Records (Excel)'}
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
            title="Company-Wide Leave Requests"
            subtitle="Staff and Manager leave requests across all departments. HR can review pending Manager requests."
          >
            <div className="hr-filters" style={{ marginBottom: 16 }}>
              <label>
                Department
                <select
                  value={requestsDepartment}
                  onChange={(event) => {
                    setRequestsDepartment(event.target.value);
                    setRequestsPage(1);
                  }}
                >
                  <option value="">All departments</option>
                  {departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Employee Name
                <input
                  type="search"
                  value={requestName}
                  onChange={(event) => {
                    setRequestName(event.target.value);
                    setRequestsPage(1);
                  }}
                  placeholder="Search employee name"
                  aria-label="Filter leave requests by employee name"
                />
              </label>
              <label>
                Employee Role
                <select
                  value={requestsRole}
                  onChange={(event) => {
                    setRequestsRole(event.target.value);
                    setRequestsPage(1);
                  }}
                >
                  <option value="">Staff and Managers</option>
                  <option value="staff">Staff only</option>
                  <option value="manager">Managers only</option>
                </select>
              </label>
              <label>
                Status
                <select
                  value={requestsStatus}
                  onChange={(event) => {
                    setRequestsStatus(event.target.value);
                    setRequestsPage(1);
                  }}
                >
                  <option value="">All statuses</option>
                  {LEAVE_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status.charAt(0).toUpperCase() + status.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p>
              Showing {displayedCompanyRequests.length} of{' '}
              <strong>{filteredCompanyRequests.length}</strong> matching requests
              {' '}({companyRequests.length} company-wide).
            </p>
            {renderCompanyRequestsTable(displayedCompanyRequests)}
            {requestPageCount > 1 && (
              <div className="hr-actions" style={{ alignItems: 'center', marginTop: 16 }}>
                <button
                  type="button"
                  className="hr-button outline"
                  disabled={currentRequestsPage === 1}
                  onClick={() => setRequestsPage((page) => Math.max(1, page - 1))}
                >
                  Previous
                </button>
                <span>Page {currentRequestsPage} of {requestPageCount}</span>
                <button
                  type="button"
                  className="hr-button outline"
                  disabled={currentRequestsPage >= requestPageCount}
                  onClick={() => setRequestsPage((page) => Math.min(requestPageCount, page + 1))}
                >
                  Next
                </button>
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
            subtitle="Select a department, search for a name, then open the employee balance."
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
                    setEmployeeSearch('');
                    setEmployeePickerOpen(true);
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
                  onFocus={() => setEmployeePickerOpen(true)}
                  onChange={(e) => {
                    setEmployeeSearch(e.target.value);
                    setEmployeePickerOpen(true);
                  }}
                  placeholder="Name or email"
                />
              </label>
            </div>

            <div className="hr-employee-picker" style={{ marginTop: 10 }}>
              <button
                type="button"
                className="hr-button outline"
                aria-expanded={employeePickerOpen}
                onClick={() => setEmployeePickerOpen((open) => !open)}
              >
                {employeePickerOpen ? 'Hide employee names' : 'Choose employee'}
              </button>
              {employeePickerOpen && (
                <div className="hr-employee-options" role="group" aria-label="Matching employees">
                  {filteredEmployees.length === 0 ? (
                    <p>No matching employees.</p>
                  ) : filteredEmployees.slice(0, 30).map((person) => (
                    <button
                      key={person.id}
                      type="button"
                      className="hr-employee-option"
                      onClick={() => {
                        setEmployeeSearch(person.full_name);
                        setEmployeePickerOpen(false);
                        void selectEmployee(person);
                      }}
                    >
                      {person.full_name}
                      <small>{departmentName(person.department_id)}</small>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="hr-employee-add" style={{ marginTop: 14 }}>
              <button
                type="button"
                className="hr-button primary"
                aria-expanded={showAddEmployee}
                onClick={() => setShowAddEmployee((open) => !open)}
              >
                {showAddEmployee ? '− Close Add Employee' : '+ Add Employee'}
              </button>
              {showAddEmployee && (
                <div className="hr-employee-add-form">
                  <AddEmployeeForm
                    departments={departments}
                    onClose={() => setShowAddEmployee(false)}
                    onCreated={async () => {
                      setShowAddEmployee(false);
                      setMessage('Employee account created successfully.');
                      await loadData(true);
                    }}
                  />
                </div>
              )}
            </div>

            {selectedEmployee && (
              <section className="hr-selected-employee">
                <h3>{selectedEmployee.full_name}</h3>
                <p>
                  {selectedEmployee.email} · {departmentName(selectedEmployee.department_id)}
                  {' · '}{selectedEmployee.role === 'manager' ? 'Manager' : selectedEmployee.role === 'staff' ? 'Staff' : 'HR'}
                </p>

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
                    <Stat
                      icon="▣"
                      label="Remaining"
                      value={balance.remaining ?? 'Not assigned'}
                      color="lavender"
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
              <label className="hr-export-range">
                Report period
                <select value={reportMonths} onChange={(e) => setReportMonths(Number(e.target.value) as 1 | 3 | 6 | 12)}>
                  <option value={1}>Last 1 month</option><option value={3}>Last 3 months</option>
                  <option value={6}>Last 6 months</option><option value={12}>Last 1 year</option>
                </select>
              </label>
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
                Total records available to HR: <strong>{requests.length}</strong>
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
