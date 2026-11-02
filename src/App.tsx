/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { CookieNotice } from './components/CookieNotice';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { TwoStepGate } from './components/TwoStepGate';
import { APP_NAME, APP_TAGLINE } from './config/app';
import { AppProvider } from './context/AppContext';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { AdminLoginPage } from './pages/AdminLoginPage';
import { AdminPage } from './pages/AdminPage';
import { AgentDeveloperPage } from './pages/AgentDeveloperPage';
import { AIAnalystPage } from './pages/AIAnalystPage';
import { AiHubPage } from './pages/AiHubPage';
import { AITrafficPage } from './pages/AITrafficPage';
import { AlertsPage } from './pages/AlertsPage';
import { AuthActionPage } from './pages/AuthActionPage';
import { ConnectionsPage } from './pages/ConnectionsPage';
import { CrossChannelPage } from './pages/CrossChannelPage';
import { DashboardPage } from './pages/DashboardPage';
import { DashboardsPage } from './pages/DashboardsPage';
import { DataDeletionPage } from './pages/DataDeletionPage';
import { ExplorePage } from './pages/ExplorePage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { GA4Page } from './pages/GA4Page';
import { HelpPage } from './pages/HelpPage';
import { LandingPage } from './pages/LandingPage';
import { LeadsPage } from './pages/LeadsPage';
import { LegalPage } from './pages/LegalPage';
import { McpAuthorizePage } from './pages/McpAuthorizePage';
import { MetaAdsPage } from './pages/MetaAdsPage';
import { OverviewPage } from './pages/OverviewPage';
import { PageDetailPage } from './pages/PageDetailPage';
import { PagesPage } from './pages/PagesPage';
import { SearchConsolePage } from './pages/SearchConsolePage';
import { SearchIntelligencePage } from './pages/SearchIntelligencePage';
import { SeoPage } from './pages/SeoPage';
import { SettingsPage } from './pages/SettingsPage';
import { SharedPage } from './pages/SharedPage';
import { SignInBlockedPage } from './pages/SignInBlockedPage';
import { SignInPage } from './pages/SignInPage';
import { SignUpPage } from './pages/SignUpPage';
import { SnapshotPage } from './pages/SnapshotPage';
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
            <CookieNotice />
            <Routes>
              {/* Public authentication & legal routes */}
              <Route path="/sign-in" element={<SignInPage />} />
              <Route path="/sign-up" element={<SignUpPage />} />
              <Route path="/sign-in-blocked" element={<SignInBlockedPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/auth/action" element={<AuthActionPage />} />
              <Route path="/verify-email" element={<VerifyEmailPage />} />
              <Route path="/welcome" element={<LandingPage />} />
              <Route path="/s/:token" element={<SharedPage />} />
              <Route path="/terms" element={<LegalPage kind="terms" />} />
              <Route path="/privacy" element={<LegalPage kind="privacy" />} />
              <Route path="/data-deletion" element={<DataDeletionPage />} />

              {/* Admin: its own login and its own page, outside the customer app */}
              <Route path="/admin-login" element={<AdminLoginPage />} />
              <Route path="/admin" element={<TwoStepGate><AdminPage /></TwoStepGate>} />

              {/* Protected application routes */}
              <Route element={<ProtectedRoute />}>
                <Route path="/mcp-access/authorize" element={<McpAuthorizePage />} />
                <Route element={<Layout />}>
                  <Route path="/mcp-access" element={<Navigate to="/agents" replace />} />
                  <Route path="/" element={<OverviewPage />} />
                  <Route path="/ga4" element={<GA4Page />} />
                  <Route path="/ai-traffic" element={<AITrafficPage />} />
                  <Route path="/snapshot" element={<SnapshotPage />} />
                  <Route path="/search-console" element={<SearchConsolePage />} />
                  <Route path="/search-intelligence" element={<SearchIntelligencePage />} />
                  <Route path="/pages" element={<PagesPage />} />
                  <Route path="/pages/detail" element={<PageDetailPage />} />
                  <Route path="/cross-channel" element={<CrossChannelPage />} />
                  <Route path="/meta-ads" element={<MetaAdsPage />} />
                  <Route path="/dashboards" element={<DashboardsPage />} />
                  <Route path="/alerts" element={<AlertsPage />} />
                  <Route path="/seo" element={<SeoPage />} />
                  <Route path="/help" element={<HelpPage />} />
                  <Route path="/leads" element={<LeadsPage />} />
                  <Route path="/dashboards/:id" element={<DashboardPage />} />
                  <Route path="/explore" element={<ExplorePage />} />
                  <Route path="/agents" element={<AiHubPage />} />
                  <Route path="/agents/developers" element={<AgentDeveloperPage />} />
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
