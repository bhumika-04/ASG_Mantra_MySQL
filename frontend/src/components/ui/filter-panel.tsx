'use client';

import { useState, useRef, useEffect } from 'react';
import { SlidersHorizontal, X, CalendarDays } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface FilterValues {
  period: string;   // '3months' | '6months' | '1year' | 'all'
  dateFrom: string;
  dateTo: string;
  channel: string;
  search: string;
  status: string;
  state: string;
  priceMin: string;
  priceMax: string;
}

export const DEFAULT_FILTER_VALUES: FilterValues = {
  period: 'all',
  dateFrom: '',
  dateTo: '',
  channel: 'all',
  search: '',
  status: 'all',
  state: 'all',
  priceMin: '',
  priceMax: '',
};

// Quick date preset helpers
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};
const monthsAgo = (n: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
};

const DATE_PRESETS = [
  { label: 'Today',    getFrom: () => today(),       getTo: () => today() },
  { label: 'Last 7d',  getFrom: () => daysAgo(7),    getTo: () => today() },
  { label: 'Last 30d', getFrom: () => daysAgo(30),   getTo: () => today() },
  { label: 'Last 3M',  getFrom: () => monthsAgo(3),  getTo: () => today() },
  { label: 'Last 6M',  getFrom: () => monthsAgo(6),  getTo: () => today() },
  { label: 'Last 1Y',  getFrom: () => monthsAgo(12), getTo: () => today() },
];

function countActive(v: FilterValues, inventoryDates?: string[], selectedInventoryDate?: string): number {
  let n = 0;
  if (v.period !== 'all') n++;
  if (v.dateFrom) n++;
  if (v.dateTo) n++;
  if (v.channel !== 'all') n++;
  if (v.search) n++;
  if (v.status !== 'all') n++;
  if (v.state !== 'all') n++;
  if (v.priceMin) n++;
  if (v.priceMax) n++;
  if (inventoryDates?.length && selectedInventoryDate && selectedInventoryDate !== inventoryDates[0]) n++;
  return n;
}

interface FilterPanelProps {
  values: FilterValues;
  onChange: (key: keyof FilterValues, value: string) => void;
  onClear: () => void;
  showPeriod?: boolean;
  showDateRange?: boolean;
  showChannel?: boolean;
  showSearch?: boolean;
  showStatus?: boolean;
  showPriceRange?: boolean;
  showState?: boolean;
  stateOptions?: { label: string; value: string }[];
  statusOptions?: { label: string; value: string }[];
  searchPlaceholder?: string;
  inventoryDates?: string[];
  selectedInventoryDate?: string;
  onInventoryDateChange?: (date: string) => void;
}

export function FilterPanel({
  values,
  onChange,
  onClear,
  showPeriod = false,
  showDateRange = false,
  showChannel = true,
  showSearch = false,
  showStatus = false,
  showPriceRange = false,
  showState = false,
  stateOptions = [],
  statusOptions = [],
  searchPlaceholder = 'Search products...',
  inventoryDates,
  selectedInventoryDate,
  onInventoryDateChange,
}: FilterPanelProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = countActive(values, inventoryDates, selectedInventoryDate);

  // Find which preset is currently active (if any)
  const activePreset = DATE_PRESETS.find(
    p => values.dateFrom === p.getFrom() && values.dateTo === p.getTo()
  )?.label ?? null;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(!open)}
        className={`h-9 gap-2 ${active > 0 ? 'border-blue-500 text-blue-600' : ''}`}
      >
        <SlidersHorizontal className="h-4 w-4" />
        Filters
        {active > 0 && (
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white">
            {active}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-80 rounded-xl border border-border bg-background shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-sm font-semibold">Filters</p>
              {active > 0 && (
                <span className="text-xs text-blue-600 font-medium">{active} active</span>
              )}
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="p-4 space-y-5 max-h-[70vh] overflow-y-auto">

            {/* Date Range */}
            {showDateRange && (
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="text-xs font-semibold text-foreground uppercase tracking-wider">Date Range</p>
                </div>

                {/* Quick presets */}
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {DATE_PRESETS.map(preset => (
                    <button
                      key={preset.label}
                      onClick={() => {
                        onChange('dateFrom', preset.getFrom());
                        onChange('dateTo', preset.getTo());
                      }}
                      className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                        activePreset === preset.label
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted hover:text-foreground'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                  {(values.dateFrom || values.dateTo) && (
                    <button
                      onClick={() => { onChange('dateFrom', ''); onChange('dateTo', ''); }}
                      className="px-2.5 py-1 text-xs rounded-md border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {/* Custom date inputs */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Start Date</label>
                    <input
                      type="date"
                      value={values.dateFrom}
                      onChange={e => onChange('dateFrom', e.target.value)}
                      className="w-full h-8 text-xs border border-border rounded-md px-2 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">End Date</label>
                    <input
                      type="date"
                      value={values.dateTo}
                      onChange={e => onChange('dateTo', e.target.value)}
                      className="w-full h-8 text-xs border border-border rounded-md px-2 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Time Period */}
            {showPeriod && (
              <div>
                <p className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">Time Period</p>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { label: 'All Time', value: 'all' },
                    { label: 'Last 3M', value: '3months' },
                    { label: 'Last 6M', value: '6months' },
                    { label: 'Last 1Y', value: '1year' },
                  ].map(o => (
                    <button
                      key={o.value}
                      onClick={() => onChange('period', o.value)}
                      className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                        values.period === o.value
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted hover:text-foreground'
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Inventory Snapshot Date */}
            {inventoryDates && inventoryDates.length > 1 && onInventoryDateChange && (
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="text-xs font-semibold text-foreground uppercase tracking-wider">Snapshot Date</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {inventoryDates.map(d => (
                    <button
                      key={d}
                      onClick={() => onInventoryDateChange(d)}
                      className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                        selectedInventoryDate === d
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted hover:text-foreground'
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Channel */}
            {showChannel && (
              <div>
                <p className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">Channel</p>
                <div className="flex gap-1.5">
                  {[
                    { label: 'All', value: 'all' },
                    { label: 'Amazon', value: 'amazon' },
                    { label: 'Blinkit', value: 'blinkit' },
                  ].map(o => (
                    <button
                      key={o.value}
                      onClick={() => onChange('channel', o.value)}
                      className={`flex-1 py-1.5 text-xs rounded-md border font-medium transition-colors ${
                        values.channel === o.value
                          ? o.value === 'amazon'
                            ? 'bg-blue-600 text-white border-blue-600'
                            : o.value === 'blinkit'
                            ? 'bg-yellow-500 text-white border-yellow-500'
                            : 'bg-gray-800 text-white border-gray-800'
                          : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted hover:text-foreground'
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Status */}
            {showStatus && statusOptions.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">Status</p>
                <div className="flex flex-wrap gap-1.5">
                  {statusOptions.map(o => (
                    <button
                      key={o.value}
                      onClick={() => onChange('status', o.value)}
                      className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                        values.status === o.value
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted hover:text-foreground'
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* State */}
            {showState && stateOptions.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">State</p>
                <div className="flex flex-wrap gap-1.5">
                  {stateOptions.map(o => (
                    <button
                      key={o.value}
                      onClick={() => onChange('state', o.value)}
                      className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                        values.state === o.value
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted hover:text-foreground'
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Product Search */}
            {showSearch && (
              <div>
                <p className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">Product Search</p>
                <input
                  type="text"
                  placeholder={searchPlaceholder}
                  value={values.search}
                  onChange={e => onChange('search', e.target.value)}
                  className="w-full h-8 text-xs border border-border rounded-md px-2 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            )}

            {/* Revenue Range */}
            {showPriceRange && (
              <div>
                <p className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">Revenue Range (₹)</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Min</label>
                    <input
                      type="number"
                      min="0"
                      placeholder="0"
                      value={values.priceMin}
                      onChange={e => onChange('priceMin', e.target.value)}
                      className="w-full h-8 text-xs border border-border rounded-md px-2 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Max</label>
                    <input
                      type="number"
                      min="0"
                      placeholder="No limit"
                      value={values.priceMax}
                      onChange={e => onChange('priceMax', e.target.value)}
                      className="w-full h-8 text-xs border border-border rounded-md px-2 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 pb-4 pt-2 border-t border-border">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { onClear(); setOpen(false); }}
              className="w-full h-8 text-xs text-muted-foreground hover:text-red-600 hover:bg-red-50"
            >
              Reset All Filters
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
