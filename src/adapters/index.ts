import type { DataSourceAdapter, GA4Adapter } from './ga4.ts';
import type { MetaAdsAdapter } from './metaAds.ts';
import { mockGA4Adapter } from './mock/ga4Mock.ts';
import { mockMetaAdsAdapter } from './mock/metaAdsMock.ts';
import { mockSearchConsoleAdapter } from './mock/searchConsoleMock.ts';
import type { SearchConsoleAdapter } from './searchConsole.ts';

export interface AdapterRegistry {
  ga4: GA4Adapter;
  searchConsole: SearchConsoleAdapter;
  metaAds: MetaAdsAdapter;
  getAll(): DataSourceAdapter[];
  isAnyMocked(): boolean;
}

export const adapters: AdapterRegistry = {
  ga4: mockGA4Adapter,
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
