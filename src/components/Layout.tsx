import React, { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { APP_NAME } from '../config/app';
import { pageTitleFor } from '../utils/pageTitle.js';
import { Header } from './Header';
import { CommandPalette } from './CommandPalette';
import { InstallBanner } from './InstallBanner';
import { MobileNav } from './MobileNav';
import { ProjectOnboardingModal } from './ProjectOnboardingModal';
import { JoinOfferPrompt } from './JoinOfferPrompt';
import { Sidebar } from './Sidebar';
import { TwoStepRuleBanner } from './TwoStepRuleBanner';

export const Layout: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    document.title = pageTitleFor(pathname, APP_NAME);
  }, [pathname]);

  return (
    <div className="min-h-screen flex bg-page text-fg">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col min-w-0">
        <Header onOpenSidebar={() => setSidebarOpen(true)} />

        <main className="flex-1 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:px-6 lg:px-8 pt-6 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-6 max-w-[1600px] w-full mx-auto">
          <TwoStepRuleBanner />
          <InstallBanner />
          <Outlet />
        </main>
      </div>

      <MobileNav onOpenMenu={() => setSidebarOpen(true)} />
      <ProjectOnboardingModal />
      <CommandPalette />
      <JoinOfferPrompt />
    </div>
  );
};
