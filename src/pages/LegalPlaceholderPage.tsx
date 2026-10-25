import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, FileText } from 'lucide-react';
import { APP_NAME, APP_TAGLINE } from '../config/app';
import { AdLensLogo } from '../components/AdLensLogo';

interface LegalPlaceholderPageProps {
  title: string;
}

export const LegalPlaceholderPage: React.FC<LegalPlaceholderPageProps> = ({ title }) => {
  return (
    <div className="min-h-screen flex flex-col justify-center items-center px-4 py-10 bg-page text-fg">
      <div className="w-full max-w-lg space-y-6">
        <div className="flex flex-col items-center text-center space-y-2">
          <AdLensLogo className="w-12 h-12" />
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-fg">
            {title}
          </h1>
          <p className="text-xs sm:text-sm text-fg-muted">
            {APP_NAME} — {APP_TAGLINE}
          </p>
        </div>

        <div className="p-6 sm:p-8 rounded-2xl border border-line bg-surface shadow-xs space-y-4 text-center">
          <div className="w-10 h-10 rounded-full bg-accent-soft text-accent-text flex items-center justify-center mx-auto">
            <FileText className="w-5 h-5" />
          </div>

          <p className="text-sm font-medium text-fg">
            Coming soon — final version before public launch
          </p>

          <div className="pt-3 border-t border-line">
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent-text hover:underline"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Return to {APP_NAME}</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};
