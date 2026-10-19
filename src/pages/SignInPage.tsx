import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Lock, Mail } from 'lucide-react';
import { APP_NAME, APP_TAGLINE } from '../config/app';
import { AdLensLogo } from '../components/AdLensLogo';
import { useAuth } from '../context/AuthContext';

export const SignInPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const {
    user,
    emailVerified,
    enabledProviders,
    signIn,
    signInWithGoogle,
    signInWithMicrosoft,
    pendingLinkEmail,
    pendingLinkProviderLabel,
  } = useAuth();

  const showPassword = enabledProviders.includes('password');
  const showGoogle = enabledProviders.includes('google');
  const showMicrosoft = enabledProviders.includes('microsoft');
  const hasSso = showGoogle || showMicrosoft;

  const [email, setEmail] = useState(pendingLinkEmail || '');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redirectTarget =
    searchParams.get('redirect') ||
    (location.state as { from?: string } | null)?.from ||
    '/';

  useEffect(() => {
    if (pendingLinkEmail && !email) {
      setEmail(pendingLinkEmail);
    }
  }, [pendingLinkEmail, email]);

  useEffect(() => {
    if (user) {
      if (emailVerified) {
        navigate(redirectTarget, { replace: true });
      } else {
        navigate('/verify-email', { replace: true });
      }
    }
  }, [user, emailVerified, navigate, redirectTarget]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in with Google.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleMicrosoft = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await signInWithMicrosoft();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in with Microsoft.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-center items-center px-4 py-10 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <div className="w-full max-w-md space-y-6">
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center space-y-2">
          <AdLensLogo className="w-12 h-12" />
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Sign in to {APP_NAME}
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
            {APP_TAGLINE}
          </p>
        </div>

        {/* Card */}
        <div className="p-6 sm:p-8 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-5">
          {pendingLinkProviderLabel && (
            <div
              role="status"
              data-testid="account-linking-banner"
              className="p-3.5 rounded-xl border border-amber-200 dark:border-amber-800/80 bg-amber-50/80 dark:bg-amber-950/40 text-xs text-amber-900 dark:text-amber-200 leading-relaxed"
            >
              You already have an AdLens account with this email. Sign in with your existing method to link {pendingLinkProviderLabel}.
            </div>
          )}

          {error && (
            <div
              role="alert"
              data-testid="auth-error-banner"
              className="flex items-start gap-2.5 p-3.5 rounded-xl border border-red-200 dark:border-red-900/70 bg-red-50/80 dark:bg-red-950/40 text-xs text-red-800 dark:text-red-200"
            >
              <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {showPassword && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="signin-email"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                >
                  Email address
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="signin-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="w-full pl-9 pr-3.5 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="signin-password"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                  >
                    Password
                  </label>
                  <Link
                    to="/forgot-password"
                    className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="signin-password"
                    type="password"
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-9 pr-3.5 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 px-4 rounded-xl text-xs sm:text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors cursor-pointer disabled:opacity-50"
              >
                {submitting ? 'Signing in...' : 'Sign in'}
              </button>
            </form>
          )}

          {showPassword && hasSso && (
            <div className="relative flex items-center justify-center">
              <div className="border-t border-slate-200 dark:border-slate-800 w-full" />
              <span className="bg-white dark:bg-slate-900 px-3 text-[11px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                or continue with
              </span>
              <div className="border-t border-slate-200 dark:border-slate-800 w-full" />
            </div>
          )}

          {hasSso && (
            <div
              className={`grid grid-cols-1 ${
                showGoogle && showMicrosoft ? 'sm:grid-cols-2' : ''
              } gap-2.5`}
            >
              {showGoogle && (
                <button
                  type="button"
                  onClick={handleGoogle}
                  disabled={submitting}
                  className="flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-200 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <span>Google</span>
                </button>
              )}
              {showMicrosoft && (
                <button
                  type="button"
                  onClick={handleMicrosoft}
                  disabled={submitting}
                  className="flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-200 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <span>Microsoft</span>
                </button>
              )}
            </div>
          )}
        </div>

        <p className="text-center text-xs text-slate-500 dark:text-slate-400">
          Don&apos;t have an account?{' '}
          <Link
            to="/sign-up"
            className="font-semibold text-blue-600 dark:text-blue-400 hover:underline"
          >
            Create account
          </Link>
        </p>
      </div>
    </div>
  );
};
