
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

type Role = 'staff' | 'manager' | 'hr';

type TeamCalendarProps = {
  userId: string;
  role: Role;
  departmentId: string | null;
  refreshKey?: number;
};

type Employee = {
  id: string;
  full_name: string;
  department_id: string | null;
};

type LeaveEntry = {
  id: string;
  user_id: string;
  leave_type: 'annual' | 'sick' | 'unpaid';
  start_date: string;
  end_date: string;
  status: 'approved' | 'pending';
};

function dateKey(year: number, month: number, day: number) {
  return (
    `${year}-${String(month + 1).padStart(2, '0')}-` +
    String(day).padStart(2, '0')
  );
}

function formatDate(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString(
    'en-IN',
    { day: 'numeric', month: 'short', year: 'numeric' }
  );
}

export default function TeamCalendar({
  userId,
  role,
  departmentId,
  refreshKey = 0,
}: TeamCalendarProps) {
  const today = new Date();

  const [month, setMonth] = useState(today.getMonth());
  const [year, setYear] = useState(today.getFullYear());
  const [selectedDay, setSelectedDay] = useState(today.getDate());

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [leaves, setLeaves] = useState<LeaveEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const firstDate = dateKey(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const lastDate = dateKey(year, month, daysInMonth);
  const firstWeekday = new Date(year, month, 1).getDay();

  useEffect(() => {
    let active = true;

    async function loadCalendar() {
      setLoading(true);
      setError('');

      try {
        // RLS determines which profiles the session can read.
        const { data: people, error: peopleError } =
          await supabase
            .from('profiles')
            .select('id, full_name, department_id')
            .limit(1000);

        if (peopleError) throw peopleError;

        // Only select the fields needed for the calendar.
        // Never fetch employee reasons or decision comments.
        const allLeaves: LeaveEntry[] = [];
        const pageSize = 500;

        for (let offset = 0; ; offset += pageSize) {
          const { data, error: leaveError } =
            await supabase
              .from('leave_requests')
              .select(
                'id, user_id, leave_type, start_date, end_date, status'
              )
              .in('status', ['approved', 'pending'])
              .lte('start_date', lastDate)
              .gte('end_date', firstDate)
              .order('id')
              .range(offset, offset + pageSize - 1);

          if (leaveError) throw leaveError;

          const page = (data ?? []) as LeaveEntry[];
          allLeaves.push(...page);

          if (page.length < pageSize) break;
        }

        if (!active) return;

        const visiblePeople = (people ?? []) as Employee[];
        const employeeById = new Map(
          visiblePeople.map((person) => [person.id, person])
        );

        // Show only approved team leave or the user's own
        // pending leave. HR may view approved leave across
        // departments, subject to database permissions.
        const visibleLeaves = allLeaves.filter((entry) => {
          if (entry.user_id === userId) {
            return true;
          }

          if (entry.status !== 'approved') {
            return false;
          }

          if (role === 'hr') {
            return true;
          }

          const person = employeeById.get(entry.user_id);

          return (
            departmentId !== null &&
            person?.department_id === departmentId
          );
        });

        setEmployees(visiblePeople);
        setLeaves(visibleLeaves);
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : 'Unable to load calendar.'
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadCalendar();

    return () => {
      active = false;
    };
  }, [
    userId,
    role,
    departmentId,
    firstDate,
    lastDate,
    refreshKey,
  ]);

  function changeMonth(direction: number) {
    const next = new Date(year, month + direction, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth());
    setSelectedDay(1);
  }

  function nameFor(userIdToFind: string) {
    if (userIdToFind === userId) {
      return 'You';
    }

    return (
      employees.find((person) => person.id === userIdToFind)
        ?.full_name ?? 'Team member'
    );
  }

  function leavesForDay(day: number) {
    const date = dateKey(year, month, day);

    return leaves.filter(
      (leave) =>
        leave.start_date <= date &&
        leave.end_date >= date
    );
  }

  const selectedLeaves = leavesForDay(selectedDay);

  const calendarCells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from(
      { length: daysInMonth },
      (_, index) => index + 1
    ),
  ];

  return (
    <section className="team-calendar">
      <div className="calendar-header">
        <div>
          <h2>Team Leave Calendar</h2>
          <p>
            Approved team leave and your own pending requests.
          </p>
        </div>

        <div className="calendar-navigation">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => changeMonth(-1)}
          >
            ‹
          </button>

          <strong>
            {new Date(year, month, 1).toLocaleDateString(
              'en-IN',
              { month: 'long', year: 'numeric' }
            )}
          </strong>

          <button
            type="button"
            aria-label="Next month"
            onClick={() => changeMonth(1)}
          >
            ›
          </button>
        </div>
      </div>

      <div className="calendar-legend">
        <span>
          <i className="calendar-dot approved-dot" />
          Approved
        </span>

        <span>
          <i className="calendar-dot pending-dot" />
          My pending leave
        </span>
      </div>

      {error && (
        <p className="error" role="alert">{error}</p>
      )}

      {loading ? (
        <p>Loading calendar...</p>
      ) : (
        <>
          <div className="calendar-grid">
            {[
              'Sun', 'Mon', 'Tue', 'Wed',
              'Thu', 'Fri', 'Sat',
            ].map((label) => (
              <div className="calendar-weekday" key={label}>
                {label}
              </div>
            ))}

            {calendarCells.map((day, index) => {
              if (day === null) {
                return (
                  <div
                    className="calendar-empty"
                    key={`empty-${index}`}
                  />
                );
              }

              const dayLeaves = leavesForDay(day);

              const hasApproved = dayLeaves.some(
                (leave) => leave.status === 'approved'
              );

              const hasPending = dayLeaves.some(
                (leave) => leave.status === 'pending'
              );

              const isToday =
                year === today.getFullYear() &&
                month === today.getMonth() &&
                day === today.getDate();

              return (
                <button
                  type="button"
                  key={day}
                  className={[
                    'calendar-day',
                    selectedDay === day ? 'selected' : '',
                    isToday ? 'today' : '',
                  ].join(' ')}
                  aria-label={
                    `${formatDate(dateKey(year, month, day))}, ` +
                    `${dayLeaves.length} leave entries`
                  }
                  aria-pressed={selectedDay === day}
                  onClick={() => setSelectedDay(day)}
                >
                  <span>{day}</span>

                  <span className="calendar-day-dots">
                    {hasApproved && (
                      <i className="calendar-dot approved-dot" />
                    )}

                    {hasPending && (
                      <i className="calendar-dot pending-dot" />
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="calendar-details">
            <h3>
              {formatDate(dateKey(year, month, selectedDay))}
            </h3>

            {selectedLeaves.length === 0 ? (
              <p>No visible leave scheduled for this date.</p>
            ) : (
              <div className="calendar-events">
                {selectedLeaves.map((leave) => (
                  <article
                    className="calendar-event"
                    key={leave.id}
                  >
                    <div>
                      <strong>{nameFor(leave.user_id)}</strong>

                      <p>
                        {leave.leave_type.toUpperCase()} Leave
                      </p>

                      <small>
                        {formatDate(leave.start_date)}
                        {' – '}
                        {formatDate(leave.end_date)}
                      </small>
                    </div>

                    <span
                      className={
                        `calendar-status ${leave.status}`
                      }
                    >
                      {leave.status}
                    </span>
                  </article>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
