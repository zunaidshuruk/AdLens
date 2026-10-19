import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, LogOut, Mail, RefreshCw } from 'lucide-react';
import { APP_NAME, APP_TAGLINE } from '../config/app';
import { AdLensLogo } from '../components/AdLensLogo';
import { useAuth } from '../context/AuthContext';

export const VerifyEmailPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, loading, emailVerified, resendVerificationEmail, reloadUser, signOut } = useAuth();

  const [cooldown, setCooldown] = useState<number>(0);
  const [resending, setResending] = useState<boolean>(false);
  const [checking, setChecking] = useState<boolean>(false);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );

  useEffect(() => {
    if (!loading && !user) {
      navigate('/sign-in', { replace: true });
      return;
    }
    if (!loading && user && emailVerified) {
      navigate('/', { replace: true });
    }
  }, [loading, user, emailVerified, navigate]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => {
      setCooldown((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  const handleResend = async () => {
    if (cooldown > 0 || resending) return;
    setBanner(null);
    setResending(true);
    try {
      await resendVerificationEmail();
      setCooldown(60);
      setBanner({
        type: 'success',
        message: 'Verification email sent! Please check your inbox and spam folder.',
      });
    } catch (err) {
      setBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Unable to resend verification email.',
      });
    } finally {
      setResending(false);
    }
  };

  const handleCheckVerified = async () => {
    setBanner(null);
    setChecking(true);
    try {
      const verified = await reloadUser();
      if (verified) {
        navigate('/', { replace: true });
      } else {
        setBanner({
          type: 'error',
          message:
            'Your email is not marked as verified yet. Click the link in your email first, then press "I\'ve verified".',
        });
      }
    } catch (err) {
      setBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Unable to refresh verification status.',
      });
    } finally {
      setChecking(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/sign-in', { replace: true });
  };

  return (
    <div className="min-h-screen flex flex-col justify-center items-center px-4 py-10 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center text-center space-y-2">
          <AdLensLogo className="w-12 h-12" />
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Check your inbox
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
            {APP_TAGLINE}
          </p>
        </div>

        <div className="p-6 sm:p-8 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-5 text-center">
          <div className="w-12 h-12 rounded-full bg-blue-50 dark:bg-blue-950/70 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto">
            <Mail className="w-6 h-6" />
          </div>

          <div className="space-y-1.5">
            <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
              We sent a verification link to{' '}
              <span className="font-mono font-semibold text-slate-900 dark:text-slate-50">
                {user?.email || 'your email address'}
              </span>
              . Verify your email to access {APP_NAME}.
            </p>
          </div>

          {banner && (
            <div
              role="status"
              className={`flex items-start gap-2.5 p-3.5 rounded-xl border text-left text-xs ${
                banner.type === 'success'
                  ? 'bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                  : 'bg-red-50/80 dark:bg-red-950/40 border-red-200 dark:border-red-900/70 text-red-800 dark:text-red-200'
              }`}
            >
              {banner.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
              )}
              <span>{banner.message}</span>
            </div>
          )}

          <div className="space-y-2.5 pt-1">
            <button
              type="button"
              onClick={handleCheckVerified}
              disabled={checking}
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs sm:text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${checking ? 'animate-spin' : ''}`} />
              <span>{checking ? 'Checking status...' : "I've verified"}</span>
            </button>

            <button
              type="button"
              onClick={handleResend}
              disabled={cooldown > 0 || resending}
              className="w-full py-2.5 px-4 rounded-xl text-xs sm:text-sm font-semibold border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 transition-colors cursor-pointer disabled:opacity-50"
            >
              {resending
                ? 'Sending...'
                : cooldown > 0
                  ? `Resend verification email (${cooldown}s)`
                  : 'Resend verification email'}
            </button>
          </div>

          <div className="pt-3 border-t border-slate-200/80 dark:border-slate-800">
            <button
              type="button"
              onClick={handleSignOut}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
