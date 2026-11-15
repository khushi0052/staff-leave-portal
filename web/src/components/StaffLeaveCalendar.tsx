import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';

type CalendarRequest = {
  id: string;
  start_date: string;
  end_date: string;
  leave_type: 'annual' | 'sick' | 'unpaid';
  status: 'approved' | 'pending';
};

type Props = { userId: string; refreshKey: number };

function dateKey(year: number, monthIndex: number, day: number): string {
  const d = new Date(year, monthIndex, day);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function StaffLeaveCalendar({ userId, refreshKey }: Props) {
  const now = new Date();
  const [month, setMonth] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1));
  const [selected, setSelected] = useState(() => dateKey(now.getFullYear(), now.getMonth(), now.getDate()));
  const [requests, setRequests] = useState<CalendarRequest[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  useEffect(() => {
    let active = true;
    async function loadMonth() {
      setLoading(true);
      setError('');
      const start = dateKey(year, monthIndex, 1);
      const end = dateKey(year, monthIndex + 1, 0);
      const { data, error: requestError } = await supabase.from('leave_requests')
        .select('id, start_date, end_date, leave_type, status')
        .eq('user_id', userId)
        .in('status', ['approved', 'pending'])
        .lte('start_date', end)
        .gte('end_date', start)
        .order('start_date');
      if (active) {
        if (requestError) {
          setError(requestError.message);
          setRequests([]);
        } else {
          setRequests((data ?? []) as CalendarRequest[]);
        }
        setLoading(false);
      }
    }
    void loadMonth();
    return () => { active = false; };
  }, [userId, refreshKey, year, monthIndex]);

  const firstDayOffset = (new Date(year, monthIndex, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells = Array.from({ length: firstDayOffset + daysInMonth }, (_, i) => i - firstDayOffset + 1);
  const selectedRequests = useMemo(() => requests.filter(r =>
    r.start_date <= selected && r.end_date >= selected
  ), [requests, selected]);

  function shiftMonth(delta: number) {
    const newMonth = new Date(year, monthIndex + delta, 1);
    setMonth(newMonth);
    setSelected(dateKey(newMonth.getFullYear(), newMonth.getMonth(), 1));
  }

  return (
    <div className="sl-calendar">
      <style>{`
        .sl-calendar{max-width:920px;margin:auto;color:#10234f}
        .sl-calendar .sl-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px}
        .sl-calendar .sl-head h2{margin:0;font-size:19px}
        .sl-calendar .sl-nav{display:flex;align-items:center;gap:8px}
        .sl-calendar .sl-nav button{border:1px solid #dbe4f0;border-radius:7px;background:#fff;padding:6px 12px;cursor:pointer}
        .sl-calendar .sl-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:5px}
        .sl-calendar .sl-weekday{text-align:center;font-size:11px;font-weight:700;padding:7px;color:#64748b}
        .sl-calendar .sl-day{min-height:65px;padding:7px;border:1px solid #e0e7f0;border-radius:8px;background:#fff;text-align:left;cursor:pointer;display:flex;flex-direction:column;gap:5px}
        .sl-calendar .sl-day.selected{border:2px solid #1d4ed8;background:#eff6ff}
        .sl-calendar .sl-day.today .sl-number{font-weight:800;color:#1d4ed8}
        .sl-calendar .sl-number{font-size:12px}
        .sl-calendar .sl-dots{display:flex;gap:3px;flex-wrap:wrap}
        .sl-calendar .sl-dot{width:8px;height:8px;border-radius:50%;background:#16a34a}
        .sl-calendar .sl-dot.pending{background:#d97706}
        .sl-calendar .sl-legend{display:flex;gap:16px;font-size:12px;margin-top:12px}
        .sl-calendar .sl-detail{margin-top:12px;padding:10px;border-radius:8px;background:#f8fafc;font-size:13px}
        @media(max-width:600px){.sl-calendar .sl-grid{gap:3px}.sl-calendar .sl-day{min-height:51px;padding:4px}.sl-calendar .sl-head h2{font-size:16px}}
      `}</style>
      <div className="sl-head">
        <div><h2>My Leave Calendar</h2><span style={{ fontSize: 12, color: '#64748b' }}>Your approved and pending leave dates</span></div>
        <div className="sl-nav">
          <button type="button" onClick={() => shiftMonth(-1)} aria-label="Previous month">‹</button>
          <strong>{month.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</strong>
          <button type="button" onClick={() => shiftMonth(1)} aria-label="Next month">›</button>
        </div>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="sl-grid">
        {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day => <div key={day} className="sl-weekday">{day}</div>)}
        {cells.map((day, index) => {
          if (day < 1) return <div key={`empty-${index}`} aria-hidden="true" />;
          const key = dateKey(year, monthIndex, day);
          const matches = requests.filter(r => r.start_date <= key && r.end_date >= key);
          return (
            <button key={key} type="button" className={`sl-day${key === selected ? ' selected' : ''}${key === dateKey(now.getFullYear(), now.getMonth(), now.getDate()) ? ' today' : ''}`} onClick={() => setSelected(key)} aria-label={`${day} ${month.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}: ${matches.length} leave request(s)`} aria-pressed={key === selected}>
              <span className="sl-number">{day}</span>
              <span className="sl-dots">{matches.map(r => <span key={r.id} className={`sl-dot ${r.status}`} title={`${r.leave_type} — ${r.status}`} />)}</span>
            </button>
          );
        })}
      </div>
      <div className="sl-legend"><span>🟢 Approved</span><span>🟠 Pending</span></div>
      <div className="sl-detail" aria-live="polite">
        <strong>{new Date(`${selected}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</strong>
        {loading ? <p>Loading...</p> : selectedRequests.length === 0 ? <p>No scheduled leave.</p> :
          selectedRequests.map(r => <p key={r.id} style={{ margin: '6px 0' }}>{r.leave_type[0].toUpperCase() + r.leave_type.slice(1)} Leave — <strong style={{ color: r.status === 'approved' ? '#15803d' : '#b45309' }}>{r.status}</strong> ({r.start_date} to {r.end_date})</p>)}
      </div>
    </div>
  );
}
