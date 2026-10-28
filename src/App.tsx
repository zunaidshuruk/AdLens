/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { CookieNotice } from './components/CookieNotice';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { TwoStepGate } from './components/TwoStepGate';
import { APP_NAME, APP_TAGLINE } from './config/app';
import { AppProvider } from './context/AppContext';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { AuthActionPage } from './pages/AuthActionPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { LandingPage } from './pages/LandingPage';
import { LegalPage } from './pages/LegalPage';
import { DataDeletionPage } from './pages/DataDeletionPage';
import { SignInPage } from './pages/SignInPage';
import { SignUpPage } from './pages/SignUpPage';
import { SignInBlockedPage } from './pages/SignInBlockedPage';
import { VerifyEmailPage } from './pages/VerifyEmailPage';

// Each screen is loaded when first opened, so the first page a visitor sees downloads far less code (Sprint 18).
const AdminLoginPage = lazy(() => import('./pages/AdminLoginPage').then((m) => ({ default: m.AdminLoginPage })));
const AdminPage = lazy(() => import('./pages/AdminPage').then((m) => ({ default: m.AdminPage })));
const AgentDeveloperPage = lazy(() => import('./pages/AgentDeveloperPage').then((m) => ({ default: m.AgentDeveloperPage })));
const AgentsPage = lazy(() => import('./pages/AgentsPage').then((m) => ({ default: m.AgentsPage })));
const AIAnalystPage = lazy(() => import('./pages/AIAnalystPage').then((m) => ({ default: m.AIAnalystPage })));
const AITrafficPage = lazy(() => import('./pages/AITrafficPage').then((m) => ({ default: m.AITrafficPage })));
const ConnectionsPage = lazy(() => import('./pages/ConnectionsPage').then((m) => ({ default: m.ConnectionsPage })));
const CrossChannelPage = lazy(() => import('./pages/CrossChannelPage').then((m) => ({ default: m.CrossChannelPage })));
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const SharedPage = lazy(() => import('./pages/SharedPage').then((m) => ({ default: m.SharedPage })));
const AlertsPage = lazy(() => import('./pages/AlertsPage').then((m) => ({ default: m.AlertsPage })));
const DashboardsPage = lazy(() => import('./pages/DashboardsPage').then((m) => ({ default: m.DashboardsPage })));
const ExplorePage = lazy(() => import('./pages/ExplorePage').then((m) => ({ default: m.ExplorePage })));
const GA4Page = lazy(() => import('./pages/GA4Page').then((m) => ({ default: m.GA4Page })));
const MetaAdsPage = lazy(() => import('./pages/MetaAdsPage').then((m) => ({ default: m.MetaAdsPage })));
const OverviewPage = lazy(() => import('./pages/OverviewPage').then((m) => ({ default: m.OverviewPage })));
const PageDetailPage = lazy(() => import('./pages/PageDetailPage').then((m) => ({ default: m.PageDetailPage })));
const PagesPage = lazy(() => import('./pages/PagesPage').then((m) => ({ default: m.PagesPage })));
const SearchIntelligencePage = lazy(() => import('./pages/SearchIntelligencePage').then((m) => ({ default: m.SearchIntelligencePage })));
const SnapshotPage = lazy(() => import('./pages/SnapshotPage').then((m) => ({ default: m.SnapshotPage })));
const McpAccessPage = lazy(() => import('./pages/McpAccessPage').then((m) => ({ default: m.McpAccessPage })));
const McpAuthorizePage = lazy(() => import('./pages/McpAuthorizePage').then((m) => ({ default: m.McpAuthorizePage })));
const SearchConsolePage = lazy(() => import('./pages/SearchConsolePage').then((m) => ({ default: m.SearchConsolePage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));

const PageFallback = () => (
  <div role="status" aria-live="polite" className="p-8 text-sm text-fg-muted">Loading…</div>
);

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
            <Suspense fallback={<PageFallback />}>
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
                  <Route path="/mcp-access" element={<McpAccessPage />} />
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
                  <Route path="/dashboards/:id" element={<DashboardPage />} />
                  <Route path="/explore" element={<ExplorePage />} />
                  <Route path="/agents" element={<AgentsPage />} />
                  <Route path="/agents/developers" element={<AgentDeveloperPage />} />
                  <Route path="/ai-analyst" element={<AIAnalystPage />} />
                  <Route path="/connections" element={<ConnectionsPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                </Route>
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </Suspense>
          </BrowserRouter>
        </ThemeProvider>
      </AppProvider>
    </AuthProvider>
  );
}
