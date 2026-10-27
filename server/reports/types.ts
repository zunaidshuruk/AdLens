import type { z } from 'zod';
import type { ProjectDoc } from '../lib/firestore.js';
import type { SessionData } from '../lib/session.js';

export type ReportSource = 'ga4' | 'search_console' | 'meta' | 'combined';

export interface ReportContext {
  session?: SessionData;
  getAccessToken: () => Promise<string>;
  ga4PropertyId?: string;
  ga4PropertyName?: string;
  searchConsoleSite?: string;
  project?: ProjectDoc;
  /** Meta Ads access for the signed-in user's own connection, or null when not connected. */
  getMeta?: () => Promise<{ accessToken: string; appSecret: string; accountId: string } | null>;
}

export interface ReportDefinition<I = unknown, O = unknown> {
  id: string;
  title: string;
  description: string;
  source: ReportSource;
  input: z.ZodType<I>;
  run(ctx: ReportContext, input: I): Promise<O>;
}

export interface ListedReportDefinition {
  id: string;
  title: string;
  description: string;
  source: ReportSource;
  input: Record<string, unknown>;
}
