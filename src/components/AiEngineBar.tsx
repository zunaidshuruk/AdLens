import { Cloud, Download, Lock } from 'lucide-react';
import React from 'react';
import type { EngineSettings, OnDeviceStatus } from '../utils/aiEngineRouter.js';
import type { WebLlmSettings } from '../utils/onDeviceRuntime.js';
import type { WebLlmModelChoice } from '../utils/webLlmEngine.js';

interface Props {
  settings: EngineSettings;
  onChange: (next: EngineSettings) => void;
  status: OnDeviceStatus;
  /** 0 to 1 while the model downloads, otherwise null. */
  downloadProgress: number | null;
  onDownload: () => void;
  downloadError?: string | null;
  /** Only passed when the owner enabled the optional WebGPU model and this device can run it. */
  webLlm?: { settings: WebLlmSettings; models: WebLlmModelChoice[]; active: boolean; onChange: (next: WebLlmSettings) => void };
}

export function describeOnDeviceStatus(status: OnDeviceStatus): string {
  switch (status) {
    case 'available': return 'Ready on this device.';
    case 'downloadable': return 'Not downloaded yet. A one-time download (a few gigabytes) is needed.';
    case 'downloading': return 'Downloading…';
    default: return 'Not available in this browser. Private mode works in recent desktop Chrome with enough free disk space.';
  }
}

export const AiEngineBar: React.FC<Props> = ({ settings, onChange, status, downloadProgress, onDownload, downloadError, webLlm }) => {
  const priv = settings.preference === 'on-device';
  const pill = (active: boolean) =>
    `inline-flex items-center gap-1.5 px-3 py-2 min-h-[36px] text-xs font-medium rounded-md transition-colors ${active ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg'}`;
  return (
    <div data-testid="analyst-engine-bar" className="rounded-xl border border-line bg-surface p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-medium text-fg">AI engine</span>
        <div role="group" aria-label="AI engine" className="inline-flex rounded-lg border border-line p-0.5 bg-fill-1">
          <button type="button" aria-pressed={!priv} onClick={() => onChange({ ...settings, preference: 'cloud' })} className={pill(!priv)}>
            <Cloud className="w-3.5 h-3.5" /> Cloud (Gemini)
          </button>
          <button type="button" aria-pressed={priv} onClick={() => onChange({ ...settings, preference: 'on-device' })} className={pill(priv)}>
            <Lock className="w-3.5 h-3.5" /> Private (this device)
          </button>
        </div>
      </div>

      {!priv ? (
        <p className="text-[11px] text-fg-subtle">Your question and your report numbers are sent to Google&apos;s Gemini to answer. Smartest option, works in every language.</p>
      ) : (
        <div className="space-y-2">
          <p className="text-[11px] text-fg-subtle">
            Your question and the answer stay in this browser. Your report numbers are still loaded from your connected accounts, the same as every screen. English, Spanish and Japanese only; answers are simpler than the cloud model&apos;s.
          </p>
          <p data-testid="analyst-on-device-status" className="text-xs text-fg-muted">{describeOnDeviceStatus(status)}</p>
          {webLlm && (
            <div data-testid="analyst-webllm" className="rounded-lg border border-line bg-fill-1 p-2 space-y-1.5">
              <label className="flex items-start gap-2 text-xs text-fg-muted cursor-pointer">
                <input type="checkbox" className="mt-0.5" checked={webLlm.settings.enabled} onChange={(e) => webLlm.onChange({ ...webLlm.settings, enabled: e.target.checked })} />
                <span>Use a larger model that runs on this device&apos;s graphics chip. <strong className="text-fg">It is used only when Chrome&apos;s built-in AI is not available.</strong> One-time download of about {Math.round((webLlm.models.find((m) => m.id === webLlm.settings.modelId)?.approxDownloadMB ?? 900) / 100) / 10} GB.</span>
              </label>
              {webLlm.settings.enabled && (
                <label className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                  Model
                  <select value={webLlm.settings.modelId} onChange={(e) => webLlm.onChange({ ...webLlm.settings, modelId: e.target.value })} className="rounded-lg border border-line bg-surface text-fg text-xs px-2 py-1.5 min-h-[32px]">
                    {webLlm.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                  <span className="text-fg-subtle">{webLlm.models.find((m) => m.id === webLlm.settings.modelId)?.note}</span>
                </label>
              )}
            </div>
          )}
          {status === 'downloadable' && (
            <button type="button" onClick={onDownload} className="inline-flex items-center gap-1.5 rounded-lg bg-accent text-on-accent text-xs font-medium px-3 py-2 min-h-[36px]">
              <Download className="w-3.5 h-3.5" /> Download the on-device model
            </button>
          )}
          {downloadProgress !== null && (
            <div role="progressbar" aria-label="Model download" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(downloadProgress * 100)} className="h-1.5 w-full max-w-xs rounded-full bg-fill-2 overflow-hidden">
              <div className="h-full bg-accent transition-all" style={{ width: `${Math.round(downloadProgress * 100)}%` }} />
            </div>
          )}
          {downloadError && <p role="alert" className="text-xs text-danger">{downloadError}</p>}
          <label className="flex items-start gap-2 text-xs text-fg-muted cursor-pointer">
            <input type="checkbox" className="mt-0.5" checked={settings.allowCloudFallback} onChange={(e) => onChange({ ...settings, allowCloudFallback: e.target.checked })} />
            <span>If Private mode cannot answer, let the cloud model answer instead. <strong className="text-fg">Off keeps every question on this device.</strong></span>
          </label>
        </div>
      )}
    </div>
  );
};
