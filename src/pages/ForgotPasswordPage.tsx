import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, CheckCircle2, Mail } from 'lucide-react';
import { APP_NAME, APP_TAGLINE } from '../config/app';
import { AdLensLogo } from '../components/AdLensLogo';
import { useAuth } from '../context/AuthContext';

export const RESET_CONFIRMATION_MESSAGE =
  "If an account exists for that email, we've sent a reset link.";

export const ForgotPasswordPage: React.FC = () => {
  const { sendReset } = useAuth();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await sendReset(email.trim());
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send reset request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-center items-center px-4 py-10 bg-page text-fg">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center text-center space-y-2">
          <AdLensLogo className="w-12 h-12" />
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-fg">
            Reset your password
          </h1>
          <p className="text-xs sm:text-sm text-fg-muted">
            {APP_TAGLINE}
          </p>
        </div>

        <div className="p-6 sm:p-8 rounded-2xl border border-line bg-surface shadow-xs space-y-5">
          {submitted && (
            <div
              role="status"
              data-testid="forgot-password-confirmation"
              className="flex items-start gap-2.5 p-4 rounded-xl border border-success-line bg-success-soft text-xs sm:text-sm text-success"
            >
              <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" />
              <span>{RESET_CONFIRMATION_MESSAGE}</span>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2.5 p-3.5 rounded-xl border border-danger-line bg-danger-soft text-xs text-danger"
            >
              <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="forgot-email"
                className="block text-xs font-semibold text-fg"
              >
                Email address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-fg-subtle absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="forgot-email"
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

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 px-4 rounded-xl text-xs sm:text-sm font-semibold text-on-accent bg-accent hover:bg-accent-hover transition-colors cursor-pointer disabled:opacity-50"
            >
              {submitting ? 'Sending link...' : 'Send reset link'}
            </button>
          </form>

          <div className="pt-2 border-t border-line text-center">
            <Link
              to="/sign-in"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent-text hover:underline"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to sign in</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};
