
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

type Role = 'staff' | 'manager' | 'hr';

type LeaveStatus =
  | 'approved'
  | 'pending'
  | 'rejected'
  | 'cancelled';

type LeaveType = 'annual' | 'sick' | 'unpaid';

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
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  status: LeaveStatus;
};

const statusColors: Record<
  LeaveStatus,
  { background: string; text: string }
> = {
  pending: {
    background: '#FEF3C7',
    text: '#B45309',
  },
  approved: {
    background: '#DCFCE7',
    text: '#15803D',
  },
  rejected: {
    background: '#FEE2E2',
    text: '#B91C1C',
  },
  cancelled: {
    background: '#F3F4F6',
    text: '#4B5563',
  },
};

function dateKey(
  year: number,
  month: number,
  day: number
): string {
  return (
    `${year}-${String(month + 1).padStart(2, '0')}-` +
    String(day).padStart(2, '0')
  );
}

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

function formatLeaveType(type: LeaveType): string {
  if (type === 'annual') return 'Annual';
  if (type === 'sick') return 'Sick';
  return 'Unpaid';
}

function formatStatus(status: LeaveStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export default function TeamCalendar({
  userId,
  role,
  departmentId,
  refreshKey = 0,
}: TeamCalendarProps) {
  const now = new Date();

  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [selectedDay, setSelectedDay] = useState(
    now.getDate()
  );

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [leaves, setLeaves] = useState<LeaveEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const firstDate = dateKey(year, month, 1);

  const daysInMonth = new Date(
    year,
    month + 1,
    0
  ).getDate();

  const lastDate = dateKey(
    year,
    month,
    daysInMonth
  );

  const firstWeekday = new Date(
    year,
    month,
    1
  ).getDay();

  useEffect(() => {
    let active = true;

    async function loadCalendar() {
      setLoading(true);
      setError('');

      try {
        let visiblePeople: Employee[] = [];

        // Staff do not need other employees' profiles.
        // Managers and HR retain their existing behaviour.
        if (role !== 'staff') {
          const {
            data: people,
            error: peopleError,
          } = await supabase
            .from('profiles')
            .select(
              'id, full_name, department_id'
            )
            .limit(1000);

          if (peopleError) {
            throw peopleError;
          }

          visiblePeople = (people ?? []) as Employee[];
        }

        const allLeaves: LeaveEntry[] = [];
        const pageSize = 500;

        for (
          let offset = 0;
          ;
          offset += pageSize
        ) {
          // The database query is filtered by user ID
          // for Staff, before any leave records are fetched.
          //
          // Manager and HR continue to query approved
          // team/company leave and their own pending leave,
          // subject to existing RLS permissions.

          const baseQuery = supabase
            .from('leave_requests')
            .select(
              'id, user_id, leave_type, start_date, end_date, status'
            )
            .lte('start_date', lastDate)
            .gte('end_date', firstDate);

          const filteredQuery =
            role === 'staff'
              ? baseQuery.eq('user_id', userId)
              : baseQuery.in(
                  'status',
                  ['approved', 'pending']
                );

          const {
            data,
            error: leaveError,
          } = await filteredQuery
            .order('id')
            .range(
              offset,
              offset + pageSize - 1
            );

          if (leaveError) {
            throw leaveError;
          }

          const page = (data ?? []) as LeaveEntry[];

          allLeaves.push(...page);

          if (page.length < pageSize) {
            break;
          }
        }

        if (!active) return;

        const employeeById = new Map(
          visiblePeople.map(
            (person) => [person.id, person]
          )
        );

        const visibleLeaves = allLeaves.filter(
          (entry) => {
            // STAFF:
            // Only their own leave requests.
            // All four statuses are allowed.
            if (role === 'staff') {
              return entry.user_id === userId;
            }

            // MANAGER / HR:
            // Preserve the original behaviour.
            if (entry.user_id === userId) {
              return true;
            }

            if (entry.status !== 'approved') {
              return false;
            }

            if (role === 'hr') {
              return true;
            }

            const person = employeeById.get(
              entry.user_id
            );

            return (
              departmentId !== null &&
              person?.department_id === departmentId
            );
          }
        );

        setEmployees(visiblePeople);
        setLeaves(visibleLeaves);
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : 'Unable to load calendar.'
          );

          setLeaves([]);
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
    const next = new Date(
      year,
      month + direction,
      1
    );

    setYear(next.getFullYear());
    setMonth(next.getMonth());
    setSelectedDay(1);
  }

  function nameFor(
    userIdToFind: string
  ): string {
    if (userIdToFind === userId) {
      return 'You';
    }

    return (
      employees.find(
        (person) =>
          person.id === userIdToFind
      )?.full_name ?? 'Team member'
    );
  }

  function leavesForDay(
    day: number
  ): LeaveEntry[] {
    const date = dateKey(
      year,
      month,
      day
    );

    return leaves.filter(
      (leave) =>
        leave.start_date <= date &&
        leave.end_date >= date
    );
  }

  const selectedLeaves = leavesForDay(
    selectedDay
  );

  const calendarCells: (number | null)[] = [
    ...Array.from(
      { length: firstWeekday },
      () => null
    ),
    ...Array.from(
      { length: daysInMonth },
      (_, index) => index + 1
    ),
  ];

  const visibleStatuses: LeaveStatus[] =
    role === 'staff'
      ? [
          'approved',
          'pending',
          'rejected',
          'cancelled',
        ]
      : [
          'approved',
          'pending',
        ];

  return (
    <section className="team-calendar">
      <div className="calendar-header">
        <div>
          <h2>
            {role === 'staff'
              ? 'My Leave Calendar'
              : 'Team Leave Calendar'}
          </h2>

          <p>
            {role === 'staff'
              ? 'View your own approved, pending, rejected and cancelled leave requests.'
              : 'Approved team leave and your own pending requests.'}
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
            {new Date(
              year,
              month,
              1
            ).toLocaleDateString(
              'en-IN',
              {
                month: 'long',
                year: 'numeric',
              }
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

      {/* STATUS LEGEND */}

      <div className="calendar-legend">
        {visibleStatuses.map((status) => (
          <span key={status}>
            <i
              className="calendar-dot"
              aria-hidden="true"
              style={{
                backgroundColor:
                  statusColors[status].text,
              }}
            />

            {role !== 'staff' &&
            status === 'pending'
              ? 'My pending leave'
              : formatStatus(status)}
          </span>
        ))}
      </div>

      {error && (
        <p
          className="error"
          role="alert"
        >
          {error}
        </p>
      )}

      {loading ? (
        <p>Loading calendar...</p>
      ) : (
        <>
          {/* MONTH GRID */}

          <div className="calendar-grid">
            {[
              'Sun',
              'Mon',
              'Tue',
              'Wed',
              'Thu',
              'Fri',
              'Sat',
            ].map((label) => (
              <div
                className="calendar-weekday"
                key={label}
              >
                {label}
              </div>
            ))}

            {calendarCells.map(
              (day, index) => {
                if (day === null) {
                  return (
                    <div
                      className="calendar-empty"
                      key={`empty-${index}`}
                    />
                  );
                }

                const dayLeaves =
                  leavesForDay(day);

                const isToday =
                  year === now.getFullYear() &&
                  month === now.getMonth() &&
                  day === now.getDate();

                return (
                  <button
                    type="button"
                    key={day}
                    className={[
                      'calendar-day',
                      selectedDay === day
                        ? 'selected'
                        : '',
                      isToday
                        ? 'today'
                        : '',
                    ].join(' ')}
                    aria-label={
                      `${formatDate(
                        dateKey(year, month, day)
                      )}, ` +
                      `${dayLeaves.length} leave entries`
                    }
                    aria-pressed={
                      selectedDay === day
                    }
                    onClick={() =>
                      setSelectedDay(day)
                    }
                    style={{
                      minHeight: 44,
                    }}
                  >
                    <span>{day}</span>

                    <span className="calendar-day-dots">
                      {visibleStatuses.map(
                        (status) =>
                          dayLeaves.some(
                            (leave) =>
                              leave.status === status
                          ) ? (
                            <i
                              key={status}
                              className="calendar-dot"
                              aria-hidden="true"
                              style={{
                                backgroundColor:
                                  statusColors[
                                    status
                                  ].text,
                              }}
                            />
                          ) : null
                      )}
                    </span>
                  </button>
                );
              }
            )}
          </div>

          {/* SELECTED DATE DETAILS */}

          <div className="calendar-details">
            <h3>
              {formatDate(
                dateKey(
                  year,
                  month,
                  selectedDay
                )
              )}
            </h3>

            {selectedLeaves.length === 0 ? (
              <p>
                {role === 'staff'
                  ? 'No leave requests for this date.'
                  : 'No visible leave scheduled for this date.'}
              </p>
            ) : (
              <div className="calendar-events">
                {selectedLeaves.map(
                  (leave) => (
                    <article
                      className="calendar-event"
                      key={leave.id}
                    >
                      <div>
                        <strong>
                          {nameFor(leave.user_id)}
                        </strong>

                        <p>
                          {formatLeaveType(
                            leave.leave_type
                          )}{' '}
                          Leave
                        </p>

                        <small>
                          {formatDate(
                            leave.start_date
                          )}
                          {' – '}
                          {formatDate(
                            leave.end_date
                          )}
                        </small>
                      </div>

                      <span
                        className={
                          `calendar-status ${leave.status}`
                        }
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          minHeight: 28,
                          padding: '5px 10px',
                          borderRadius: 7,
                          fontSize: 11,
                          fontWeight: 700,
                          backgroundColor:
                            statusColors[
                              leave.status
                            ].background,
                          color:
                            statusColors[
                              leave.status
                            ].text,
                        }}
                      >
                        {formatStatus(
                          leave.status
                        )}
                      </span>
                    </article>
                  )
                )}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
