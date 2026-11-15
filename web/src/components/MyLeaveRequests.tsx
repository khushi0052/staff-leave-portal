import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import EditLeaveForm from './EditLeaveForm';

type LeaveType = 'annual' | 'sick' | 'unpaid';
type Status = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'withdrawn';
type LeaveRequest = {
  id: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  working_days: number;
  status: Status;
  reason: string | null;
  decision_comment: string | null;
  decided_by: string | null;
  updated_at: string;
  created_at: string;
};

type Props = {
  userId: string;
  refreshKey: number;
  onChanged: () => void;
  year?: number;
};

function formatDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function leaveLabel(type: LeaveType): string {
  return type === 'annual' ? 'Annual Leave' : type === 'sick' ? 'Sick Leave' : 'Unpaid Leave';
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function nextWorkingDay(endDate: string, holidays: Set<string>): string | null {
  const [y, m, d] = endDate.split('-').map(Number);
  const day = new Date(y, m - 1, d + 1);
  for (let attempts = 0; attempts < 366; attempts += 1) {
    const key = dateKey(day);
    if (day.getDay() !== 0 && day.getDay() !== 6 && !holidays.has(key)) return key;
    day.setDate(day.getDate() + 1);
  }
  return null;
}

export default function MyLeaveRequests({ userId, refreshKey, onChanged, year }: Props) {
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [holidays, setHolidays] = useState<Set<string>>(new Set());
  const [approvers, setApprovers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [yearFilter, setYearFilter] = useState(String(year ?? new Date().getFullYear()));
  const [actionId, setActionId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (year !== undefined) setYearFilter(String(year));
  }, [year]);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError('');
      try {
        // Read ALL history, including withdrawn and cancelled; never delete records.
        const records: LeaveRequest[] = [];
        const pageSize = 500;
        for (let start = 0; ; start += pageSize) {
          const { data, error: requestError } = await supabase.from('leave_requests')
            .select('id, leave_type, start_date, end_date, working_days, status, reason, decision_comment, decided_by, created_at, updated_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .range(start, start + pageSize - 1);
          if (requestError) throw requestError;
          const page = (data ?? []) as LeaveRequest[];
          records.push(...page);
          if (page.length < pageSize) break;
        }

        const holidaySet = new Set<string>();
        if (records.length) {
          const oldest = records.reduce((min, r) => r.end_date < min ? r.end_date : min, records[0].end_date);
          const newest = records.reduce((max, r) => r.end_date > max ? r.end_date : max, records[0].end_date);
          const [y, m, d] = newest.split('-').map(Number);
          const upper = new Date(y, m - 1, d + 366);
          const { data: holidayData, error: holidayError } = await supabase.from('public_holidays')
            .select('date').gte('date', oldest).lte('date', dateKey(upper));
          if (holidayError) throw holidayError;
          for (const item of holidayData ?? []) holidaySet.add(item.date as string);
        }

        const ids = [...new Set(records.map(r => r.decided_by).filter((id): id is string => !!id))];
        const approverNames: Record<string, string> = {};
        if (ids.length) {
          const { data: people } = await supabase.from('profiles').select('id, full_name').in('id', ids);
          for (const p of people ?? []) approverNames[p.id as string] = p.full_name as string;
        }
        if (active) {
          setRequests(records);
          setHolidays(holidaySet);
          setApprovers(approverNames);
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Unable to load requests.');
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [userId, refreshKey]);

  const years = useMemo(() => {
    return [...new Set([new Date().getFullYear(), ...requests.map(r => Number(r.start_date.slice(0, 4)))])].sort((a, b) => b - a);
  }, [requests]);
  const filtered = useMemo(() => requests.filter(r =>
    (statusFilter === 'all' || r.status === statusFilter) &&
    (yearFilter === 'all' || r.start_date.startsWith(yearFilter))
  ), [requests, statusFilter, yearFilter]);

  async function withdraw(request: LeaveRequest) {
    if (request.status !== 'pending' || actionId !== null) return;
    if (!window.confirm('Withdraw this pending leave application? Reserved leave days will be released.')) return;
    setActionId(request.id);
    setError('');
    try {
      const { error: rpcError } = await supabase.rpc('withdraw_leave', { p_id: request.id });
      if (rpcError) throw rpcError;
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to withdraw request.');
    } finally {
      setActionId(null);
    }
  }

  return (
    <section className="my-requests staff-request-history">
      <style>{`
        .staff-request-history .sr-controls{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
        .staff-request-history .sr-controls label{display:flex;align-items:center;gap:6px;font-size:12px}
        .staff-request-history select{max-width:145px;padding:6px;border:1px solid #cbd5e1;border-radius:7px;background:#fff}
        .staff-request-history .sr-scroll{overflow-x:auto}
        .staff-request-history table{width:100%;border-collapse:collapse;font-size:12px}
        .staff-request-history th,.staff-request-history td{padding:9px 7px;border-bottom:1px solid #e5eaf2;text-align:left;vertical-align:middle}
        .staff-request-history th{background:#f1f5fb;white-space:nowrap;color:#10234f}
        .staff-request-history .sr-actions{display:flex;gap:6px;flex-wrap:wrap}
        .staff-request-history button{padding:5px 8px;font-size:12px;cursor:pointer}
        .staff-request-history .sr-details{padding:8px;background:#f8fafc;font-size:12px;line-height:1.6}
        .staff-request-history .sr-status{text-transform:capitalize;font-weight:700}
        .staff-request-history .sr-status.pending{color:#b45309}.staff-request-history .sr-status.approved{color:#15803d}
        .staff-request-history .sr-status.rejected{color:#b91c1c}.staff-request-history .sr-status.cancelled,.staff-request-history .sr-status.withdrawn{color:#64748b}
        @media(max-width:640px){.staff-request-history thead{display:none}.staff-request-history tr{display:block;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:8px;padding:5px}.staff-request-history td{display:flex;justify-content:space-between;gap:8px;padding:6px;border:0}.staff-request-history td::before{content:attr(data-label);font-weight:700;color:#334155}.staff-request-history td.sr-action-cell{display:block}.staff-request-history td.sr-action-cell::before{display:block;margin-bottom:5px}}
      `}</style>
      <h3>My Leave Requests</h3>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="sr-controls">
        <label>Status <select aria-label="Filter requests by status" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="all">All statuses</option>
          {(['pending','approved','rejected','withdrawn','cancelled'] as Status[]).map(s =>
            <option value={s} key={s}>{s[0].toUpperCase() + s.slice(1)}</option>
          )}
        </select></label>
        <label>Year <select aria-label="Filter requests by year" value={yearFilter} onChange={e => setYearFilter(e.target.value)}>
          <option value="all">All years</option>
          {years.map(y => <option value={y} key={y}>{y}</option>)}
        </select></label>
      </div>
      {loading ? <p>Loading your requests...</p> : filtered.length === 0 ? <p>No leave requests match these filters.</p> : (
        <div className="sr-scroll">
          <table>
            <thead><tr><th>Leave Type</th><th>Start Date</th><th>End Date</th><th>Days</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {filtered.map(request => {
                const isEditing = editingId === request.id;
                const isExpanded = expandedId === request.id;
                const reportingDate = nextWorkingDay(request.end_date, holidays);
                return (
                  <tr key={request.id}>
                    <td data-label="Leave Type">{leaveLabel(request.leave_type)}</td>
                    <td data-label="Start Date">{formatDate(request.start_date)}</td>
                    <td data-label="End Date">{formatDate(request.end_date)}</td>
                    <td data-label="Days">{request.working_days}</td>
                    <td data-label="Status"><span className={`sr-status ${request.status}`}>{request.status}</span></td>
                    <td data-label="Actions" className="sr-action-cell">
                      <div className="sr-actions">
                        <button type="button" onClick={() => setExpandedId(isExpanded ? null : request.id)}>{isExpanded ? 'Hide details' : 'Details'}</button>
                        {request.status === 'pending' && <>
                          <button type="button" disabled={actionId !== null} onClick={() => setEditingId(isEditing ? null : request.id)}>{isEditing ? 'Close Edit' : 'Edit'}</button>
                          <button type="button" disabled={actionId !== null} onClick={() => void withdraw(request)}>{actionId === request.id ? 'Withdrawing...' : 'Withdraw'}</button>
                        </>}
                      </div>
                      {isExpanded && <div className="sr-details">
                        <div><strong>Reason:</strong> {request.reason || 'Not provided'}</div>
                        <div><strong>Decision:</strong> {request.status[0].toUpperCase() + request.status.slice(1)}</div>
                        <div><strong>Approver:</strong> {request.decided_by ? (approvers[request.decided_by] || 'Approver') : 'Not yet reviewed'}</div>
                        <div><strong>Last status update:</strong> {request.decided_by ? formatDate(request.updated_at) : '—'}</div>
                        <div><strong>Comments:</strong> {request.decision_comment || (request.status === 'rejected' ? 'No reason recorded' : '—')}</div>
                        <div><strong>Reporting Date:</strong> {reportingDate ? formatDate(reportingDate) : 'Unavailable'}</div>
                      </div>}
                      {request.status === 'pending' && isEditing && (
                        <div className="sr-details"><EditLeaveForm
                          key={request.id}
                          request={{ id: request.id, leave_type: request.leave_type, start_date: request.start_date, end_date: request.end_date, reason: request.reason, status: 'pending' }}
                          onSuccess={() => { setEditingId(null); onChanged(); }}
                          onClose={() => setEditingId(null)}
                        /></div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
