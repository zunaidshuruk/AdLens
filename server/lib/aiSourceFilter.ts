import { AI_ASSISTANTS } from './sourceGroups.js';

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds a regex pattern matching any known AI assistant domain (exact or subdomain: ^(.+\.)?domain$)
 * or exact alias from AI_ASSISTANTS.
 */
export function buildAiSourceRegexPattern(): string {
  const domainPatterns: string[] = [];
  const aliasPatterns: string[] = [];

  for (const assistant of AI_ASSISTANTS) {
    for (const domain of assistant.domains) {
      domainPatterns.push(`^(.+\\.)?${escapeRegex(domain)}$`);
    }
    for (const alias of assistant.aliases ?? []) {
      aliasPatterns.push(`^${escapeRegex(alias)}$`);
    }
  }

  return [...domainPatterns, ...aliasPatterns].join('|');
}

export function buildAiSourceRegExp(): RegExp {
  return new RegExp(buildAiSourceRegexPattern(), 'i');
}

export function matchesAiSourceRegex(source: string): boolean {
  const trimmed = source.trim();
  if (!trimmed) return false;
  return buildAiSourceRegExp().test(trimmed);
}

export interface GA4DimensionFilterExpression {
  filter: {
    fieldName: string;
    stringFilter: {
      matchType: 'FULL_REGEXP' | 'EXACT';
      value: string;
      caseSensitive: boolean;
    };
  };
}

/**
 * Builds a case-insensitive FULL_REGEXP GA4 dimensionFilter on sessionSource from AI_ASSISTANTS.
 */
export function buildAiSourceDimensionFilter(): GA4DimensionFilterExpression {
  return {
    filter: {
      fieldName: 'sessionSource',
      stringFilter: {
        matchType: 'FULL_REGEXP',
        value: buildAiSourceRegexPattern(),
        caseSensitive: false,
      },
    },
  };
}
