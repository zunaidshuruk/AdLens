import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ErrorState } from './ErrorState';
import { friendlyReportError, needsConnection } from '../utils/intelligenceFormat.js';

interface Props {
  loading: boolean;
  error: string | null;
  errorCode: string | null;
  onRetry: () => void;
  children: React.ReactNode;
}

/** Shows a loading skeleton, a plain-language error (with a shortcut to Connections when that is the fix), or the content. */
export const ReportBoundary: React.FC<Props> = ({ loading, error, errorCode, onRetry, children }) => {
  const navigate = useNavigate();
  if (loading) {
    return (
      <div className="space-y-3" aria-busy="true" aria-live="polite">
        <div className="h-24 rounded-xl border border-line bg-surface animate-pulse" />
        <div className="h-64 rounded-xl border border-line bg-surface animate-pulse" />
      </div>
    );
  }
  if (error) {
    const connect = needsConnection(errorCode);
    return (
      <ErrorState
        title={connect ? 'Setup needed' : 'Unable to load this report'}
        message={friendlyReportError(errorCode, error)}
        onRetry={onRetry}
        {...(connect ? { actionLabel: 'Open Connections', onAction: () => navigate('/connections') } : {})}
      />
    );
  }
  return <>{children}</>;
};

export const Notes: React.FC<{ notes?: string[] }> = ({ notes }) =>
  notes && notes.length > 0 ? (
    <ul className="rounded-xl border border-warning-line bg-warning-soft p-3 text-xs text-fg space-y-1">
      {notes.map((n) => (
        <li key={n}>{n}</li>
      ))}
    </ul>
  ) : null;

export const RulesBox: React.FC<{ rules: string[]; title?: string }> = ({ rules, title = 'How this is worked out' }) => (
  <details className="rounded-xl border border-line bg-surface p-3 text-xs text-fg-muted">
    <summary className="cursor-pointer font-medium text-fg">{title}</summary>
    <ul className="mt-2 list-disc pl-5 space-y-1">
      {rules.map((r) => (
        <li key={r}>{r}</li>
      ))}
    </ul>
  </details>
);
