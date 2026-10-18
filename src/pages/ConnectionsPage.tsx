import React from 'react';
import { BarChart3, Lock, Megaphone, Search } from 'lucide-react';
import { ConnectionStatus } from '../components/ConnectionStatus';
import { APP_NAME, TRACKED_SITE } from '../config/app';
import { useAdapterStatus } from '../hooks';

export const ConnectionsPage: React.FC = () => {
  const { sources } = useAdapterStatus();

  const connectionCards = [
    {
      id: 'ga4',
      name: 'Google Analytics 4',
      description: `Property telemetry, session acquisition, UTM campaign attribution, and key conversion events for ${TRACKED_SITE.name} (${TRACKED_SITE.domain}).`,
      buttonLabel: 'Available in Sprint 2',
      sprintNote: 'Google OAuth 2.0 & GA4 Data API integration scheduled for Sprint 2',
      icon: BarChart3,
    },
    {
      id: 'search_console',
      name: 'Google Search Console',
      description: `Organic search queries, indexed landing pages, geographic impressions, and SERP rank tracking for ${TRACKED_SITE.domain}.`,
      buttonLabel: 'Available in Sprint 2',
      sprintNote: 'Google Search Console API integration scheduled for Sprint 2',
      icon: Search,
    },
    {
      id: 'meta_ads',
      name: 'Meta Ads',
      description: `Campaign, Ad Set, and Ad delivery metrics including spend, reach, frequency, clicks, CPC, CPM, and lead generation for ${TRACKED_SITE.name}.`,
      buttonLabel: 'Available in Sprint 5',
      sprintNote: 'Meta Marketing API integration scheduled for Sprint 5',
      icon: Megaphone,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
          Data Source Connections
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
          Manage data adapters powering {APP_NAME} for {TRACKED_SITE.name} ({TRACKED_SITE.domain})
        </p>
      </div>

      {/* Data Source Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {connectionCards.map((card) => {
          const adapter = sources.find((s) => s.id === card.id);
          const Icon = card.icon;
          const isMock = adapter?.isMock ?? true;

          return (
            <div
              key={card.id}
              className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col justify-between gap-5"
            >
              <div className="flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950/70 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {card.name}
                      </h2>
                      <div className="text-xs text-amber-700 dark:text-amber-400 font-medium mt-0.5">
                        {isMock ? 'Mock data' : 'Connected'}
                      </div>
                    </div>
                  </div>
                </div>

                <p className="mt-4 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  {card.description}
                </p>
              </div>

              <div className="mt-auto pt-4 border-t border-slate-200/70 dark:border-slate-800/70 space-y-2">
                <button
                  type="button"
                  disabled
                  aria-label={`Connect ${card.name} (${card.buttonLabel})`}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 cursor-not-allowed"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>Connect · {card.buttonLabel}</span>
                </button>
                <p className="text-[11px] text-slate-400 dark:text-slate-500 text-center">
                  {card.sprintNote}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Server Status Row from /api/health */}
      <div>
        <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2.5">
          Backend Infrastructure Telemetry
        </h2>
        <ConnectionStatus />
      </div>
    </div>
  );
};
