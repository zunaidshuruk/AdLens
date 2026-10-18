import { apiClient } from '../api/client';
import type { DataSourceId } from '../types';
import type { DataSourceAdapter, GA4Adapter } from './ga4';
import { liveGA4Adapter } from './live/ga4Live';
import { liveMetaAdsAdapter } from './live/metaAdsLive';
import { liveSearchConsoleAdapter } from './live/searchConsoleLive';
import type { MetaAdsAdapter } from './metaAds';
import { mockGA4Adapter } from './mock/ga4Mock';
import { mockMetaAdsAdapter } from './mock/metaAdsMock';
import { mockSearchConsoleAdapter } from './mock/searchConsoleMock';
import type { SearchConsoleAdapter } from './searchConsole';

const liveModeBySource: Record<DataSourceId, boolean> = {
  ga4: false,
  search_console: false,
  meta_ads: false,
};

let registryInitialized = false;
let initPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emitRegistryChange() {
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Generalised mechanism to switch any data source between live and mock adapters.
 */
export function setSourceLiveMode(source: DataSourceId, isLive: boolean): void {
  registryInitialized = true;
  if (liveModeBySource[source] !== isLive) {
    liveModeBySource[source] = isLive;
    emitRegistryChange();
  }
}

export function isSourceLiveMode(source: DataSourceId): boolean {
  return liveModeBySource[source];
}

export function setGA4LiveMode(isLive: boolean): void {
  setSourceLiveMode('ga4', isLive);
}

export function setSearchConsoleLiveMode(isLive: boolean): void {
  setSourceLiveMode('search_console', isLive);
}

export function setMetaAdsLiveMode(isLive: boolean): void {
  setSourceLiveMode('meta_ads', isLive);
}

export function subscribeAdapterRegistry(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function syncAdapterRegistryWithConnections(): Promise<Record<DataSourceId, boolean>> {
  if (typeof window === 'undefined') {
    return { ...liveModeBySource };
  }
  try {
    const [conn, health] = await Promise.all([
      apiClient.getConnections(),
      apiClient.getHealth().catch(() => null),
    ]);
    const ga4Live = Boolean(conn.google.connected && conn.google.ga4Property?.id);
    const scLive = Boolean(conn.google.connected && conn.google.searchConsoleSite?.url);
    const metaLive = Boolean(health?.metaConfigured ?? conn.meta.configured ?? conn.meta.connected);
    setSourceLiveMode('ga4', ga4Live);
    setSourceLiveMode('search_console', scLive);
    setSourceLiveMode('meta_ads', metaLive);
    return { ...liveModeBySource };
  } catch {
    setSourceLiveMode('ga4', false);
    setSourceLiveMode('search_console', false);
    setSourceLiveMode('meta_ads', false);
    return { ...liveModeBySource };
  }
}

export async function ensureAdapterRegistryInitialized(): Promise<void> {
  if (registryInitialized || typeof window === 'undefined') {
    return;
  }
  if (!initPromise) {
    initPromise = syncAdapterRegistryWithConnections().then(() => {
      initPromise = null;
    });
  }
  await initPromise;
}

export interface AdapterRegistry {
  readonly ga4: GA4Adapter;
  readonly searchConsole: SearchConsoleAdapter;
  readonly metaAds: MetaAdsAdapter;
  getAll(): DataSourceAdapter[];
  isAnyMocked(): boolean;
}

export const adapters: AdapterRegistry = {
  get ga4(): GA4Adapter {
    return liveModeBySource.ga4 ? liveGA4Adapter : mockGA4Adapter;
  },
  get searchConsole(): SearchConsoleAdapter {
    return liveModeBySource.search_console ? liveSearchConsoleAdapter : mockSearchConsoleAdapter;
  },
  get metaAds(): MetaAdsAdapter {
    return liveModeBySource.meta_ads ? liveMetaAdsAdapter : mockMetaAdsAdapter;
  },

  getAll(): DataSourceAdapter[] {
    return [this.ga4, this.searchConsole, this.metaAds];
  },

  isAnyMocked(): boolean {
    return this.getAll().some((adapter) => adapter.isMock);
  },
};

export type { DataSourceAdapter, GA4Adapter, MetaAdsAdapter, SearchConsoleAdapter };

