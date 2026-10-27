import React from 'react';
import { Link } from 'react-router-dom';
import { APP_NAME } from '../config/app';
import { AdLensLogo } from './AdLensLogo';

/** Header and footer for pages anyone can open without signing in (landing, legal, data deletion). */
export const PublicShell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-screen flex flex-col bg-page text-fg">
    <header className="border-b border-line bg-surface">
      <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between gap-3">
        <Link to="/welcome" className="flex items-center gap-2 font-semibold text-fg">
          <AdLensLogo className="w-7 h-7" />
          <span>{APP_NAME}</span>
        </Link>
        <nav className="flex items-center gap-2 text-sm">
          <Link to="/sign-in" className="px-3 py-1.5 rounded-lg text-fg-muted hover:text-fg">Sign in</Link>
          <Link to="/sign-up" className="px-3 py-1.5 rounded-lg bg-accent text-on-accent hover:bg-accent-hover font-medium">Create account</Link>
        </nav>
      </div>
    </header>
    <main className="flex-1 mx-auto w-full max-w-5xl px-4 py-8">{children}</main>
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto max-w-5xl px-4 py-4 flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
        <span>{APP_NAME}</span>
        <nav className="flex gap-4">
          <Link to="/privacy" className="hover:text-fg underline">Privacy Policy</Link>
          <Link to="/terms" className="hover:text-fg underline">Terms of Service</Link>
          <Link to="/data-deletion" className="hover:text-fg underline">Data deletion</Link>
        </nav>
      </div>
    </footer>
  </div>
);
