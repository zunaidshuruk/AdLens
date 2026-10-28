/**
 * Paid market-data providers (Sprint 40: the plug, Sprint 45: a real provider).
 * Search volume, cost per click, true keyword difficulty, competitor keywords and backlinks cannot be measured from your own accounts.
 * Screens ask this interface; until a provider is connected it answers "not connected" and the screens say so instead of inventing numbers.
 */
export interface KeywordMetrics { keyword: string; volume: number | null; cpc: number | null; difficulty: number | null; competition: number | null }
export interface CompetitorKeyword { keyword: string; position: number; volume: number | null; url: string | null }
export interface BacklinkSummary { domain: string; referringDomains: number | null; backlinks: number | null; authority: number | null }

export interface DataProvider {
  id: string;
  name: string;
  connected: boolean;
  keywordMetrics(keywords: string[], country: string): Promise<KeywordMetrics[]>;
  competitorKeywords(domain: string, country: string): Promise<CompetitorKeyword[]>;
  backlinks(domain: string): Promise<BacklinkSummary | null>;
}

export const NOT_CONNECTED_NOTE = 'Search volume, cost per click and difficulty need a paid data source, which is not connected yet. Everything else here comes from your own Search Console and from Google.';

export const notConnectedProvider: DataProvider = {
  id: 'none', name: 'Not connected', connected: false,
  async keywordMetrics() { return []; },
  async competitorKeywords() { return []; },
  async backlinks() { return null; },
};

let override: DataProvider | null = null;
export const setTestDataProvider = (p: DataProvider | null): void => { override = p; };
/** Sprint 45 will pick a real provider here from the environment (for example DataForSEO). */
export const getDataProvider = (): DataProvider => override ?? notConnectedProvider;
