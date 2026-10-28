import { z } from 'zod';
import { dataSpecSchema } from './datasets.js';
import { ga4SpecSchema, metaSpecSchema, scSpecSchema } from './exploreSpec.js';

/** A dashboard is a 12-column grid of widgets. Widgets carry their own small report spec; dates come from the page's date picker. */
export const GRID_COLUMNS = 12;
export const MAX_GRID_ROWS = 60;

const layoutSchema = z.object({
  x: z.number().int().min(0).max(GRID_COLUMNS - 1),
  y: z.number().int().min(0).max(MAX_GRID_ROWS),
  w: z.number().int().min(1).max(GRID_COLUMNS),
  h: z.number().int().min(1).max(12),
}).refine((l) => l.x + l.w <= GRID_COLUMNS, { message: 'A widget cannot run past the right edge of the grid.' });

const title = z.string().trim().min(1, 'Give every widget a title').max(80);
const widgetId = z.string().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/);

const queryWidget = (source: 'ga4' | 'search_console' | 'meta' | 'data', spec: z.ZodType) =>
  z.object({
    id: widgetId,
    title,
    layout: layoutSchema,
    kind: z.enum(['kpi', 'bar', 'line', 'table', 'stacked', 'pie', 'gauge', 'heatmap']),
    target: z.number().positive().max(1e12).optional(),
    days: z.union([z.literal(7), z.literal(14), z.literal(28), z.literal(90)]).optional(),
    source: z.literal(source),
    spec,
  });

export const widgetSchema = z.union([
  queryWidget('ga4', ga4SpecSchema),
  queryWidget('search_console', scSpecSchema),
  queryWidget('meta', metaSpecSchema),
  queryWidget('data', dataSpecSchema),
  z.object({ id: widgetId, title, layout: layoutSchema, kind: z.literal('text'), text: z.string().trim().min(1).max(1000) }),
]);

export const dashboardInputSchema = z.object({
  name: z.string().trim().min(1, 'Give the dashboard a name').max(80),
  description: z.string().trim().max(200).default(''),
  widgets: z.array(widgetSchema).max(50),
}).superRefine((d, ctx) => {
  const seen = new Set<string>();
  d.widgets.forEach((w, i) => {
    if (seen.has(w.id)) ctx.addIssue({ code: 'custom', path: ['widgets', i, 'id'], message: 'Widget ids must be unique.' });
    seen.add(w.id);
  });
});
export type DashboardInput = z.infer<typeof dashboardInputSchema>;
