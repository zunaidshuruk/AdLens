import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Header } from './Header';
import { CommandPalette } from './CommandPalette';
import { InstallBanner } from './InstallBanner';
import { MobileNav } from './MobileNav';
import { ProjectOnboardingModal } from './ProjectOnboardingModal';
import { Sidebar } from './Sidebar';

export const Layout: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen flex bg-page text-fg">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col min-w-0">
        <Header onOpenSidebar={() => setSidebarOpen(true)} />

        <main className="flex-1 px-4 sm:px-6 lg:px-8 pt-6 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-6 max-w-[1600px] w-full mx-auto">
          <InstallBanner />
          <Outlet />
        </main>
      </div>

      <MobileNav onOpenMenu={() => setSidebarOpen(true)} />
      <ProjectOnboardingModal />
      <CommandPalette />
    </div>
  );
};
