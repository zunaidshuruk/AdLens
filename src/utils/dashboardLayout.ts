import type { DashboardWidget, WidgetLayout } from '../types/dashboard.js';

export const GRID_COLUMNS = 12;
export const MAX_ROWS = 60;
const MAX_H = 12;

type Box = WidgetLayout & { id: string };

const overlaps = (a: WidgetLayout, b: WidgetLayout) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export function clampLayout(l: WidgetLayout): WidgetLayout {
  const w = Math.min(GRID_COLUMNS, Math.max(1, Math.round(l.w)));
  const h = Math.min(MAX_H, Math.max(1, Math.round(l.h)));
  const x = Math.min(GRID_COLUMNS - w, Math.max(0, Math.round(l.x)));
  const y = Math.min(MAX_ROWS, Math.max(0, Math.round(l.y)));
  return { x, y, w, h };
}

/**
 * Pulls every widget up as far as it can go without overlapping, keeping reading order.
 * Widgets are processed top-to-bottom, left-to-right, so the result is stable.
 */
export function compact<T extends { id: string; layout: WidgetLayout }>(widgets: T[]): T[] {
  const order = [...widgets].sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x);
  const placed: Box[] = [];
  const out = new Map<string, WidgetLayout>();
  for (const w of order) {
    const l = clampLayout(w.layout);
    let y = 0;
    while (y <= MAX_ROWS) {
      const test = { ...l, y };
      if (!placed.some((p) => overlaps(test, p))) break;
      y += 1;
    }
    const final = { ...l, y: Math.min(y, MAX_ROWS) };
    placed.push({ id: w.id, ...final });
    out.set(w.id, final);
  }
  return widgets.map((w) => ({ ...w, layout: out.get(w.id)! }));
}

/** Moves one widget to a new place; whatever is in the way is pushed down, then everything is tidied. */
export function placeWidget<T extends { id: string; layout: WidgetLayout }>(widgets: T[], id: string, next: Partial<WidgetLayout>): T[] {
  const target = widgets.find((w) => w.id === id);
  if (!target) return widgets;
  const moved = clampLayout({ ...target.layout, ...next });
  // Give the moved widget priority by sorting it before anything it overlaps.
  const withMove = widgets.map((w) => (w.id === id ? { ...w, layout: moved } : w));
  const shifted = withMove.map((w) =>
    w.id !== id && overlaps(w.layout, moved) ? { ...w, layout: { ...w.layout, y: moved.y + moved.h } } : w
  );
  const result = cascade(shifted, id);
  return compact(result);
}

/** Pushes down anything that overlaps a widget that was itself pushed (the moved widget is never pushed). */
function cascade<T extends { id: string; layout: WidgetLayout }>(widgets: T[], fixedId: string): T[] {
  let list = widgets;
  for (let pass = 0; pass < widgets.length * 2; pass += 1) {
    let changed = false;
    const sorted = [...list].sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x);
    for (const a of sorted) {
      for (const b of sorted) {
        if (a.id === b.id || !overlaps(a.layout, b.layout)) continue;
        const pushed = a.id === fixedId ? b : b.id === fixedId ? a : (a.layout.y <= b.layout.y ? b : a);
        const anchor = pushed === a ? b : a;
        list = list.map((w) => (w.id === pushed.id ? { ...w, layout: { ...w.layout, y: anchor.layout.y + anchor.layout.h } } : w));
        changed = true;
        break;
      }
      if (changed) break;
    }
    if (!changed) break;
  }
  return list;
}

/** First free spot (reading order) for a new widget of the given size. */
export function findFreeSpot(widgets: { layout: WidgetLayout }[], size: { w: number; h: number }): WidgetLayout {
  const w = Math.min(GRID_COLUMNS, size.w);
  for (let y = 0; y <= MAX_ROWS; y += 1) {
    for (let x = 0; x + w <= GRID_COLUMNS; x += 1) {
      const test = { x, y, w, h: size.h };
      if (!widgets.some((o) => overlaps(test, o.layout))) return test;
    }
  }
  return { x: 0, y: MAX_ROWS, w, h: size.h };
}

/** Phones get one column in reading order (top to bottom, then left to right). */
export function mobileOrder<T extends { layout: WidgetLayout }>(widgets: T[]): T[] {
  return [...widgets].sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x);
}

export function resizeWidget<T extends { id: string; layout: WidgetLayout }>(widgets: T[], id: string, dw: number, dh: number): T[] {
  const t = widgets.find((w) => w.id === id);
  if (!t) return widgets;
  return placeWidget(widgets, id, { w: t.layout.w + dw, h: t.layout.h + dh });
}

type WithoutLayout = DashboardWidget extends infer W ? (W extends DashboardWidget ? Omit<W, 'layout'> : never) : never;

export function addWidget(widgets: DashboardWidget[], widget: WithoutLayout, size: { w: number; h: number }): DashboardWidget[] {
  return [...widgets, { ...widget, layout: findFreeSpot(widgets, size) } as unknown as DashboardWidget];
}

export const PANEL_DAY_OPTIONS = [7, 14, 28, 90] as const;

/** The dates a panel should use: its own last-N-days (ending on the page's end date) or the page range. */
export function panelRange(days: number | undefined, page: { startDate: string; endDate: string }): { startDate: string; endDate: string } {
  if (!days || !PANEL_DAY_OPTIONS.includes(days as 7)) return page;
  const end = new Date(`${page.endDate}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() - (days - 1));
  return { startDate: end.toISOString().slice(0, 10), endDate: page.endDate };
}

/** Sets or clears a panel's own time range. */
export function setWidgetDays(widgets: DashboardWidget[], id: string, days: number | undefined): DashboardWidget[] {
  return widgets.map((w) => {
    if (w.id !== id || w.kind === 'text') return w;
    const { days: _old, ...rest } = w;
    return (days ? { ...rest, days } : rest) as DashboardWidget;
  });
}

/** Copies a widget (new id, title + " (copy)") into the first free spot of the same size. */
export function duplicateWidget(widgets: DashboardWidget[], id: string, newId: string): DashboardWidget[] {
  const src = widgets.find((w) => w.id === id);
  if (!src) return widgets;
  const copy = JSON.parse(JSON.stringify(src)) as DashboardWidget;
  copy.id = newId;
  copy.title = `${src.title} (copy)`.slice(0, 80);
  copy.layout = findFreeSpot(widgets, { w: src.layout.w, h: src.layout.h });
  return [...widgets, copy];
}

export function removeWidget<T extends { id: string; layout: WidgetLayout }>(widgets: T[], id: string): T[] {
  return compact(widgets.filter((w) => w.id !== id));
}

export function hasOverlap(widgets: { layout: WidgetLayout }[]): boolean {
  for (let i = 0; i < widgets.length; i += 1) for (let j = i + 1; j < widgets.length; j += 1) if (overlaps(widgets[i].layout, widgets[j].layout)) return true;
  return false;
}

export const DEFAULT_SIZE: Record<string, { w: number; h: number }> = {
  kpi: { w: 3, h: 2 },
  bar: { w: 6, h: 4 },
  line: { w: 6, h: 4 },
  table: { w: 6, h: 5 },
  text: { w: 6, h: 2 },
};
