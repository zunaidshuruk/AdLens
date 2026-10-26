import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/500.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/noto-sans-bengali/bengali-400.css';
import '@fontsource/noto-sans-bengali/bengali-500.css';
import '@fontsource/noto-sans-bengali/bengali-600.css';
import '@fontsource/noto-sans-bengali/bengali-700.css';
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CheckCircle2, X } from 'lucide-react';
import App from './App.tsx';
import './index.css';
import { initInstallPrompt } from './pwa/installPrompt.js';
import { registerServiceWorker, type SwHandle } from './pwa/register.js';

initInstallPrompt();

type UpdateToastKind = 'ready' | 'elsewhere' | null;

let handle: SwHandle | null = null;
let currentToastKind: UpdateToastKind = null;
const toastListeners = new Set<(kind: UpdateToastKind) => void>();

function setToastKind(kind: UpdateToastKind) {
  currentToastKind = kind;
  for (const listener of toastListeners) {
    listener(kind);
  }
}

const showRefreshToast = () => setToastKind('ready');
const showReloadHint = () => setToastKind('elsewhere');

void registerServiceWorker({
  container: navigator.serviceWorker,
  enabled: import.meta.env.PROD,
  reload: () => location.reload(),
  onUpdateReady: showRefreshToast,
  onReplacedElsewhere: showReloadHint,
  visibility: {
    addEventListener: (t, l) => document.addEventListener(t, l),
    state: () => document.visibilityState,
  },
  now: () => Date.now(),
}).then((h) => {
  handle = h;
});

function Root() {
  const [toast, setToast] = useState<UpdateToastKind>(currentToastKind);

  useEffect(() => {
    toastListeners.add(setToast);
    return () => {
      toastListeners.delete(setToast);
    };
  }, []);

  return (
    <>
      {toast && (
        <div
          role="status"
          data-testid="sw-update-toast"
          className="fixed bottom-20 md:bottom-4 right-4 z-50 flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-lg border border-success-line bg-success-soft text-xs text-success shadow-lg"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
            <span>A new version of AdLens is ready</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                if (toast === 'ready') {
                  handle?.accept();
                } else {
                  location.reload();
                }
              }}
              className="px-2.5 py-1 rounded-md font-semibold bg-accent hover:bg-accent-hover text-on-accent transition-colors cursor-pointer"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={() => setToastKind(null)}
              aria-label="Dismiss update notification"
              className="p-0.5 rounded hover:bg-fill-2 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
      <App />
    </>
  );
}

createRoot(document.getElementById('root')!).render(<Root />);

