import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { APP_NAME, APP_TAGLINE } from '../config/app';
import { useAuth } from '../context/AuthContext';
import { AdLensLogo } from './AdLensLogo';

export const ProtectedRoute: React.FC = () => {
  const { user, loading, emailVerified } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-6">
        <div className="flex flex-col items-center gap-3">
          <AdLensLogo className="w-12 h-12 animate-pulse" />
          <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
            {APP_NAME} — {APP_TAGLINE}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Verifying your session...
          </div>
        </div>
      </div>
    );
  }

  const returnPath = `${location.pathname}${location.search}`;

  if (!user) {
    return (
      <Navigate
        to={`/sign-in${returnPath && returnPath !== '/' ? `?redirect=${encodeURIComponent(returnPath)}` : ''}`}
        state={{ from: returnPath }}
        replace
      />
    );
  }

  if (!emailVerified) {
    return <Navigate to="/verify-email" state={{ from: returnPath }} replace />;
  }

  return <Outlet />;
};
