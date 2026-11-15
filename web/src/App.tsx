
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';

import { supabase } from './lib/supabase';
import EmployeeDashboard from './components/EmployeeDashboard';

import './App.css';
import './theme.css';
import './LeaveDesk.css';
import './LeaveDesk-responsive.css';
import './leavedesk-theme.css';
import './HRLeaveDesk.css';

export default function App() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [session, setSession] = useState<Session | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (_event, currentSession) => {
        if (!mounted) return;

        setSession(currentSession);
        setCheckingSession(false);
      }
    );

    void supabase.auth
      .getSession()
      .then(({ data, error: sessionError }) => {
        if (!mounted) return;

        if (sessionError) {
          setError(sessionError.message);
        }

        setSession(data.session);
        setCheckingSession(false);
      })
      .catch(() => {
        if (mounted) {
          setError('Unable to restore your session.');
          setCheckingSession(false);
        }
      });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function handleLogin(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { error: loginError } =
        await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

      if (loginError) throw loginError;
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to sign in.'
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    setError('');
    setLoading(true);

    try {
      const { error: logoutError } =
        await supabase.auth.signOut();

      if (logoutError) throw logoutError;

      setPassword('');
      setSession(null);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to sign out.'
      );
    } finally {
      setLoading(false);
    }
  }

  if (checkingSession) {
    return (
      <main className="page">
        <section className="card">
          <p>Checking your session...</p>
        </section>
      </main>
    );
  }

  // The signed-in application now uses LeaveDesk's
  // full-width layout instead of the login card.
  if (session) {
    return (
      <EmployeeDashboard
        userId={session.user.id}
        email={session.user.email ?? ''}
        onLogout={handleLogout}
        loggingOut={loading}
        authError={error}
      />
    );
  }

  // The login form remains compact.
  return (
    <main className="page">
      <section className="card">
        <div className="logo" aria-hidden="true">
          📅
        </div>

        <h1>LeaveDesk</h1>

        <p className="subtitle">
          Staff Leave Management Portal
        </p>

        <form onSubmit={handleLogin}>
          <label htmlFor="email">
            Email address
          </label>

          <input
            id="email"
            type="email"
            value={email}
            onChange={(event) =>
              setEmail(event.target.value)
            }
            placeholder="employee@company.com"
            autoComplete="email"
            required
          />

          <label htmlFor="password">
            Password
          </label>

          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) =>
              setPassword(event.target.value)
            }
            placeholder="Enter your password"
            autoComplete="current-password"
            required
          />

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="footer">
          Staff Leave Request &amp; Approval System
        </p>
      </section>
    </main>
  );
}
