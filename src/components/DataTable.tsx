import React, { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Search,
} from 'lucide-react';
import { STORAGE_PREFIX } from '../config/app';
import { exportRowsToCsv } from '../utils/formatters';
import { EmptyState } from './EmptyState';

export interface DataTableColumn<T> {
  key: keyof T & string;
  header: string;
  align?: 'left' | 'right';
  sortable?: boolean;
  render?: (row: T) => React.ReactNode;
  csvFormat?: (val: unknown, row: T) => string;
}

interface DataTableProps<T extends Record<string, unknown>> {
  title: string;
  subtitle?: string;
  tableName: string; // used for adlens_<tableName>.csv
  columns: DataTableColumn<T>[];
  data: T[];
  rowKey: (row: T, index: number) => string;
  loading?: boolean;
  pageSize?: number;
  searchPlaceholder?: string;
  searchKeys?: (keyof T & string)[];
  defaultSortKey?: keyof T & string;
  defaultSortDir?: 'asc' | 'desc';
  onRowClick?: (row: T) => void;
  headerExtra?: React.ReactNode;
}

export function DataTable<T extends Record<string, unknown>>({
  title,
  subtitle,
  tableName,
  columns,
  data,
  rowKey,
  loading = false,
  pageSize = 6,
  searchPlaceholder = 'Search table...',
  searchKeys,
  defaultSortKey,
  defaultSortDir = 'desc',
  onRowClick,
  headerExtra,
}: DataTableProps<T>) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<(keyof T & string) | undefined>(defaultSortKey);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(defaultSortDir);
  const [page, setPage] = useState(1);

  const filteredData = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data;
    const keysToSearch = searchKeys && searchKeys.length > 0 ? searchKeys : columns.map((c) => c.key);
    return data.filter((row) =>
      keysToSearch.some((k) =>
        String(row[k] ?? '')
          .toLowerCase()
          .includes(q)
      )
    );
  }, [data, search, searchKeys, columns]);

  const sortedData = useMemo(() => {
    if (!sortKey) return filteredData;
    return [...filteredData].sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      if (typeof va === 'number' && typeof vb === 'number') {
        return sortDir === 'asc' ? va - vb : vb - va;
      }
      const sa = String(va ?? '').toLowerCase();
      const sb = String(vb ?? '').toLowerCase();
      if (sa < sb) return sortDir === 'asc' ? -1 : 1;
      if (sa > sb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredData, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedData.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedData = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, safePage, pageSize]);

  const handleSort = (key: keyof T & string) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
    setPage(1);
  };

  const handleExportCsv = () => {
    exportRowsToCsv(
      tableName,
      columns.map((c) => ({
        key: c.key,
        header: c.header,
        format: c.csvFormat,
      })),
      sortedData,
      STORAGE_PREFIX
    );
  };

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
      {/* Table Header & Controls */}
      <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
          {subtitle && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>
          )}
          {headerExtra && <div className="mt-2">{headerExtra}</div>}
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="relative flex-1 sm:flex-initial">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder={searchPlaceholder}
              aria-label={`Search ${title}`}
              className="w-full sm:w-52 pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={loading || sortedData.length === 0}
            aria-label={`Export ${title} CSV`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Table Body */}
      {loading ? (
        <div className="p-5 space-y-3 animate-pulse">
          {Array.from({ length: 5 }).map((_, idx) => (
            <div
              key={idx}
              className="h-9 bg-slate-100 dark:bg-slate-800/60 rounded-lg w-full"
            />
          ))}
        </div>
      ) : sortedData.length === 0 ? (
        <div className="p-5">
          <EmptyState
            title="No rows match your current filter"
            description={
              search
                ? `No records matched "${search}". Clear the search query to see all rows.`
                : 'No records returned for the selected date range.'
            }
            actionLabel={search ? 'Clear Search' : undefined}
            onAction={search ? () => setSearch('') : undefined}
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                {columns.map((col) => {
                  const isSorted = sortKey === col.key;
                  const canSort = col.sortable !== false;
                  return (
                    <th
                      key={col.key}
                      scope="col"
                      className={`py-2.5 px-4 whitespace-nowrap ${
                        col.align === 'right' ? 'text-right' : 'text-left'
                      }`}
                    >
                      {canSort ? (
                        <button
                          type="button"
                          onClick={() => handleSort(col.key)}
                          className={`inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100 transition-colors cursor-pointer ${
                            col.align === 'right' ? 'ml-auto' : ''
                          }`}
                        >
                          <span>{col.header}</span>
                          {isSorted ? (
                            sortDir === 'asc' ? (
                              <ArrowUp className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                            ) : (
                              <ArrowDown className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                            )
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-40" />
                          )}
                        </button>
                      ) : (
                        <span>{col.header}</span>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800/80 text-xs">
              {pagedData.map((row, index) => (
                <tr
                  key={rowKey(row, index)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`transition-colors ${
                    onRowClick
                      ? 'hover:bg-blue-50/60 dark:hover:bg-blue-950/30 cursor-pointer'
                      : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/40'
                  }`}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={`py-3 px-4 whitespace-nowrap ${
                        col.align === 'right'
                          ? 'text-right font-mono tabular-nums text-slate-800 dark:text-slate-200'
                          : 'text-left text-slate-900 dark:text-slate-100'
                      }`}
                    >
                      {col.render ? col.render(row) : String(row[col.key] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination Footer */}
      {!loading && sortedData.length > 0 && (
        <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4 text-xs text-slate-500 dark:text-slate-400">
          <div className="font-mono tabular-nums">
            Showing {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, sortedData.length)} of{' '}
            {sortedData.length}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              aria-label="Previous page"
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="px-2 font-mono tabular-nums text-slate-700 dark:text-slate-300">
              Page {safePage} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              aria-label="Next page"
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
