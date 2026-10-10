import React, { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  UserPlus,
  ArrowLeft,
} from 'lucide-react';
import { BrandLogo } from './BrandLogo';
import { createAccount, login, GappsUser } from '../services/gappsAuth';

interface LoginPageProps {
  onAuthenticated: (user: GappsUser) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onAuthenticated }) => {
  const [mode, setMode] = useState<'signin' | 'create'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const user = await login(email.trim(), password);
      onAuthenticated(user);
    } catch (err: any) {
      setError(err?.message || 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!email.trim() || !name.trim() || !password) {
      setError('Enter your name, email, and password.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createAccount({
        email: email.trim(),
        name: name.trim(),
        password,
      });
      setInfo(`Account created for ${email.trim()}. Sign in below.`);
      setMode('signin');
      setPassword('');
      setConfirm('');
      setName('');
    } catch (err: any) {
      setError(err?.message || 'Account creation failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 pb-16">
      <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-sm px-8 py-10">
        {/* Brand */}
        <div className="flex justify-center mb-6">
          <BrandLogo size={40} withWordmark sublabel="Project Manager Workspace" className="max-w-full [&>span]:min-w-0" />
        </div>

        <div className="text-center mb-6">
          <h1 className="text-[17px] font-semibold tracking-tight text-slate-900">
            {mode === 'signin'
              ? 'Sign in to the Project Manager Workspace'
              : 'Create Your Account'}
          </h1>
          <p className="text-[12px] text-slate-500 mt-1.5">
            {mode === 'signin'
              ? 'Access your jobs, budgets, schedules, and project documents.'
              : 'Enter your name, email, and password to create your account.'}
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 flex items-start gap-2.5 text-[12px] text-rose-700">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="flex-1">{error}</span>
          </div>
        )}

        {info && (
          <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 flex items-start gap-2.5 text-[12px] text-emerald-700">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="flex-1">{info}</span>
          </div>
        )}

        {mode === 'signin' ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="gapps-email"
                className="block text-[12px] font-medium text-slate-600 mb-1.5"
              >
                Email
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="gapps-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@hayssons.com"
                  disabled={busy}
                  className="w-full h-11 pl-10 pr-3.5 rounded-lg border border-slate-300 bg-slate-50 text-[13px] text-slate-900 transition focus:bg-white focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/15"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="gapps-password"
                className="block text-[12px] font-medium text-slate-600 mb-1.5"
              >
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="gapps-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  disabled={busy}
                  className="w-full h-11 pl-10 pr-11 rounded-lg border border-slate-300 bg-slate-50 text-[13px] text-slate-900 transition focus:bg-white focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/15"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((show) => !show)}
                  disabled={busy}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-slate-600 transition-colors"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full h-11 rounded-lg text-[13px] font-semibold bg-red-600 text-white hover:bg-red-700 shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 disabled:opacity-45 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
            >
              {busy ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Signing in…
                </>
              ) : (
                'Sign In'
              )}
            </button>

            <div className="text-center pt-1">
              <button
                type="button"
                onClick={() => {
                  setMode('create');
                  setError(null);
                  setInfo(null);
                }}
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-red-600 hover:text-red-700"
              >
                <UserPlus className="w-3.5 h-3.5" />
                Create an account
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label
                htmlFor="gapps-name"
                className="block text-[12px] font-medium text-slate-600 mb-1.5"
              >
                Full Name
              </label>
              <input
                id="gapps-name"
                type="text"
                maxLength={100}
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Ryan Russell"
                disabled={busy}
                className="w-full h-11 px-3.5 rounded-lg border border-slate-300 bg-slate-50 text-[13px] text-slate-900 transition focus:bg-white focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/15"
              />
            </div>

            <div>
              <label
                htmlFor="gapps-create-email"
                className="block text-[12px] font-medium text-slate-600 mb-1.5"
              >
                Email
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="gapps-create-email"
                  type="email"
                  maxLength={254}
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@hayssons.com"
                  disabled={busy}
                  className="w-full h-11 pl-10 pr-3.5 rounded-lg border border-slate-300 bg-slate-50 text-[13px] text-slate-900 transition focus:bg-white focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/15"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="gapps-create-password"
                className="block text-[12px] font-medium text-slate-600 mb-1.5"
              >
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="gapps-create-password"
                  type={showPassword ? 'text' : 'password'}
                  maxLength={128}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  disabled={busy}
                  className="w-full h-11 pl-10 pr-11 rounded-lg border border-slate-300 bg-slate-50 text-[13px] text-slate-900 transition focus:bg-white focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/15"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((show) => !show)}
                  disabled={busy}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-slate-600 transition-colors"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="gapps-confirm"
                className="block text-[12px] font-medium text-slate-600 mb-1.5"
              >
                Confirm Password
              </label>
              <input
                id="gapps-confirm"
                type="password"
                maxLength={128}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Repeat password"
                disabled={busy}
                className="w-full h-11 px-3.5 rounded-lg border border-slate-300 bg-slate-50 text-[13px] text-slate-900 transition focus:bg-white focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/15"
              />
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full h-11 rounded-lg text-[13px] font-semibold bg-red-600 text-white hover:bg-red-700 shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 disabled:opacity-45 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
            >
              {busy ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Creating Account…
                </>
              ) : (
                <>
                  <UserPlus className="w-4 h-4" />
                  Create Account
                </>
              )}
            </button>

            <div className="text-center pt-1">
              <button
                type="button"
                onClick={() => {
                  setMode('signin');
                  setError(null);
                  setInfo(null);
                }}
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-slate-600 hover:text-slate-900"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back to sign in
              </button>
            </div>
          </form>
        )}

        <p className="text-[11px] text-slate-400 text-center mt-6">
          Credentials are validated against the office user sheet (Google
          Sheets). Create an account above or sign in with your existing account.
        </p>
      </div>
    </div>
  );
};
