import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, FileText } from 'lucide-react';
import { APP_NAME, APP_TAGLINE } from '../config/app';

interface LegalPlaceholderPageProps {
  title: string;
}

export const LegalPlaceholderPage: React.FC<LegalPlaceholderPageProps> = ({ title }) => {
  return (
    <div className="min-h-screen flex flex-col justify-center items-center px-4 py-10 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <div className="w-full max-w-lg space-y-6">
        <div className="flex flex-col items-center text-center space-y-2">
          <div className="w-11 h-11 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold text-lg tracking-tight shadow-xs">
            {APP_NAME.slice(0, 2).toUpperCase()}
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            {title}
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
            {APP_NAME} — {APP_TAGLINE}
          </p>
        </div>

        <div className="p-6 sm:p-8 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4 text-center">
          <div className="w-10 h-10 rounded-full bg-blue-50 dark:bg-blue-950/70 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto">
            <FileText className="w-5 h-5" />
          </div>

          <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
            Coming soon — final version before public launch
          </p>

          <div className="pt-3 border-t border-slate-200/80 dark:border-slate-800">
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
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
