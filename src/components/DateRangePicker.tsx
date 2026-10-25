import React, { useState } from 'react';
import { Calendar, GitCompareArrows } from 'lucide-react';
import { useDateRange } from '../hooks/useDateRange';
import type { DatePreset } from '../types';
import { DATE_PRESETS, formatFullDateRange } from '../utils/dateUtils';

export const DateRangePicker: React.FC = () => {
  const {
    preset,
    setPreset,
    customDates,
    setCustomDates,
    compareEnabled,
    setCompareEnabled,
    dateRange,
  } = useDateRange();

  const [draftStart, setDraftStart] = useState(customDates.startDate);
  const [draftEnd, setDraftEnd] = useState(customDates.endDate);

  const handlePresetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value as DatePreset;
    setPreset(next);
  };

  const handleApplyCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (draftStart && draftEnd) {
      setCustomDates({ startDate: draftStart, endDate: draftEnd });
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {/* Date Preset Selector */}
      <div className="flex items-center gap-2 bg-fill-2 border border-line rounded-lg px-2.5 py-1.5">
        <Calendar className="w-3.5 h-3.5 text-accent-text shrink-0" />
        <label htmlFor="adlens-date-preset" className="sr-only">
          Date Range Preset
        </label>
        <select
          id="adlens-date-preset"
          aria-label="Date Range Preset"
          value={preset}
          onChange={handlePresetChange}
          className="bg-transparent text-xs font-medium text-fg focus:outline-none cursor-pointer pr-1"
        >
          {DATE_PRESETS.map((p) => (
            <option key={p} value={p} className="bg-surface text-fg">
              {p}
            </option>
          ))}
        </select>

        <span
          aria-hidden="true"
          className="hidden sm:inline text-line-strong"
        >
          |
        </span>

        <span className="hidden sm:inline text-xs font-mono tabular-nums text-fg-muted whitespace-nowrap">
          {formatFullDateRange(dateRange.startDate, dateRange.endDate)}
        </span>
      </div>

      {/* Custom Date Inputs when Custom is selected */}
      {preset === 'Custom' && (
        <form onSubmit={handleApplyCustom} className="flex flex-wrap items-center gap-1.5">
          <input
            type="date"
            aria-label="Custom start date"
            value={draftStart}
            onChange={(e) => {
              setDraftStart(e.target.value);
              if (e.target.value && draftEnd) {
                setCustomDates({ startDate: e.target.value, endDate: draftEnd });
              }
            }}
            className="px-2 py-1 text-xs font-mono rounded-lg border border-line bg-raised text-fg"
          />
          <span className="text-xs text-fg-subtle">to</span>
          <input
            type="date"
            aria-label="Custom end date"
            value={draftEnd}
            onChange={(e) => {
              setDraftEnd(e.target.value);
              if (draftStart && e.target.value) {
                setCustomDates({ startDate: draftStart, endDate: e.target.value });
              }
            }}
            className="px-2 py-1 text-xs font-mono rounded-lg border border-line bg-raised text-fg"
          />
        </form>
      )}

      {/* Compare to previous period toggle */}
      <button
        type="button"
        role="switch"
        aria-checked={compareEnabled}
        onClick={() => setCompareEnabled(!compareEnabled)}
        title={`Compare against ${formatFullDateRange(
          dateRange.compareStartDate,
          dateRange.compareEndDate
        )}`}
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
          compareEnabled
            ? 'bg-accent-soft border-accent-line text-accent-text'
            : 'bg-surface border-line text-fg-muted hover:bg-fill-1'
        }`}
      >
        <GitCompareArrows className="w-3.5 h-3.5 shrink-0" />
        <span>Compare to previous period</span>
        <span
          className={`w-2 h-2 rounded-full ${
            compareEnabled ? 'bg-accent' : 'bg-fill-3'
          }`}
        />
      </button>
    </div>
  );
};
