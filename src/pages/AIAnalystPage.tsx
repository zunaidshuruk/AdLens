import React from 'react';
import { Bot, Lock, MessageSquare, Send } from 'lucide-react';
import { APP_NAME, DEMO_PROJECT } from '../config/app';
import { useAppContext } from '../context/AppContext';
import { useDateRange } from '../hooks';
import { formatFullDateRange } from '../utils/dateUtils';

export const AIAnalystPage: React.FC = () => {
  const { dateRange } = useDateRange();
  const { activeProject } = useAppContext();
  const TRACKED_SITE = {
    name: activeProject?.name || DEMO_PROJECT.name,
    domain: activeProject?.domain || DEMO_PROJECT.domain,
  };

  const sampleQuestions = [
    `Which Meta Ads campaign drove the lowest cost per demo_request on ${TRACKED_SITE.domain} during ${formatFullDateRange(dateRange.startDate, dateRange.endDate)}?`,
    `Compare Organic Search conversion rate vs Paid Social conversion rate for ${TRACKED_SITE.name} this period.`,
    `Which Search Console queries with high impressions have a CTR below 4% and rank between positions 4 and 10?`,
    `How did weekend traffic in Asia/Dhaka affect ${TRACKED_SITE.name} enterprise trial signups?`,
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-fg">
            AI Marketing Analyst
          </h1>
          <p className="text-xs sm:text-sm text-fg-muted mt-0.5">
            Cross-channel conversational intelligence across Google Analytics 4, Search Console, and Meta Ads
          </p>
        </div>

        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-accent-soft text-accent-text border border-accent-line self-start sm:self-center">
          <Lock className="w-3.5 h-3.5" />
          <span>Coming in Sprint 7</span>
        </span>
      </div>

      {/* Chat Console Placeholder */}
      <div className="rounded-xl border border-line bg-surface flex flex-col min-h-[480px] justify-between overflow-hidden">
        {/* Conversation Area */}
        <div className="p-6 sm:p-8 flex-1 flex flex-col items-center justify-center text-center max-w-2xl mx-auto">
          <div className="w-12 h-12 rounded-xl bg-accent text-accent-text flex items-center justify-center mb-4">
            <Bot className="w-6 h-6" />
          </div>

          <h2 className="text-lg font-bold text-fg">
            {APP_NAME} AI Analyst · Coming in Sprint 7
          </h2>

          <p className="mt-2 text-xs sm:text-sm text-fg-muted leading-relaxed">
            In Sprint 7, this workspace will connect live multi-source context from{' '}
            <span className="font-medium text-fg">
              {TRACKED_SITE.name} ({TRACKED_SITE.domain})
            </span>{' '}
            to answer natural-language marketing attribution, budget allocation, and SEO opportunity questions.
          </p>

          {/* Planned Prompt Starters */}
          <div className="mt-6 w-full text-left">
            <div className="text-xs font-semibold text-fg-muted mb-2.5">
              Example questions unlocked in Sprint 7:
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {sampleQuestions.map((q, i) => (
                <div
                  key={i}
                  className="p-3 rounded-lg border border-line bg-fill-1 text-xs text-fg-muted flex items-start gap-2.5"
                >
                  <MessageSquare className="w-3.5 h-3.5 text-accent-text shrink-0 mt-0.5" />
                  <span>{q}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Disabled Chat Composer */}
        <div className="p-4 border-t border-line bg-page/60">
          <div className="flex items-center gap-2.5 max-w-3xl mx-auto">
            <input
              type="text"
              disabled
              aria-label="Ask AI Analyst (Available in Sprint 7)"
              placeholder={`Ask ${APP_NAME} Analyst about ${TRACKED_SITE.name} campaigns, queries, or conversions (Coming in Sprint 7)...`}
              className="flex-1 px-3.5 py-2.5 text-xs rounded-lg border border-line bg-fill-2 text-fg-muted cursor-not-allowed"
            />
            <button
              type="button"
              disabled
              aria-label="Send message (Available in Sprint 7)"
              className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium rounded-lg bg-fill-3 text-fg-muted cursor-not-allowed whitespace-nowrap shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Coming in Sprint 7</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
