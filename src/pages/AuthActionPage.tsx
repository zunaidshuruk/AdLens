import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  applyActionCode,
  checkActionCode,
  confirmPasswordReset,
  verifyPasswordResetCode,
} from 'firebase/auth';
import { AlertTriangle, CheckCircle2, Lock, MailCheck, RefreshCw } from 'lucide-react';
import { PasswordStrengthChecklist } from '../components/PasswordStrengthChecklist';
import { APP_NAME, APP_TAGLINE } from '../config/app';
import { AdLensLogo } from '../components/AdLensLogo';
import { useAuth } from '../context/AuthContext';
import { initFirebase } from '../lib/firebase';
import { evaluatePasswordRules, mapFirebaseErrorMessage } from '../utils/firebaseErrors';

type ActionStatus = 'loading' | 'ready' | 'success' | 'expired_or_invalid';

export const AuthActionPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, reloadUser, resendVerificationEmail, sendReset } = useAuth();

  const mode = searchParams.get('mode') || '';
  const oobCode = searchParams.get('oobCode') || '';

  const [status, setStatus] = useState<ActionStatus>('loading');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [accountEmail, setAccountEmail] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [newLinkSentMessage, setNewLinkSentMessage] = useState<string | null>(null);

  const passwordRules = evaluatePasswordRules(newPassword);

  useEffect(() => {
    let cancelled = false;

    async function processAction() {
      if (!mode || !oobCode) {
        setStatus('expired_or_invalid');
        setStatusMessage('This action link is missing required parameters or is invalid.');
        return;
      }

      const auth = await initFirebase();
      if (!auth) {
        if (!cancelled) {
          setStatus('expired_or_invalid');
          setStatusMessage('Firebase Authentication is not configured.');
        }
        return;
      }

      try {
        if (mode === 'resetPassword') {
          const email = await verifyPasswordResetCode(auth, oobCode);
          if (!cancelled) {
            setAccountEmail(email);
            setStatus('ready');
          }
          return;
        }

        if (mode === 'verifyEmail') {
          await applyActionCode(auth, oobCode);
          await reloadUser().catch(() => false);
          if (!cancelled) {
            setStatus('success');
            setStatusMessage('Your email address has been verified.');
          }
          return;
        }

        if (mode === 'recoverEmail') {
          const info = await checkActionCode(auth, oobCode);
          const restoredEmail = info?.data?.email || '';
          await applyActionCode(auth, oobCode);
          if (!cancelled) {
            setAccountEmail(restoredEmail);
            setStatus('success');
            setStatusMessage(
              restoredEmail
                ? `Your sign-in email has been restored to ${restoredEmail}.`
                : 'Your original email address has been restored.'
            );
          }
          return;
        }

        if (!cancelled) {
          setStatus('expired_or_invalid');
          setStatusMessage(`Unsupported action mode: ${mode}`);
        }
      } catch (err) {
        if (!cancelled) {
          setStatus('expired_or_invalid');
          setStatusMessage(mapFirebaseErrorMessage(err));
        }
      }
    }

    void processAction();
    return () => {
      cancelled = true;
    };
  }, [mode, oobCode, reloadUser]);

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!passwordRules.allValid) {
      setFormError(
        'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, and a number.'
      );
      return;
    }

    if (newPassword !== confirmPassword) {
      setFormError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const auth = await initFirebase();
      if (!auth) {
        throw new Error('Firebase Authentication is not configured.');
      }
      await confirmPasswordReset(auth, oobCode, newPassword);
      setStatus('success');
      setStatusMessage('Your password has been updated. You can now sign in with your new password.');
    } catch (err) {
      setFormError(mapFirebaseErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendNewLink = async () => {
    setFormError(null);
    setNewLinkSentMessage(null);

    if (mode === 'verifyEmail') {
      if (user) {
        try {
          setSubmitting(true);
          await resendVerificationEmail();
          setNewLinkSentMessage('A new verification link has been sent to your inbox.');
        } catch (err) {
          setFormError(err instanceof Error ? err.message : 'Unable to send a new link.');
        } finally {
          setSubmitting(false);
        }
      } else {
        navigate('/verify-email');
      }
      return;
    }

    if (accountEmail) {
      try {
        setSubmitting(true);
        await sendReset(accountEmail);
        setNewLinkSentMessage("If an account exists for that email, we've sent a reset link.");
      } catch (err) {
        setFormError(err instanceof Error ? err.message : 'Unable to send a new reset link.');
      } finally {
        setSubmitting(false);
      }
    } else {
      navigate('/forgot-password');
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-center items-center px-4 py-10 bg-page text-fg">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center text-center space-y-2">
          <AdLensLogo className="w-12 h-12" />
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-fg">
            {mode === 'resetPassword'
              ? 'Choose a new password'
              : mode === 'verifyEmail'
                ? 'Email verification'
                : mode === 'recoverEmail'
                  ? 'Email recovery'
                  : 'Account action'}
          </h1>
          <p className="text-xs sm:text-sm text-fg-muted">
            {APP_TAGLINE}
          </p>
        </div>

        <div className="p-6 sm:p-8 rounded-2xl border border-line bg-surface shadow-xs space-y-5">
          {status === 'loading' && (
            <div className="py-8 flex flex-col items-center justify-center gap-3 text-center">
              <RefreshCw className="w-6 h-6 text-accent-text animate-spin" />
              <p className="text-xs sm:text-sm text-fg-muted">
                Verifying your security link...
              </p>
            </div>
          )}

          {status === 'ready' && mode === 'resetPassword' && (
            <form onSubmit={handleResetPasswordSubmit} className="space-y-4">
              {accountEmail && (
                <div className="p-3 rounded-xl bg-fill-1 border border-line text-xs text-fg-muted">
                  Resetting password for{' '}
                  <span className="font-mono font-semibold text-fg">
                    {accountEmail}
                  </span>
                </div>
              )}

              {formError && (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 p-3.5 rounded-xl border border-danger-line bg-danger-soft text-xs text-danger"
                >
                  <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="space-y-1.5">
                <label
                  htmlFor="action-new-password"
                  className="block text-xs font-semibold text-fg"
                >
                  New password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-fg-subtle absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="action-new-password"
                    type="password"
                    required
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                    className="w-full pl-9 pr-3.5 py-2.5 text-xs sm:text-sm rounded-xl border border-line bg-fill-1 text-fg focus:outline-none focus:ring-2 focus:ring-focus"
                  />
                </div>
                <PasswordStrengthChecklist password={newPassword} />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="action-confirm-password"
                  className="block text-xs font-semibold text-fg"
                >
                  Confirm new password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-fg-subtle absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="action-confirm-password"
                    type="password"
                    required
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                    className="w-full pl-9 pr-3.5 py-2.5 text-xs sm:text-sm rounded-xl border border-line bg-fill-1 text-fg focus:outline-none focus:ring-2 focus:ring-focus"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 px-4 rounded-xl text-xs sm:text-sm font-semibold text-on-accent bg-accent hover:bg-accent-hover transition-colors cursor-pointer disabled:opacity-50"
              >
                {submitting ? 'Updating password...' : 'Save new password'}
              </button>
            </form>
          )}

          {status === 'success' && (
            <div className="space-y-4 text-center py-2">
              <div className="w-12 h-12 rounded-full bg-success-soft text-success flex items-center justify-center mx-auto">
                {mode === 'verifyEmail' ? (
                  <MailCheck className="w-6 h-6" />
                ) : (
                  <CheckCircle2 className="w-6 h-6" />
                )}
              </div>

              <p className="text-xs sm:text-sm text-fg leading-relaxed">
                {statusMessage}
              </p>

              {newLinkSentMessage && (
                <div className="p-3 rounded-xl bg-success-soft border border-success-line text-xs text-success">
                  {newLinkSentMessage}
                </div>
              )}

              {mode === 'verifyEmail' && (
                <button
                  type="button"
                  onClick={async () => {
                    await reloadUser().catch(() => false);
                    navigate('/', { replace: true });
                  }}
                  className="w-full py-2.5 px-4 rounded-xl text-xs sm:text-sm font-semibold text-on-accent bg-accent hover:bg-accent-hover transition-colors cursor-pointer"
                >
                  Continue to {APP_NAME}
                </button>
              )}

              {mode === 'resetPassword' && (
                <button
                  type="button"
                  onClick={() => navigate('/sign-in', { replace: true })}
                  className="w-full py-2.5 px-4 rounded-xl text-xs sm:text-sm font-semibold text-on-accent bg-accent hover:bg-accent-hover transition-colors cursor-pointer"
                >
                  Sign in with new password
                </button>
              )}

              {mode === 'recoverEmail' && (
                <div className="space-y-2.5">
                  <p className="text-xs text-fg-muted">
                    If you did not initiate that email change, we recommend resetting your password right away.
                  </p>
                  <button
                    type="button"
                    onClick={handleSendNewLink}
                    disabled={submitting}
                    className="w-full py-2.5 px-4 rounded-xl text-xs sm:text-sm font-semibold text-on-accent bg-accent hover:bg-accent-hover transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {submitting ? 'Sending reset link...' : 'Reset your password'}
                  </button>
                  <Link
                    to="/sign-in"
                    className="block text-xs font-semibold text-accent-text hover:underline pt-1"
                  >
                    Return to sign in
                  </Link>
                </div>
              )}
            </div>
          )}

          {status === 'expired_or_invalid' && (
            <div className="space-y-4 text-center py-2">
              <div className="w-12 h-12 rounded-full bg-warning-soft text-warning flex items-center justify-center mx-auto">
                <AlertTriangle className="w-6 h-6" />
              </div>

              <div className="space-y-1">
                <h2 className="text-sm font-semibold text-fg">
                  Link expired or already used
                </h2>
                <p className="text-xs text-fg-muted leading-relaxed">
                  {statusMessage}
                </p>
              </div>

              {newLinkSentMessage && (
                <div className="p-3 rounded-xl bg-success-soft border border-success-line text-xs text-success">
                  {newLinkSentMessage}
                </div>
              )}

              {formError && (
                <div className="p-3 rounded-xl bg-danger-soft border border-danger-line text-xs text-danger">
                  {formError}
                </div>
              )}

              <button
                type="button"
                onClick={handleSendNewLink}
                disabled={submitting}
                className="w-full py-2.5 px-4 rounded-xl text-xs sm:text-sm font-semibold text-on-accent bg-accent hover:bg-accent-hover transition-colors cursor-pointer disabled:opacity-50"
              >
                {submitting ? 'Sending...' : 'Send a new link'}
              </button>

              <Link
                to="/sign-in"
                className="block text-xs font-semibold text-accent-text hover:underline pt-1"
              >
                Back to sign in
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
