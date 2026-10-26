import React from 'react';
import { CheckCircle2, Download, Smartphone } from 'lucide-react';
import { useInstall } from '../hooks/useInstall';

/** Settings section: install AdLens as an app, or see how to on this device. Always explains something. */
export const InstallAppSection: React.FC = () => {
  const { settings, install } = useInstall();

  return (
    <section data-testid="settings-install-section" className="p-6 rounded-xl border border-line bg-surface space-y-4">
      <div className="flex items-center gap-2.5 border-b border-line pb-4">
        <Smartphone className="w-4 h-4 text-accent-text" />
        <div>
          <h2 className="text-sm font-semibold text-fg">Install AdLens</h2>
          <p className="text-xs text-fg-muted mt-0.5">Use AdLens like an app, with its own icon and window.</p>
        </div>
      </div>

      {settings.kind === 'installed' && (
        <div className="flex items-center gap-2 text-xs text-success font-medium" data-testid="install-status-installed">
          <CheckCircle2 className="w-4 h-4" />
          <span>You are using the installed app.</span>
        </div>
      )}

      {settings.kind === 'prompt' && (
        <button
          type="button"
          onClick={() => void install()}
          data-testid="install-app-button-settings"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-on-accent bg-accent hover:bg-accent-hover transition-colors cursor-pointer"
        >
          <Download className="w-4 h-4" />
          <span>Install AdLens</span>
        </button>
      )}

      {settings.kind === 'guide' && (
        <div className="space-y-2">
          <div className="text-xs font-semibold text-fg">{settings.title}</div>
          <ol className="list-decimal pl-5 space-y-1 text-xs text-fg-muted leading-relaxed">
            {settings.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </div>
      )}

      {settings.kind === 'none' && (
        <p className="text-xs text-fg-muted leading-relaxed" data-testid="install-status-none">
          This browser does not offer installing AdLens. On a computer, use Chrome or Edge. On an iPhone or iPad, open AdLens in Safari.
        </p>
      )}
    </section>
  );
};
