/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { APP_NAME, APP_TAGLINE } from './config/app';
import { AppProvider } from './context/AppContext';
import { AIAnalystPage } from './pages/AIAnalystPage';
import { ConnectionsPage } from './pages/ConnectionsPage';
import { GA4Page } from './pages/GA4Page';
import { MetaAdsPage } from './pages/MetaAdsPage';
import { OverviewPage } from './pages/OverviewPage';
import { SearchConsolePage } from './pages/SearchConsolePage';
import { SettingsPage } from './pages/SettingsPage';

export default function App() {
  useEffect(() => {
    document.title = `${APP_NAME} — ${APP_TAGLINE}`;
  }, []);

  return (
    <AppProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/ga4" element={<GA4Page />} />
            <Route path="/search-console" element={<SearchConsolePage />} />
            <Route path="/meta-ads" element={<MetaAdsPage />} />
            <Route path="/ai-analyst" element={<AIAnalystPage />} />
            <Route path="/connections" element={<ConnectionsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppProvider>
  );
}
