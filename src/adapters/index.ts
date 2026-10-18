import { apiClient } from '../api/client.ts';
import type { DataSourceAdapter, GA4Adapter } from './ga4.ts';
import { liveGA4Adapter } from './live/ga4Live.ts';
import type { MetaAdsAdapter } from './metaAds.ts';
import { mockGA4Adapter } from './mock/ga4Mock.ts';
import { mockMetaAdsAdapter } from './mock/metaAdsMock.ts';
import { mockSearchConsoleAdapter } from './mock/searchConsoleMock.ts';
import type { SearchConsoleAdapter } from './searchConsole.ts';

let ga4LiveActive = false;
let registryInitialized = false;
let initPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emitRegistryChange() {
  for (const listener of listeners) {
    listener();
  }
}

export function setGA4LiveMode(isLive: boolean): void {
  registryInitialized = true;
  if (ga4LiveActive !== isLive) {
    ga4LiveActive = isLive;
    emitRegistryChange();
  }
}

export function subscribeAdapterRegistry(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function syncAdapterRegistryWithConnections(): Promise<boolean> {
  if (typeof window === 'undefined') {
    return ga4LiveActive;
  }
  try {
    const conn = await apiClient.getConnections();
    const shouldBeLive = Boolean(conn.google.connected && conn.google.ga4Property?.id);
    setGA4LiveMode(shouldBeLive);
    return shouldBeLive;
  } catch {
    setGA4LiveMode(false);
    return false;
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
    return ga4LiveActive ? liveGA4Adapter : mockGA4Adapter;
  },
  searchConsole: mockSearchConsoleAdapter,
  metaAds: mockMetaAdsAdapter,

  getAll(): DataSourceAdapter[] {
    return [this.ga4, this.searchConsole, this.metaAds];
  },

  isAnyMocked(): boolean {
    return this.getAll().some((adapter) => adapter.isMock);
  },
};

export type { DataSourceAdapter, GA4Adapter, MetaAdsAdapter, SearchConsoleAdapter };
