/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { APP_NAME, APP_TAGLINE } from './config/app';
import { AppProvider } from './context/AppContext';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { AIAnalystPage } from './pages/AIAnalystPage';
import { AITrafficPage } from './pages/AITrafficPage';
import { AuthActionPage } from './pages/AuthActionPage';
import { ConnectionsPage } from './pages/ConnectionsPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { GA4Page } from './pages/GA4Page';
import { LegalPlaceholderPage } from './pages/LegalPlaceholderPage';
import { MetaAdsPage } from './pages/MetaAdsPage';
import { OverviewPage } from './pages/OverviewPage';
import { SearchConsolePage } from './pages/SearchConsolePage';
import { SettingsPage } from './pages/SettingsPage';
import { SignInPage } from './pages/SignInPage';
import { SignUpPage } from './pages/SignUpPage';
import { VerifyEmailPage } from './pages/VerifyEmailPage';

export default function App() {
  useEffect(() => {
    document.title = `${APP_NAME} — ${APP_TAGLINE}`;
  }, []);

  return (
    <AuthProvider>
      <AppProvider>
        <ThemeProvider>
          <BrowserRouter>
            <Routes>
              {/* Public authentication & legal routes */}
              <Route path="/sign-in" element={<SignInPage />} />
              <Route path="/sign-up" element={<SignUpPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/auth/action" element={<AuthActionPage />} />
              <Route path="/verify-email" element={<VerifyEmailPage />} />
              <Route
                path="/terms"
                element={<LegalPlaceholderPage title="Terms of Service" />}
              />
              <Route
                path="/privacy"
                element={<LegalPlaceholderPage title="Privacy Policy" />}
              />

              {/* Protected application routes */}
              <Route element={<ProtectedRoute />}>
                <Route element={<Layout />}>
                  <Route path="/" element={<OverviewPage />} />
                  <Route path="/ga4" element={<GA4Page />} />
                  <Route path="/ai-traffic" element={<AITrafficPage />} />
                  <Route path="/search-console" element={<SearchConsolePage />} />
                  <Route path="/meta-ads" element={<MetaAdsPage />} />
                  <Route path="/ai-analyst" element={<AIAnalystPage />} />
                  <Route path="/connections" element={<ConnectionsPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                </Route>
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </ThemeProvider>
      </AppProvider>
    </AuthProvider>
  );
}
