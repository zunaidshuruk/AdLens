import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { APP_NAME, APP_TAGLINE } from '../config/app';
import { useAuth } from '../context/AuthContext';
import { AdLensLogo } from './AdLensLogo';
import { TwoStepGate } from './TwoStepGate';

export const ProtectedRoute: React.FC = () => {
  const { user, loading, emailVerified } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-page text-fg p-6">
        <div className="flex flex-col items-center gap-3">
          <AdLensLogo className="w-12 h-12 animate-pulse" />
          <div className="text-sm font-semibold text-fg">
            {APP_NAME} — {APP_TAGLINE}
          </div>
          <div className="text-xs text-fg-muted">
            Verifying your session...
          </div>
        </div>
      </div>
    );
  }

  const returnPath = `${location.pathname}${location.search}`;

  if (!user) {
    // First-time visitors to the home address see what AdLens is (and the links Google and Meta review) instead of a bare sign-in form.
    if (location.pathname === '/' && !location.search) return <Navigate to="/welcome" replace />;
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

  return (
    <TwoStepGate>
      <Outlet />
    </TwoStepGate>
  );
};
