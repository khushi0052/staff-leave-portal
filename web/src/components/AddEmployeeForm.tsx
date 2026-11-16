
import { useState } from 'react';
import { supabase } from '../lib/supabase';

type Department = {
  id: string;
  name: string;
};

type Props = {
  departments: Department[];
  onClose: () => void;
  onCreated: () => Promise<void>;
};

const FULL_YEAR_DAYS = 20;

// Joining month is not counted, except January receives a full year.
// Example: June => July through December (6 months) => 10 days.
function estimateAnnualEntitlement(
  joiningDate: string
): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(joiningDate);

  if (!match) return null;

  const joinYear = Number(match[1]);
  const joinMonth = Number(match[2]);
  const joinDay = Number(match[3]);

  const parsed = new Date(
    Date.UTC(joinYear, joinMonth - 1, joinDay)
  );

  if (
    parsed.getUTCFullYear() !== joinYear ||
    parsed.getUTCMonth() + 1 !== joinMonth ||
    parsed.getUTCDate() !== joinDay
  ) {
    return null;
  }

  const currentYear = new Date().getFullYear();

  if (joinYear < currentYear) return FULL_YEAR_DAYS;
  if (joinYear > currentYear) return null;

  const months = joinMonth === 1 ? 12 : 12 - joinMonth;

  return Math.round((FULL_YEAR_DAYS * months) / 12);
}

export default function AddEmployeeForm({
  departments,
  onClose,
  onCreated,
}: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [isManager, setIsManager] = useState(false);
  const [joiningDate, setJoiningDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const entitlement = estimateAnnualEntitlement(joiningDate);

  const today = new Date();

  const todayKey =
    `${today.getFullYear()}-` +
    `${String(today.getMonth() + 1).padStart(2, '0')}-` +
    `${String(today.getDate()).padStart(2, '0')}`;

  async function submit(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (saving) return;

    setError('');

    if (
      !name.trim() ||
      !email.trim() ||
      !departmentId ||
      !joiningDate ||
      entitlement === null ||
      joiningDate > todayKey
    ) {
      setError(
        'Enter a valid name, email, department and joining date (today or earlier).'
      );
      return;
    }

    setSaving(true);

    try {
      const { data, error: functionError } =
        await supabase.functions.invoke(
          'hr-create-employee',
          {
            body: {
              full_name: name.trim(),
              email: email.trim().toLowerCase(),
              department_id: departmentId,
              is_manager: isManager,
              joining_date: joiningDate,
            },
          }
        );

      if (functionError) {
        // The backend returns descriptive HTTP errors.
        // Never expose server-side secrets.
        const response = (
          functionError as { context?: Response }
        ).context;

        const payload =
          response && typeof response.json === 'function'
            ? (await response.json().catch(() => null)) as {
                error?: string;
              } | null
            : null;

        throw new Error(
          payload?.error ?? functionError.message
        );
      }

      if (data?.error) {
        throw new Error(String(data.error));
      }

      await onCreated();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to add employee.'
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="hr-card"
      aria-label="Add Employee"
      style={{ marginBottom: 20, padding: 20 }}
    >
      <header className="hr-panel-heading">
        <h2>Add Employee</h2>
        <p>Create a Supabase login and employee profile.</p>
      </header>

      <form
        onSubmit={(event) => void submit(event)}
        style={{
          display: 'grid',
          gap: 14,
          maxWidth: 560,
        }}
      >
        <label style={{ display: 'grid', gap: 5 }}>
          Employee Name

          <input
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
          />
        </label>

        <label style={{ display: 'grid', gap: 5 }}>
          Email Address

          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="employee@company.com"
          />
        </label>

        <label style={{ display: 'grid', gap: 5 }}>
          Department

          <select
            required
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
          >
            <option value="">Select department</option>

            {departments.map((department) => (
              <option
                key={department.id}
                value={department.id}
              >
                {department.name}
              </option>
            ))}
          </select>
        </label>

        <label
          htmlFor="employee-role"
          style={{ display: 'grid', gap: 5 }}
        >
          Manager / Staff

          <select
            id="employee-role"
            value={isManager ? 'manager' : 'staff'}
            onChange={(e) =>
              setIsManager(e.target.value === 'manager')
            }
          >
            <option value="staff">Staff</option>
            <option value="manager">Manager</option>
          </select>
        </label>

        <label style={{ display: 'grid', gap: 5 }}>
          Joining Date

          <input
            required
            type="date"
            max={todayKey}
            value={joiningDate}
            onChange={(e) => setJoiningDate(e.target.value)}
          />
        </label>

        {entitlement !== null && (
          <p style={{ margin: 0 }}>
            <strong>
              Annual leave entitlement for {today.getFullYear()}:
            </strong>{' '}
            {entitlement} days

            <small style={{ display: 'block' }}>
              Full year: 20 days. The joining month is excluded
              except January; prior-year joiners receive 20 days.
            </small>
          </p>
        )}

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div
          style={{
            display: 'flex',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <button
            className="hr-button primary"
            type="submit"
            disabled={saving}
          >
            {saving ? 'Creating employee...' : 'Create Employee'}
          </button>

          <button
            className="hr-button outline"
            type="button"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
