import React, { useEffect, useId, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import type { MetricTip } from '../utils/metricTip.js';

/** A small "i" button that opens a plain-language explanation of a metric. Works with mouse, touch and keyboard. */
export const MetricInfoTip: React.FC<{ tip: MetricTip; className?: string }> = ({ tip, className = '' }) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span
      ref={wrapRef}
      className={`relative inline-flex ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={`What is ${tip.title}?`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        onFocus={() => setOpen(true)}
        onBlur={(e) => {
          if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
        }}
        data-testid="metric-info-button"
        className="inline-flex items-center justify-center w-5 h-5 rounded-full text-fg-subtle hover:text-fg hover:bg-fill-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-focus cursor-pointer transition-colors"
      >
        <Info className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
      {open && (
        <span
          id={panelId}
          role="tooltip"
          data-testid="metric-info-panel"
          className="absolute right-0 top-full mt-1.5 z-30 w-64 max-w-[calc(100vw-2rem)] p-3 rounded-lg border border-line bg-raised text-left shadow-lg space-y-1.5 text-xs leading-relaxed"
        >
          <span className="block font-semibold text-fg">{tip.title}</span>
          <span className="block text-fg">{tip.definition}</span>
          {tip.formula && (
            <span className="block text-fg-muted">
              <span className="font-semibold">How it is worked out: </span>
              {tip.formula}
            </span>
          )}
          {tip.note && <span className="block text-fg-muted">{tip.note}</span>}
          <span className="block text-fg-subtle pt-0.5">
            {tip.sourceName}
            {tip.direction ? ` · ${tip.direction}` : ''}
          </span>
        </span>
      )}
    </span>
  );
};
