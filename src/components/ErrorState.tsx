import React from 'react';
import { AlertTriangle, ArrowRight, RotateCcw } from 'lucide-react';

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  actionLabel?: string;
  onAction?: () => void;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  title = 'Unable to load analytics data',
  message,
  onRetry,
  actionLabel,
  onAction,
}) => {
  return (
    <div
      role="alert"
      className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-xl border border-danger-line bg-danger-soft text-fg"
    >
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-danger-soft flex items-center justify-center text-danger shrink-0">
          <AlertTriangle className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-danger">{title}</h3>
          <p className="mt-0.5 text-xs text-danger">{message}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0 self-start sm:self-center">
        {actionLabel && onAction && (
          <button
            type="button"
            onClick={onAction}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-danger bg-danger-soft hover:bg-danger-line rounded-lg transition-colors cursor-pointer"
          >
            <span>{actionLabel}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-on-danger bg-danger hover:bg-danger/90 rounded-lg transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Retry</span>
          </button>
        )}
      </div>
    </div>
  );
};
