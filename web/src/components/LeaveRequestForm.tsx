
import { useEffect, useRef, useState } from 'react';
import type { FormEvent, PointerEvent } from 'react';
import { supabase } from '../lib/supabase';

type LeaveType = 'annual' | 'sick' | 'unpaid';

type LeaveRequestFormProps = {
  onSuccess?: () => void;
};

type Balance = {
  entitlement: number | null;
  used: number;
  reserved: number;
  remaining: number | null;
  available: number | null;
};

type DragSelection = {
  pointerId: number;
  anchor: string;
};

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function parseDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(
    date.getFullYear(),
    date.getMonth() + months,
    1
  );

  const lastDay = new Date(
    result.getFullYear(),
    result.getMonth() + 1,
    0
  ).getDate();

  result.setDate(Math.min(date.getDate(), lastDay));
  return result;
}

function displayDate(value: string): string {
  return parseDate(value).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function isWorkingDay(
  date: Date,
  holidays: Set<string>
): boolean {
  const weekday = date.getDay();

  return (
    weekday !== 0 &&
    weekday !== 6 &&
    !holidays.has(formatDate(date))
  );
}

function countWorkingDays(
  start: string,
  end: string,
  holidays: Set<string>
): number {
  if (!start || !end || end < start) return 0;

  let count = 0;
  const cursor = parseDate(start);
  const finish = parseDate(end);

  while (cursor <= finish) {
    if (isWorkingDay(cursor, holidays)) {
      count += 1;
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return count;
}

function getReportingDate(
  end: string,
  holidays: Set<string>
): string {
  if (!end) return '';

  const cursor = addDays(parseDate(end), 1);

  for (let attempt = 0; attempt < 31; attempt += 1) {
    if (isWorkingDay(cursor, holidays)) {
      return formatDate(cursor);
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return '';
}

function firstOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export default function LeaveRequestForm({
  onSuccess,
}: LeaveRequestFormProps) {
  const today = new Date();
  const todayString = formatDate(today);

  const [leaveType, setLeaveType] =
    useState<LeaveType>('annual');

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');

  const [viewMonth, setViewMonth] = useState(
    firstOfMonth(today)
  );

  const [holidays, setHolidays] = useState<Set<string>>(
    new Set()
  );

  const [holidaysLoaded, setHolidaysLoaded] = useState(false);

  const [balance, setBalance] = useState<Balance | null>(
    null
  );

  const [balanceYear, setBalanceYear] = useState<number | null>(
    null
  );

  const [balanceLoading, setBalanceLoading] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selectionMessage, setSelectionMessage] = useState('');

  const dragRef = useRef<DragSelection | null>(null);

  const calendarYear = viewMonth.getFullYear();
  const calendarMonth = viewMonth.getMonth();

  const sickEarliestDate = formatDate(
    addDays(today, -10)
  );

  const maximumDate = formatDate(
    addMonths(today, 12)
  );

  const minimumDate =
    leaveType === 'sick'
      ? sickEarliestDate
      : todayString;

  const reasonRequired = leaveType === 'unpaid';

  // ------------------------------------------
  // LOAD PUBLIC HOLIDAYS
  // ------------------------------------------

  useEffect(() => {
    let active = true;

    async function loadHolidays() {
      setHolidaysLoaded(false);

      const first = formatDate(
        addDays(new Date(), -15)
      );

      const last = formatDate(
        addDays(addMonths(new Date(), 12), 35)
      );

      const { data, error: holidayError } = await supabase
        .from('public_holidays')
        .select('date')
        .gte('date', first)
        .lte('date', last);

      if (!active) return;

      if (holidayError) {
        setError(holidayError.message);
        setHolidaysLoaded(false);
        return;
      }

      setHolidays(
        new Set(
          (data ?? []).map(
            (holiday) => holiday.date as string
          )
        )
      );

      setHolidaysLoaded(true);
    }

    void loadHolidays();

    return () => {
      active = false;
    };
  }, []);

  // ------------------------------------------
  // LOAD AVAILABLE ANNUAL BALANCE
  // FOR THE YEAR SHOWN ON THE CALENDAR
  // ------------------------------------------

  useEffect(() => {
    let active = true;

    async function loadBalance() {
      setBalanceLoading(true);
      setBalance(null);
      setBalanceYear(null);

      try {
        const {
          data: authData,
          error: authError,
        } = await supabase.auth.getUser();

        if (authError) throw authError;

        if (!authData.user) {
          throw new Error('Please sign in again.');
        }

        const {
          data,
          error: balanceError,
        } = await supabase.rpc('leave_balance', {
          p_user: authData.user.id,
          p_year: calendarYear,
        });

        if (balanceError) throw balanceError;

        const row = Array.isArray(data)
          ? data[0]
          : data;

        if (!row) {
          throw new Error('Annual leave balance is unavailable.');
        }

        if (!active) return;

        setBalance({
          entitlement: row.entitlement,
          used: Number(row.used ?? 0),
          reserved: Number(row.reserved ?? 0),
          remaining: row.remaining,
          available: row.available,
        });

        setBalanceYear(calendarYear);
      } catch (err) {
        if (!active) return;

        setError(
          err instanceof Error
            ? err.message
            : 'Unable to load annual leave balance.'
        );
      } finally {
        if (active) setBalanceLoading(false);
      }
    }

    void loadBalance();

    return () => {
      active = false;
    };
  }, [calendarYear]);

  // ------------------------------------------
  // DATE CALCULATIONS
  // ------------------------------------------

  const datesPresent = Boolean(startDate && endDate);

  const workingDays =
    datesPresent && holidaysLoaded
      ? countWorkingDays(startDate, endDate, holidays)
      : 0;

  const reportingDate =
    datesPresent && holidaysLoaded
      ? getReportingDate(endDate, holidays)
      : '';

  const available =
    balanceYear === calendarYear &&
    balance !== null &&
    balance.available !== null
      ? Number(balance.available)
      : null;

  const annualBalanceValid =
    leaveType !== 'annual' ||
    (
      available !== null &&
      workingDays <= available
    );

  const datesWithinRange =
    datesPresent &&
    startDate >= minimumDate &&
    endDate <= maximumDate &&
    endDate >= startDate;

  const sameYear =
    datesPresent &&
    startDate.slice(0, 4) === endDate.slice(0, 4);

  const canSubmit =
    holidaysLoaded &&
    !balanceLoading &&
    datesWithinRange &&
    sameYear &&
    workingDays > 0 &&
    annualBalanceValid &&
    (!reasonRequired || reason.trim().length > 0) &&
    !submitting;

  // ------------------------------------------
  // CALENDAR DAYS
  // ------------------------------------------

  const daysInMonth = new Date(
    calendarYear,
    calendarMonth + 1,
    0
  ).getDate();

  const firstWeekday = new Date(
    calendarYear,
    calendarMonth,
    1
  ).getDay();

  const calendarDays: (string | null)[] = [
    ...Array.from(
      { length: firstWeekday },
      () => null
    ),
    ...Array.from(
      { length: daysInMonth },
      (_, index) =>
        formatDate(
          new Date(
            calendarYear,
            calendarMonth,
            index + 1
          )
        )
    ),
  ];

  // ------------------------------------------
  // SELECT A SINGLE DATE OR DRAG A RANGE
  // ------------------------------------------

  function selectRange(
    anchor: string,
    target: string
  ): boolean {
    const start = anchor <= target
      ? anchor
      : target;

    const end = anchor <= target
      ? target
      : anchor;

    if (
      start < minimumDate ||
      end > maximumDate ||
      start.slice(0, 4) !== end.slice(0, 4)
    ) {
      setSelectionMessage(
        'Select dates within the allowed range and one calendar year.'
      );
      return false;
    }

    const days = countWorkingDays(
      start,
      end,
      holidays
    );

    if (days === 0) {
      setSelectionMessage(
        'Select at least one working day.'
      );
      return false;
    }

    if (leaveType === 'annual') {
      if (available === null) {
        setSelectionMessage(
          'Annual balance is not available yet.'
        );
        return false;
      }

      if (available <= 0) {
        setSelectionMessage(
          'Your available Annual Leave balance is 0 days. Choose Sick or Unpaid Leave.'
        );
        return false;
      }

      if (days > available) {
        setSelectionMessage(
          `You can select a maximum of ${available} working day(s) of Annual Leave.`
        );
        return false;
      }
    }

    setStartDate(start);
    setEndDate(end);
    setSelectionMessage('');
    setError('');
    setSuccess('');

    return true;
  }

  function handlePointerDown(
    event: PointerEvent<HTMLDivElement>
  ) {
    if (
      submitting ||
      !holidaysLoaded ||
      balanceLoading
    ) {
      return;
    }

    const element = event.target;

    if (!(element instanceof Element)) return;

    const dayElement = element.closest<HTMLElement>(
      '[data-leave-date]'
    );

    const date = dayElement?.dataset.leaveDate;

    if (!date) return;

    event.preventDefault();

    dragRef.current = {
      pointerId: event.pointerId,
      anchor: date,
    };

    event.currentTarget.setPointerCapture(
      event.pointerId
    );

    selectRange(date, date);
  }

  function handlePointerMove(
    event: PointerEvent<HTMLDivElement>
  ) {
    const drag = dragRef.current;

    if (
      !drag ||
      drag.pointerId !== event.pointerId
    ) {
      return;
    }

    const element = document.elementFromPoint(
      event.clientX,
      event.clientY
    );

    const dayElement = element?.closest<HTMLElement>(
      '[data-leave-date]'
    );

    const date = dayElement?.dataset.leaveDate;

    if (date) {
      selectRange(drag.anchor, date);
    }
  }

  function stopDragging(
    event: PointerEvent<HTMLDivElement>
  ) {
    const drag = dragRef.current;

    if (
      drag &&
      drag.pointerId === event.pointerId
    ) {
      dragRef.current = null;

      if (
        event.currentTarget.hasPointerCapture(
          event.pointerId
        )
      ) {
        event.currentTarget.releasePointerCapture(
          event.pointerId
        );
      }
    }
  }

  function changeMonth(direction: number) {
    const nextMonth = new Date(
      calendarYear,
      calendarMonth + direction,
      1
    );

    setViewMonth(nextMonth);
    setStartDate('');
    setEndDate('');
    setSelectionMessage('');
  }

  function changeLeaveType(value: LeaveType) {
    setLeaveType(value);
    setStartDate('');
    setEndDate('');
    setReason('');
    setSelectionMessage('');
    setError('');
    setSuccess('');
  }

  // ------------------------------------------
  // SUBMIT USING EXISTING DATABASE FUNCTION
  // ------------------------------------------

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (!canSubmit) return;

    setError('');
    setSuccess('');
    setSubmitting(true);

    try {
      // Supabase is the final authority for
      // working days, balance and permissions.
      const {
        data,
        error: submitError,
      } = await supabase.rpc('submit_leave', {
        p_type: leaveType,
        p_start: startDate,
        p_end: endDate,
        p_reason: reason.trim(),
      });

      if (submitError) throw submitError;

      setSuccess(
        `Leave request submitted successfully. Reference: ${data}`
      );

      setStartDate('');
      setEndDate('');
      setReason('');
      setSelectionMessage('');

      // Refresh the balance after submission.
      const { data: authData } =
        await supabase.auth.getUser();

      if (authData.user) {
        const { data: freshBalance } =
          await supabase.rpc('leave_balance', {
            p_user: authData.user.id,
            p_year: calendarYear,
          });

        const row = Array.isArray(freshBalance)
          ? freshBalance[0]
          : freshBalance;

        if (row) {
          setBalance({
            entitlement: row.entitlement,
            used: Number(row.used ?? 0),
            reserved: Number(row.reserved ?? 0),
            remaining: row.remaining,
            available: row.available,
          });
        }
      }

      onSuccess?.();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to submit your leave request.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="leave-range-form">
      <style>
        {`
          .leave-range-form {
            width: 100%;
            max-width: 620px;
            color: #10234f;
            font-family: inherit;
          }

          .leave-range-form * {
            box-sizing: border-box;
          }

          .leave-range-form h3 {
            margin: 0 0 4px;
            color: #10234f;
            font-size: 18px;
            font-weight: 800;
          }

          .leave-range-form .lrf-subtitle {
            margin: 0 0 14px;
            color: #64748b;
            font-size: 12px;
          }

          .leave-range-form form {
            display: grid;
            gap: 12px;
          }

          .leave-range-form .lrf-field {
            display: grid;
            gap: 5px;
            min-width: 0;
          }

          .leave-range-form .lrf-label {
            font-size: 12px;
            font-weight: 700;
            color: #10234f;
          }

          .leave-range-form .lrf-required {
            color: #dc2626;
          }

          .leave-range-form select,
          .leave-range-form textarea {
            width: 100%;
            margin: 0;
            padding: 9px 12px;
            border: 1px solid #cbd5e1;
            border-radius: 8px;
            background: #fff;
            color: #10234f;
            font: inherit;
            font-size: 13px;
          }

          .leave-range-form select {
            min-height: 44px;
          }

          .leave-range-form textarea {
            min-height: 68px;
            resize: vertical;
          }

          .leave-range-form .lrf-calendar {
            padding: 10px;
            background: #f8faff;
            border: 1px solid #dce4f3;
            border-radius: 10px;
          }

          .leave-range-form .lrf-calendar-nav {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 10px;
            margin-bottom: 8px;
          }

          .leave-range-form .lrf-calendar-nav strong {
            font-size: 13px;
          }

          .leave-range-form .lrf-month-button {
            width: 44px;
            min-height: 44px;
            border: 1px solid #dce4f3;
            border-radius: 8px;
            background: white;
            color: #0f2a5c;
            font-size: 22px;
            cursor: pointer;
          }

          .leave-range-form .lrf-grid {
            display: grid;
            grid-template-columns: repeat(7, minmax(0, 1fr));
            gap: 3px;
            touch-action: none;
            user-select: none;
          }

          .leave-range-form .lrf-weekday {
            padding: 7px 0;
            text-align: center;
            color: #64748b;
            font-size: 11px;
            font-weight: 700;
          }

          .leave-range-form .lrf-day {
            min-width: 0;
            min-height: 44px;
            padding: 5px 2px;
            border: 1px solid transparent;
            border-radius: 7px;
            background: transparent;
            color: #10234f;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            touch-action: none;
          }

          .leave-range-form .lrf-day:hover:not(:disabled) {
            border-color: #93b4e4;
            background: #eaf3ff;
          }

          .leave-range-form .lrf-day.selected {
            background: #0f2a5c;
            color: white;
          }

          .leave-range-form .lrf-day.weekend {
            color: #94a3b8;
          }

          .leave-range-form .lrf-day.holiday {
            color: #b45309;
          }

          .leave-range-form .lrf-day.selected.weekend,
          .leave-range-form .lrf-day.selected.holiday {
            color: white;
          }

          .leave-range-form .lrf-day:disabled {
            opacity: 0.35;
            cursor: not-allowed;
          }

          .leave-range-form .lrf-preview {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 8px;
          }

          .leave-range-form .lrf-preview-item {
            display: grid;
            gap: 4px;
            min-width: 0;
            padding: 10px;
            border-radius: 8px;
            background: #eaf3ff;
          }

          .leave-range-form .lrf-preview-item strong {
            font-size: 13px;
            color: #0f2a5c;
            overflow-wrap: anywhere;
          }

          .leave-range-form .lrf-preview-item span {
            font-size: 10px;
            color: #64748b;
          }

          .leave-range-form .lrf-selection {
            margin: 0;
            font-size: 12px;
            color: #475569;
          }

          .leave-range-form .lrf-hint {
            margin: 0;
            color: #64748b;
            font-size: 11px;
          }

          .leave-range-form .lrf-warning {
            margin: 0;
            padding: 9px;
            border-radius: 8px;
            background: #fef3c7;
            color: #92400e;
            font-size: 12px;
          }

          .leave-range-form .lrf-error {
            margin: 0;
            color: #b91c1c;
            font-size: 12px;
          }

          .leave-range-form .lrf-success {
            margin: 0;
            color: #15803d;
            font-size: 12px;
          }

          .leave-range-form .lrf-counter {
            text-align: right;
            color: #64748b;
            font-size: 10px;
          }

          .leave-range-form .lrf-submit {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 9px;
            width: 100%;
            min-height: 44px;
            padding: 10px;
            border: 0;
            border-radius: 8px;
            background: #0f2a5c;
            color: white;
            font-size: 13px;
            font-weight: 700;
            cursor: pointer;
          }

          .leave-range-form .lrf-submit:disabled {
            opacity: 0.55;
            cursor: not-allowed;
          }

          .leave-range-form button:focus-visible,
          .leave-range-form select:focus-visible,
          .leave-range-form textarea:focus-visible {
            outline: 3px solid #93c5fd;
            outline-offset: 2px;
          }

          @media (max-width: 480px) {
            .leave-range-form .lrf-calendar {
              padding: 6px;
            }

            .leave-range-form .lrf-preview {
              grid-template-columns: 1fr;
            }
          }
        `}
      </style>

      <h3>Request Leave</h3>

      <p className="lrf-subtitle">
        Apply for a new leave request.
      </p>

      <form onSubmit={handleSubmit}>
        {/* LEAVE TYPE */}

        <div className="lrf-field">
          <label className="lrf-label" htmlFor="leave-type">
            Leave Type <span className="lrf-required">*</span>
          </label>

          <select
            id="leave-type"
            value={leaveType}
            disabled={submitting}
            onChange={(event) =>
              changeLeaveType(
                event.target.value as LeaveType
              )
            }
          >
            <option value="annual">Annual Leave</option>
            <option value="sick">Sick Leave</option>
            <option value="unpaid">Unpaid Leave</option>
          </select>
        </div>

        {/* INTERACTIVE DATE RANGE CALENDAR */}

        <div className="lrf-field">
          <span className="lrf-label">
            Leave Duration <span className="lrf-required">*</span>
          </span>

          <div className="lrf-calendar">
            <div className="lrf-calendar-nav">
              <button
                type="button"
                className="lrf-month-button"
                aria-label="Previous month"
                onClick={() => changeMonth(-1)}
                disabled={submitting}
              >
                ‹
              </button>

              <strong>
                {viewMonth.toLocaleDateString('en-IN', {
                  month: 'long',
                  year: 'numeric',
                })}
              </strong>

              <button
                type="button"
                className="lrf-month-button"
                aria-label="Next month"
                onClick={() => changeMonth(1)}
                disabled={submitting}
              >
                ›
              </button>
            </div>

            <div
              className="lrf-grid"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={stopDragging}
              onPointerCancel={stopDragging}
            >
              {[
                'Sun', 'Mon', 'Tue', 'Wed',
                'Thu', 'Fri', 'Sat',
              ].map((day) => (
                <span
                  key={day}
                  className="lrf-weekday"
                >
                  {day}
                </span>
              ))}

              {calendarDays.map((date, index) => {
                if (!date) {
                  return (
                    <span key={`empty-${index}`} />
                  );
                }

                const parsed = parseDate(date);

                const weekend =
                  parsed.getDay() === 0 ||
                  parsed.getDay() === 6;

                const holiday = holidays.has(date);

                const selected =
                  datesPresent &&
                  date >= startDate &&
                  date <= endDate;

                const disabled =
                  submitting ||
                  !holidaysLoaded ||
                  balanceLoading ||
                  date < minimumDate ||
                  date > maximumDate;

                return (
                  <button
                    key={date}
                    type="button"
                    data-leave-date={date}
                    className={[
                      'lrf-day',
                      selected ? 'selected' : '',
                      weekend ? 'weekend' : '',
                      holiday ? 'holiday' : '',
                    ].join(' ')}
                    disabled={disabled}
                    title={
                      holiday
                        ? 'Public holiday'
                        : weekend
                          ? 'Weekend'
                          : displayDate(date)
                    }
                    aria-label={displayDate(date)}
                    aria-pressed={selected}
                    onClick={(event) => {
                      // Keyboard activation: pointer selection
                      // is handled by the calendar grid.
                      if (event.detail === 0) {
                        selectRange(date, date);
                      }
                    }}
                  >
                    {parsed.getDate()}
                  </button>
                );
              })}
            </div>
          </div>

          <p className="lrf-hint">
            Click a date for one day, or drag across dates.
            Working days exclude weekends and public holidays.
          </p>

          {datesPresent && (
            <p className="lrf-selection">
              <strong>Selected:</strong>{' '}
              {displayDate(startDate)}
              {' — '}
              {displayDate(endDate)}
            </p>
          )}

          {selectionMessage && (
            <p className="lrf-warning" role="alert">
              {selectionMessage}
            </p>
          )}
        </div>

        {/* LIVE PREVIEW */}

        <div className="lrf-preview">
          <div className="lrf-preview-item">
            <span>Working Days</span>
            <strong>{workingDays} Days</strong>
          </div>

          <div className="lrf-preview-item">
            <span>Annual Balance Available</span>
            <strong>
              {balanceLoading
                ? 'Loading...'
                : available === null
                  ? '—'
                  : `${available} Days`}
            </strong>
          </div>

          <div className="lrf-preview-item">
            <span>Reporting Date</span>
            <strong>
              {reportingDate
                ? displayDate(reportingDate)
                : 'Select dates'}
            </strong>
          </div>
        </div>

        {leaveType === 'annual' &&
          available !== null &&
          available <= 0 && (
            <p className="lrf-warning" role="alert">
              Your Annual Leave balance is exhausted.
              Choose Sick Leave or Unpaid Leave.
            </p>
          )}

        {/* REASON */}

        <div className="lrf-field">
          <label
            htmlFor="leave-reason"
            className="lrf-label"
          >
            Reason{' '}
            {reasonRequired ? (
              <span className="lrf-required">*</span>
            ) : (
              '(Optional)'
            )}
          </label>

          <textarea
            id="leave-reason"
            value={reason}
            maxLength={250}
            rows={2}
            required={reasonRequired}
            disabled={submitting}
            placeholder={
              reasonRequired
                ? 'Enter a reason for Unpaid Leave'
                : 'Enter your reason (optional)'
            }
            onChange={(event) => {
              setReason(event.target.value);
              setError('');
              setSuccess('');
            }}
          />

          <span className="lrf-counter">
            {reason.length} / 250
          </span>
        </div>

        {error && (
          <p className="lrf-error" role="alert">
            {error}
          </p>
        )}

        {success && (
          <p className="lrf-success" role="status">
            {success}
          </p>
        )}

        <button
          type="submit"
          className="lrf-submit"
          disabled={!canSubmit}
        >
          <span aria-hidden="true">➤</span>
          {submitting
            ? 'Submitting...'
            : 'Submit Leave Request'}
        </button>
      </form>
    </section>
  );
}
