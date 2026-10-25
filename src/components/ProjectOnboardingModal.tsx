import { Building2, Globe, Loader2, Plus, Sparkles, X } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { DEMO_PROJECT } from '../config/app';
import { useApp } from '../context/AppContext';

const COMMON_CURRENCIES = [
  { code: 'USD', label: 'USD ($) — US Dollar' },
  { code: 'BDT', label: 'BDT (৳) — Bangladeshi Taka' },
  { code: 'EUR', label: 'EUR (€) — Euro' },
  { code: 'GBP', label: 'GBP (£) — British Pound' },
  { code: 'SGD', label: 'SGD ($) — Singapore Dollar' },
  { code: 'INR', label: 'INR (₹) — Indian Rupee' },
  { code: 'AUD', label: 'AUD ($) — Australian Dollar' },
  { code: 'CAD', label: 'CAD ($) — Canadian Dollar' },
];

function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function getSupportedTimezones(): string[] {
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function') {
      const list = Intl.supportedValuesOf('timeZone');
      return list.includes('UTC') ? list : ['UTC', ...list];
    }
  } catch {
    // fallback
  }
  return [
    'UTC',
    'Asia/Dhaka',
    'Asia/Singapore',
    'Asia/Tokyo',
    'Asia/Kolkata',
    'Europe/London',
    'Europe/Berlin',
    'America/New_York',
    'America/Chicago',
    'America/Los_Angeles',
  ];
}

export const ProjectOnboardingModal: React.FC = () => {
  const {
    projects,
    activeWorkspace,
    workspaceLoading,
    isDemoMode,
    setIsDemoMode,
    createProject,
    isNewProjectModalOpen,
    closeNewProjectModal,
  } = useApp();

  const isOnboarding = !workspaceLoading && projects.length === 0 && !isDemoMode;
  const isOpen = isOnboarding || isNewProjectModalOpen;

  const browserTz = useMemo(() => getBrowserTimezone(), []);
  const timezones = useMemo(() => getSupportedTimezones(), []);

  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [timezone, setTimezone] = useState(browserTz);
  const [currency, setCurrency] = useState('USD');
  const [submitting, setSubmitting] = useState(false);
  const [creatingDemo, setCreatingDemo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setName('');
      setDomain('');
      setTimezone(activeWorkspace?.defaults?.timezone || browserTz || 'UTC');
      setCurrency(activeWorkspace?.defaults?.currency || 'USD');
      setError(null);
    }
  }, [isOpen, activeWorkspace?.defaults?.timezone, activeWorkspace?.defaults?.currency, browserTz]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Please enter a project name.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await createProject({
        name: trimmedName,
        domain: domain.trim(),
        timezone,
        currency: currency.toUpperCase(),
        isDemo: false,
      });
      closeNewProjectModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateDemoStore = async () => {
    setCreatingDemo(true);
    setError(null);
    try {
      await createProject({
        name: DEMO_PROJECT.name,
        domain: DEMO_PROJECT.domain,
        timezone: DEMO_PROJECT.defaultTimezone,
        currency: DEMO_PROJECT.defaultCurrency,
        isDemo: true,
      });
      closeNewProjectModal();
    } catch {
      // If workspace isn't ready or limit reached, allow exploring in client demo mode
      setIsDemoMode(true);
      closeNewProjectModal();
    } finally {
      setCreatingDemo(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/60 backdrop-blur-xs p-4">
      <div className="relative w-full max-w-lg rounded-2xl border border-line bg-surface shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-line px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-text">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-fg">
                {isOnboarding ? 'Create your first project' : 'Create new project'}
              </h2>
              <p className="text-xs text-fg-muted">
                {isOnboarding
                  ? 'Set up your website domain, reporting time zone, and currency to get started.'
                  : `Add a project to ${activeWorkspace?.name || 'your workspace'}.`}
              </p>
            </div>
          </div>
          {!isOnboarding && (
            <button
              type="button"
              onClick={closeNewProjectModal}
              className="rounded-lg p-1.5 text-fg-subtle hover:bg-fill-2 hover:text-fg transition-colors"
              aria-label="Close modal"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="rounded-lg border border-danger-line bg-danger-soft px-3.5 py-2.5 text-xs font-medium text-danger">
              {error}
            </div>
          )}

          <div>
            <label
              htmlFor="project-name-input"
              className="block text-xs font-semibold text-fg mb-1.5"
            >
              Project name <span className="text-danger">*</span>
            </label>
            <input
              id="project-name-input"
              type="text"
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Acme Store or Main Website"
              className="w-full rounded-lg border border-line-strong bg-raised px-3.5 py-2 text-sm text-fg placeholder-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-focus/20"
            />
          </div>

          <div>
            <label
              htmlFor="project-domain-input"
              className="block text-xs font-semibold text-fg mb-1.5"
            >
              Website domain
            </label>
            <div className="relative">
              <Globe className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-fg-subtle" />
              <input
                id="project-domain-input"
                type="text"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="example.com"
                className="w-full rounded-lg border border-line-strong bg-raised pl-9 pr-3.5 py-2 text-sm text-fg placeholder-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-focus/20"
              />
            </div>
            <p className="mt-1 text-[11px] text-fg-muted">
              Normalized to a bare hostname (e.g. <span className="font-mono">example.com</span>).
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="project-timezone-select"
                className="block text-xs font-semibold text-fg mb-1.5"
              >
                Reporting time zone
              </label>
              <select
                id="project-timezone-select"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full rounded-lg border border-line-strong bg-raised px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-focus/20"
              >
                {timezones.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="project-currency-select"
                className="block text-xs font-semibold text-fg mb-1.5"
              >
                Currency
              </label>
              <select
                id="project-currency-select"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full rounded-lg border border-line-strong bg-raised px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-focus/20"
              >
                {COMMON_CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-line">
            <button
              type="button"
              onClick={handleCreateDemoStore}
              disabled={submitting || creatingDemo}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-fill-1 px-3.5 py-2 text-xs font-medium text-fg hover:bg-fill-2 transition-colors disabled:opacity-50"
            >
              {creatingDemo ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 text-warning" />
              )}
              Try Demo Store
            </button>

            <div className="flex w-full sm:w-auto items-center justify-end gap-2">
              {!isOnboarding && (
                <button
                  type="button"
                  onClick={closeNewProjectModal}
                  disabled={submitting}
                  className="rounded-lg px-3.5 py-2 text-xs font-medium text-fg-muted hover:bg-fill-2 transition-colors"
                >
                  Cancel
                </button>
              )}
              <button
                type="submit"
                disabled={submitting || creatingDemo}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent hover:bg-accent-hover px-4 py-2 text-xs font-semibold text-on-accent shadow-xs transition-colors disabled:opacity-50"
              >
                {submitting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
                {isOnboarding ? 'Create first project' : 'Create project'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
