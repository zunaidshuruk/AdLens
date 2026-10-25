import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, Lock, Mail, User as UserIcon } from 'lucide-react';
import { PasswordStrengthChecklist } from '../components/PasswordStrengthChecklist';
import { APP_NAME, APP_TAGLINE } from '../config/app';
import { AdLensLogo } from '../components/AdLensLogo';
import { useAuth } from '../context/AuthContext';
import { evaluatePasswordRules } from '../utils/firebaseErrors';

export const SignUpPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, emailVerified, enabledProviders, signUp, signInWithGoogle, signInWithMicrosoft } =
    useAuth();

  const showPassword = enabledProviders.includes('password');
  const showGoogle = enabledProviders.includes('google');
  const showMicrosoft = enabledProviders.includes('microsoft');
  const hasSso = showGoogle || showMicrosoft;

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passwordRules = evaluatePasswordRules(password);

  useEffect(() => {
    if (user) {
      if (emailVerified) {
        navigate('/', { replace: true });
      } else {
        navigate('/verify-email', { replace: true });
      }
    }
  }, [user, emailVerified, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!fullName.trim()) {
      setError('Please enter your full name.');
      return;
    }

    if (!passwordRules.allValid) {
      setError(
        'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, and a number.'
      );
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    if (!acceptedTerms) {
      setError('Please agree to the Terms of Service and Privacy Policy to continue.');
      return;
    }

    setSubmitting(true);
    try {
      await signUp(fullName.trim(), email.trim(), password);
      navigate('/verify-email', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create account.');
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
      setError(err instanceof Error ? err.message : 'Unable to sign up with Google.');
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
      setError(err instanceof Error ? err.message : 'Unable to sign up with Microsoft.');
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
            Create your {APP_NAME} account
          </h1>
          <p className="text-xs sm:text-sm text-fg-muted">
            {APP_TAGLINE}
          </p>
        </div>

        {/* Card */}
        <div className="p-6 sm:p-8 rounded-2xl border border-line bg-surface shadow-xs space-y-5">
          {error && (
            <div
              role="alert"
              data-testid="signup-error-banner"
              className="flex items-start gap-2.5 p-3.5 rounded-xl border border-danger-line bg-danger-soft text-xs text-danger"
            >
              <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {showPassword && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="signup-name"
                  className="block text-xs font-semibold text-fg"
                >
                  Full name
                </label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 text-fg-subtle absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="signup-name"
                    type="text"
                    required
                    autoComplete="name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Alex Rahman"
                    className="w-full pl-9 pr-3.5 py-2.5 text-xs sm:text-sm rounded-xl border border-line bg-fill-1 text-fg focus:outline-none focus:ring-2 focus:ring-focus"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="signup-email"
                  className="block text-xs font-semibold text-fg"
                >
                  Work email
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-fg-subtle absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="signup-email"
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
                <label
                  htmlFor="signup-password"
                  className="block text-xs font-semibold text-fg"
                >
                  Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-fg-subtle absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="signup-password"
                    type="password"
                    required
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Create a strong password"
                    className="w-full pl-9 pr-3.5 py-2.5 text-xs sm:text-sm rounded-xl border border-line bg-fill-1 text-fg focus:outline-none focus:ring-2 focus:ring-focus"
                  />
                </div>
                <PasswordStrengthChecklist password={password} />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="signup-confirm-password"
                  className="block text-xs font-semibold text-fg"
                >
                  Confirm password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-fg-subtle absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="signup-confirm-password"
                    type="password"
                    required
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter your password"
                    className="w-full pl-9 pr-3.5 py-2.5 text-xs sm:text-sm rounded-xl border border-line bg-fill-1 text-fg focus:outline-none focus:ring-2 focus:ring-focus"
                  />
                </div>
              </div>

              <label className="flex items-start gap-2.5 text-xs text-fg-muted cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={acceptedTerms}
                  onChange={(e) => setAcceptedTerms(e.target.checked)}
                  className="mt-0.5 rounded border-line-strong text-accent-text focus:ring-focus"
                />
                <span>
                  I agree to the{' '}
                  <Link to="/terms" className="text-accent-text hover:underline">
                    Terms of Service
                  </Link>{' '}
                  and{' '}
                  <Link to="/privacy" className="text-accent-text hover:underline">
                    Privacy Policy
                  </Link>
                  .
                </span>
              </label>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 px-4 rounded-xl text-xs sm:text-sm font-semibold text-on-accent bg-accent hover:bg-accent-hover transition-colors cursor-pointer disabled:opacity-50"
              >
                {submitting ? 'Creating account...' : 'Create account'}
              </button>
            </form>
          )}

          {showPassword && hasSso && (
            <div className="relative flex items-center justify-center">
              <div className="border-t border-line w-full" />
              <span className="bg-surface px-3 text-[11px] font-medium text-fg-subtle uppercase tracking-wider">
                or sign up with
              </span>
              <div className="border-t border-line w-full" />
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
          Already have an account?{' '}
          <Link
            to="/sign-in"
            className="font-semibold text-accent-text hover:underline"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
};
