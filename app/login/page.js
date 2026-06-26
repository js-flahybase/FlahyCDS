'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, password })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Login failed');
      }

      router.push('/');
      router.refresh();
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-10">
      <form
        className="w-full max-w-sm rounded-3xl border border-line bg-white/95 p-7 shadow-panel backdrop-blur"
        onSubmit={handleSubmit}
      >
        <h1 className="m-0 text-3xl font-bold tracking-tight text-ink">Sign in</h1>
        <p className="mb-5 mt-2 text-sm text-mist">Use your lab username and password.</p>
        <input
          className="mb-3 h-11 w-full rounded-2xl border border-slate-300 px-4 text-base outline-none transition focus:border-brand focus:ring-4 focus:ring-blue-100"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="Username"
          autoComplete="username"
        />
        <input
          className="mb-4 h-11 w-full rounded-2xl border border-slate-300 px-4 text-base outline-none transition focus:border-brand focus:ring-4 focus:ring-blue-100"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password"
          autoComplete="current-password"
        />
        <button
          type="submit"
          className="h-11 w-full rounded-2xl bg-gradient-to-r from-brand to-brandDeep text-sm font-semibold text-white shadow-lg shadow-blue-200 transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={submitting}
        >
          {submitting ? 'Signing in...' : 'Sign in'}
        </button>
        {error ? <p className="mt-3 text-sm font-medium text-red-600">{error}</p> : null}
      </form>
    </main>
  );
}
