import { z } from 'zod';
import type { ListedReportDefinition, ReportDefinition } from './types.js';

class ReportRegistry {
  private readonly definitions = new Map<string, ReportDefinition<any, any>>();

  register<I, O>(definition: ReportDefinition<I, O>): ReportDefinition<I, O> {
    this.definitions.set(definition.id, definition);
    return definition;
  }

  get<I = unknown, O = unknown>(id: string): ReportDefinition<I, O> | undefined {
    return this.definitions.get(id) as ReportDefinition<I, O> | undefined;
  }

  list(): ListedReportDefinition[] {
    return Array.from(this.definitions.values()).map((def) => ({
      id: def.id,
      title: def.title,
      description: def.description,
      source: def.source,
      input: z.toJSONSchema(def.input, { unrepresentable: 'any' }) as Record<string, unknown>,
    }));
  }
}

export const reportRegistry = new ReportRegistry();
