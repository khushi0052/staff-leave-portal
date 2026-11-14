
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import './App.css';

function App() {
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
        if (mounted) {
          setSession(currentSession);
          setCheckingSession(false);
        }
      }
    );

    void supabase.auth.getSession().then(
      ({ data, error: sessionError }) => {
        if (!mounted) return;

        if (sessionError) {
          setError(sessionError.message);
        }

        setSession(data.session);
        setCheckingSession(false);
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { error: loginError } =
        await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

      if (loginError) {
        setError(loginError.message);
      }
    } catch {
      setError('Unable to connect to Supabase. Please try again.');
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

      if (logoutError) {
        setError(logoutError.message);
      } else {
        setPassword('');
      }
    } catch {
      setError('Unable to sign out. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (checkingSession) {
    return (
      <main className="page">
        <div className="card">
          <p>Checking your session...</p>
        </div>
      </main>
    );
  }

  if (session) {
    return (
      <main className="page">
        <section className="card">
          <div className="logo">📅</div>

          <h1>Staff Leave Portal</h1>

          <p className="subtitle">
            You're signed in successfully.
          </p>

          <div className="welcome-box">
            <h2>Welcome!</h2>
            <p>{session.user.email}</p>
          </div>

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}

          <p className="subtitle">
            Your leave dashboard is coming next.
          </p>

          <button
            type="button"
            onClick={handleLogout}
            disabled={loading}
          >
            {loading ? 'Signing out...' : 'Log Out'}
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <section className="card">
        <div className="logo">📅</div>

        <h1>Staff Leave Portal</h1>

        <p className="subtitle">
          Sign in to manage your leave requests
        </p>

        <form onSubmit={handleLogin}>
          <label htmlFor="email">Email address</label>

          <input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="employee@company.com"
            autoComplete="email"
            required
          />

          <label htmlFor="password">Password</label>

          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
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

export default App;
