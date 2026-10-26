import React from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { useInstall } from '../hooks/useInstall';

/** A single, dismissible suggestion to install AdLens as an app. Shows nothing when there is nothing useful to offer. */
export const InstallBanner: React.FC = () => {
  const { banner, install, dismissBanner } = useInstall();
  if (banner.kind !== 'prompt' && banner.kind !== 'guide') return null;

  return (
    <div
      role="region"
      aria-label="Install AdLens"
      data-testid="install-banner"
      className="mb-4 p-3.5 rounded-xl border border-accent-line bg-accent-soft flex items-start gap-3"
    >
      <div className="w-9 h-9 rounded-lg bg-surface text-accent-text flex items-center justify-center shrink-0">
        {banner.kind === 'prompt' ? <Download className="w-4 h-4" /> : <Smartphone className="w-4 h-4" />}
      </div>
      <div className="flex-1 min-w-0 space-y-1.5">
        {banner.kind === 'prompt' ? (
          <>
            <div className="text-sm font-semibold text-fg">Install AdLens as an app</div>
            <p className="text-xs text-fg-muted leading-relaxed">Opens in its own window with its own icon, like any other app. It takes a few seconds.</p>
            <button
              type="button"
              onClick={() => void install()}
              data-testid="install-app-button"
              className="mt-1 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-on-accent bg-accent hover:bg-accent-hover transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Install AdLens</span>
            </button>
          </>
        ) : (
          <>
            <div className="text-sm font-semibold text-fg">{banner.title}</div>
            <ol className="list-decimal pl-4 space-y-0.5 text-xs text-fg-muted leading-relaxed">
              {banner.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </>
        )}
      </div>
      <button
        type="button"
        onClick={dismissBanner}
        aria-label="Hide this suggestion"
        data-testid="install-banner-dismiss"
        className="p-1 rounded hover:bg-fill-2 text-fg-muted cursor-pointer shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
