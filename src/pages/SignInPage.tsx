import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Lock, Mail } from 'lucide-react';
import { APP_NAME, APP_TAGLINE } from '../config/app';
import { AdLensLogo } from '../components/AdLensLogo';
import { MfaCodeForm } from '../components/MfaCodeForm';
import { useAuth } from '../context/AuthContext';
import { useCompanySso } from '../hooks/useCompanySso';
import { MfaChallenge } from '../lib/mfa';

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
    signInWithCompany,
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
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null);
  const company = useCompanySso(email);

  // Only a path inside AdLens ("/settings"), never another website ("//evil.com", "https://...", "/\\evil.com").
  const wanted = searchParams.get('redirect') || (location.state as { from?: string } | null)?.from || '/';
  const redirectTarget = /^\/(?![/\\])/.test(wanted) ? wanted : '/';

  const accountDeletedMessage =
    (location.state as { accountDeletedMessage?: string } | null)?.accountDeletedMessage ||
    (searchParams.get('deleted') === '1' ? 'Your account was deleted.' : null);

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
      if (err instanceof MfaChallenge) { setChallenge(err); return; }
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
      if (err instanceof MfaChallenge) { setChallenge(err); return; }
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
      if (err instanceof MfaChallenge) { setChallenge(err); return; }
      setError(err instanceof Error ? err.message : 'Unable to sign in with Microsoft.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCompany = async () => {
    if (!company) return;
    setError(null);
    setSubmitting(true);
    try {
      await signInWithCompany(company.providerId);
    } catch (err) {
      if (err instanceof MfaChallenge) { setChallenge(err); return; }
      setError(err instanceof Error ? err.message : 'Unable to sign in with your company account.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-center items-center px-4 py-10 bg-page text-fg">
      <div className="w-full max-w-md space-y-6">
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center space-y-2">
          <AdLensLogo className="w-12 h-12" />
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-fg">
            Sign in to {APP_NAME}
          </h1>
          <p className="text-xs sm:text-sm text-fg-muted">
            {APP_TAGLINE}
          </p>
        </div>

        {/* Card */}
        <div className="p-6 sm:p-8 rounded-2xl border border-line bg-surface shadow-xs space-y-5">
          {accountDeletedMessage && (
            <div
              role="status"
              data-testid="account-deleted-banner"
              className="p-3.5 rounded-xl border border-success-line bg-success-soft text-xs text-success leading-relaxed"
            >
              {accountDeletedMessage}
            </div>
          )}

          {pendingLinkProviderLabel && (
            <div
              role="status"
              data-testid="account-linking-banner"
              className="p-3.5 rounded-xl border border-warning-line bg-warning-soft text-xs text-warning leading-relaxed"
            >
              You already have an AdLens account with this email. Sign in with your existing method to link {pendingLinkProviderLabel}.
            </div>
          )}

          {error && (
            <div
              role="alert"
              data-testid="auth-error-banner"
              className="flex items-start gap-2.5 p-3.5 rounded-xl border border-danger-line bg-danger-soft text-xs text-danger"
            >
              <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {challenge && <MfaCodeForm resolver={challenge.resolver} onCancel={() => setChallenge(null)} />}

          {!challenge && company && (
            <button
              type="button"
              data-testid="company-sso-button"
              onClick={handleCompany}
              disabled={submitting}
              className="w-full py-2.5 px-4 rounded-xl text-xs sm:text-sm font-semibold text-on-accent bg-accent hover:bg-accent-hover transition-colors cursor-pointer disabled:opacity-50"
            >
              Continue with {company.displayName}
            </button>
          )}

          {!challenge && showPassword && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="signin-email"
                  className="block text-xs font-semibold text-fg"
                >
                  Email address
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-fg-subtle absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="signin-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="w-full pl-9 pr-3.5 py-2.5 text-xs sm:text-sm rounded-xl border border-line bg-fill-1 text-fg focus:outline-none focus:ring-2 focus:ring-focus"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="signin-password"
                    className="block text-xs font-semibold text-fg"
                  >
                    Password
                  </label>
                  <Link
                    to="/forgot-password"
                    className="text-xs font-medium text-accent-text hover:underline"
                  >
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 text-fg-subtle absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="signin-password"
                    type="password"
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-9 pr-3.5 py-2.5 text-xs sm:text-sm rounded-xl border border-line bg-fill-1 text-fg focus:outline-none focus:ring-2 focus:ring-focus"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 px-4 rounded-xl text-xs sm:text-sm font-semibold text-on-accent bg-accent hover:bg-accent-hover transition-colors cursor-pointer disabled:opacity-50"
              >
                {submitting ? 'Signing in...' : 'Sign in'}
              </button>
            </form>
          )}

          {!challenge && showPassword && hasSso && (
            <div className="relative flex items-center justify-center">
              <div className="border-t border-line w-full" />
              <span className="bg-surface px-3 text-[11px] font-medium text-fg-subtle uppercase tracking-wider">
                or continue with
              </span>
              <div className="border-t border-line w-full" />
            </div>
          )}

          {!challenge && hasSso && (
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
                  className="flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl border border-line bg-fill-1 hover:bg-fill-2 text-xs font-semibold text-fg transition-colors cursor-pointer disabled:opacity-50"
                >
                  <span>Google</span>
                </button>
              )}
              {showMicrosoft && (
                <button
                  type="button"
                  onClick={handleMicrosoft}
                  disabled={submitting}
                  className="flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl border border-line bg-fill-1 hover:bg-fill-2 text-xs font-semibold text-fg transition-colors cursor-pointer disabled:opacity-50"
                >
                  <span>Microsoft</span>
                </button>
              )}
            </div>
          )}
        </div>

        <p className="text-center text-xs text-fg-muted">
          Don&apos;t have an account?{' '}
          <Link
            to="/sign-up"
            className="font-semibold text-accent-text hover:underline"
          >
            Create account
          </Link>
        </p>
      </div>
    </div>
  );
};
