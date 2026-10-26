import React, { useMemo } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  parseAnalystMarkdown,
  type Block,
  type ChartSpec,
  type Inline,
} from '../utils/analystMarkdown.js';

const SERIES_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
  'var(--chart-7)',
  'var(--chart-8)',
];
const colorAt = (i: number): string => SERIES_COLORS[i % SERIES_COLORS.length];

const formatNumber = (v: unknown): string =>
  typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(v ?? '');
const formatAxis = (v: unknown): string =>
  typeof v === 'number' && Number.isFinite(v)
    ? new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(v)
    : String(v ?? '');

const CHART_MARGIN = { top: 8, right: 16, bottom: 0, left: 0 };
const TICK = { fontSize: 11, fill: 'var(--color-fg-muted)' };
const TOOLTIP_STYLE: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-line)',
  borderRadius: 8,
  fontSize: 12,
  color: 'var(--color-fg)',
};

// ---------------------------------------------------------------------------
// Inline text
// ---------------------------------------------------------------------------

function renderInline(nodes: Inline[], keyPrefix = 'i'): React.ReactNode[] {
  return nodes.map((n, idx) => {
    const key = `${keyPrefix}-${idx}`;
    switch (n.t) {
      case 'text':
        return <React.Fragment key={key}>{n.v}</React.Fragment>;
      case 'bold':
        return (
          <strong key={key} className="font-semibold text-fg">
            {renderInline(n.c, key)}
          </strong>
        );
      case 'italic':
        return (
          <em key={key} className="italic">
            {renderInline(n.c, key)}
          </em>
        );
      case 'code':
        return (
          <code key={key} className="px-1 py-0.5 rounded bg-fill-2 font-mono text-[0.9em] text-fg">
            {n.v}
          </code>
        );
      case 'link':
        return (
          <a
            key={key}
            href={n.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-accent-text underline underline-offset-2 hover:opacity-80"
          >
            {renderInline(n.c, key)}
          </a>
        );
      default:
        return null;
    }
  });
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

const AnalystChart: React.FC<{ spec: ChartSpec }> = ({ spec }) => {
  const data = useMemo(
    () =>
      spec.labels.map((label, i) => {
        const row: Record<string, string | number> = { label };
        spec.series.forEach((s, si) => {
          row[`s${si}`] = s.values[i];
        });
        return row;
      }),
    [spec]
  );
  const multi = spec.series.length > 1;
  const manyLabels = spec.labels.length > 6;

  const axes = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line)" vertical={false} />
      <XAxis
        dataKey="label"
        tick={TICK}
        tickLine={false}
        axisLine={false}
        interval={0}
        angle={manyLabels ? -30 : 0}
        textAnchor={manyLabels ? 'end' : 'middle'}
        height={manyLabels ? 56 : 28}
      />
      <YAxis tick={TICK} tickLine={false} axisLine={false} width={44} tickFormatter={formatAxis} />
      <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => formatNumber(v)} cursor={{ fill: 'var(--color-fill-1)' }} />
      {multi && <Legend wrapperStyle={{ fontSize: 12 }} />}
    </>
  );

  let chart: React.ReactElement;
  if (spec.type === 'pie') {
    chart = (
      <PieChart>
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => formatNumber(v)} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Pie data={data} dataKey="s0" nameKey="label" innerRadius="45%" outerRadius="80%" stroke="var(--color-surface)">
          {data.map((_, i) => (
            <Cell key={i} fill={colorAt(i)} />
          ))}
        </Pie>
      </PieChart>
    );
  } else if (spec.type === 'line') {
    chart = (
      <LineChart data={data} margin={CHART_MARGIN}>
        {axes}
        {spec.series.map((s, i) => (
          <Line key={i} type="monotone" dataKey={`s${i}`} name={s.name} stroke={colorAt(i)} strokeWidth={2} dot={{ r: 3 }} />
        ))}
      </LineChart>
    );
  } else if (spec.type === 'area') {
    chart = (
      <AreaChart data={data} margin={CHART_MARGIN}>
        {axes}
        {spec.series.map((s, i) => (
          <Area key={i} type="monotone" dataKey={`s${i}`} name={s.name} stroke={colorAt(i)} fill={colorAt(i)} fillOpacity={0.18} strokeWidth={2} />
        ))}
      </AreaChart>
    );
  } else {
    chart = (
      <BarChart data={data} margin={CHART_MARGIN}>
        {axes}
        {spec.series.map((s, i) => (
          <Bar key={i} dataKey={`s${i}`} name={s.name} fill={colorAt(i)} radius={[4, 4, 0, 0]} />
        ))}
      </BarChart>
    );
  }

  return (
    <figure className="rounded-xl border border-line bg-surface p-3 sm:p-4 my-3" data-testid="analyst-chart">
      {spec.title && <figcaption className="text-xs sm:text-sm font-semibold text-fg mb-2">{spec.title}</figcaption>}
      <div className="h-60 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {chart}
        </ResponsiveContainer>
      </div>
    </figure>
  );
};

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

const HEADING_CLASS: Record<1 | 2 | 3 | 4, string> = {
  1: 'text-base sm:text-lg font-bold tracking-tight text-fg mt-1',
  2: 'text-sm sm:text-base font-bold text-fg mt-4 pb-1 border-b border-line',
  3: 'text-xs sm:text-sm font-bold text-fg mt-3',
  4: 'text-xs font-semibold uppercase tracking-wide text-fg-muted mt-3',
};

function renderBlock(block: Block, idx: number): React.ReactNode {
  const key = `b-${idx}`;
  switch (block.type) {
    case 'heading': {
      const Tag = (`h${Math.min(6, block.level + 1)}` as unknown) as React.ElementType;
      return (
        <Tag key={key} className={HEADING_CLASS[block.level]}>
          {renderInline(block.content, key)}
        </Tag>
      );
    }
    case 'paragraph':
      return (
        <p key={key} className="leading-relaxed">
          {renderInline(block.content, key)}
        </p>
      );
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag
          key={key}
          className={`pl-5 space-y-1 leading-relaxed ${block.ordered ? 'list-decimal' : 'list-disc'} marker:text-fg-subtle`}
        >
          {block.items.map((item, li) => (
            <li key={li}>{renderInline(item, `${key}-${li}`)}</li>
          ))}
        </Tag>
      );
    }
    case 'table':
      return (
        <div key={key} className="overflow-x-auto rounded-lg border border-line">
          <table className="min-w-full text-xs">
            <thead className="bg-fill-1">
              <tr>
                {block.header.map((h, hi) => (
                  <th key={hi} className="px-3 py-2 text-left font-semibold text-fg whitespace-nowrap">
                    {renderInline(h, `${key}-h${hi}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {block.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-3 py-2 text-fg align-top">
                      {renderInline(cell, `${key}-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'quote':
      return (
        <blockquote key={key} className="border-l-2 border-accent-line pl-3 italic text-fg-muted leading-relaxed">
          {renderInline(block.content, key)}
        </blockquote>
      );
    case 'code':
      return (
        <pre key={key} className="overflow-x-auto rounded-lg bg-fill-2 p-3 font-mono text-[11px] text-fg">
          {block.text}
        </pre>
      );
    case 'hr':
      return <hr key={key} className="border-line" />;
    case 'chart':
      return <AnalystChart key={key} spec={block.spec} />;
    default:
      return null;
  }
}

/** Renders an AI analyst answer: headings, bold/italic, lists, tables and charts. */
export const AnalystMessage: React.FC<{ content: string }> = ({ content }) => {
  const blocks = useMemo(() => parseAnalystMarkdown(content), [content]);
  return (
    <div className="space-y-2.5 break-words" data-testid="analyst-message">
      {blocks.map((b, i) => renderBlock(b, i))}
    </div>
  );
};
