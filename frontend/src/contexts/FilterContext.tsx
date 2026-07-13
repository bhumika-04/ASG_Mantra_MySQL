'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { usePathname } from 'next/navigation';

export type FilterMode = 'all' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | '1month' | '3months' | '6months' | '1year' | 'this_year' | 'last_year' | 'custom';

export const FILTER_OPTIONS: { label: string; value: FilterMode }[] = [
  { label: 'This Week', value: 'this_week' },
  { label: 'Last Week', value: 'last_week' },
  { label: 'This Month', value: 'this_month' },
  { label: 'Last Month', value: 'last_month' },
  { label: 'Last 3 Months', value: '3months' },
  { label: 'Last 6 Months', value: '6months' },
  { label: 'This Year', value: 'this_year' },
  { label: 'Last Year', value: 'last_year' },
  { label: 'Custom Range', value: 'custom' },
];

const fmt = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export function computeGrowthPrevPeriod(mode: FilterMode, customStart = '', customEnd = ''): { start_date?: string; end_date?: string } {
  const today = new Date();
  if (mode === 'all') return {};

  if (mode === 'this_week') {
    const day = today.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const thisMonday = new Date(today);
    thisMonday.setDate(today.getDate() + diff);
    const lastMonday = new Date(thisMonday);
    lastMonday.setDate(thisMonday.getDate() - 7);
    const lastSunday = new Date(thisMonday);
    lastSunday.setDate(thisMonday.getDate() - 1);
    return { start_date: fmt(lastMonday), end_date: fmt(lastSunday) };
  }
  if (mode === 'last_week') {
    const day = today.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const thisMonday = new Date(today);
    thisMonday.setDate(today.getDate() + diff);
    const prevMonday = new Date(thisMonday);
    prevMonday.setDate(thisMonday.getDate() - 14);
    const prevSunday = new Date(thisMonday);
    prevSunday.setDate(thisMonday.getDate() - 8);
    return { start_date: fmt(prevMonday), end_date: fmt(prevSunday) };
  }
  if (mode === 'this_month') {
    const prevMonthLastDay = new Date(today.getFullYear(), today.getMonth(), 0).getDate();
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const end = new Date(today.getFullYear(), today.getMonth() - 1, Math.min(today.getDate(), prevMonthLastDay));
    return { start_date: fmt(start), end_date: fmt(end) };
  }
  if (mode === 'last_month') {
    const start = new Date(today.getFullYear(), today.getMonth() - 2, 1);
    const end = new Date(today.getFullYear(), today.getMonth() - 1, 0);
    return { start_date: fmt(start), end_date: fmt(end) };
  }
  if (mode === 'this_year') {
    const start = new Date(today.getFullYear() - 1, 0, 1);
    const end = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
    return { start_date: fmt(start), end_date: fmt(end) };
  }
  if (mode === 'last_year') {
    const start = new Date(today.getFullYear() - 2, 0, 1);
    const end = new Date(today.getFullYear() - 2, 11, 31);
    return { start_date: fmt(start), end_date: fmt(end) };
  }

  // 1month, 3months, 6months, 1year, custom: same-duration period immediately before
  const current = computeDateRange(mode, customStart, customEnd);
  if (!current.start_date || !current.end_date) return {};
  const s = new Date(current.start_date + 'T00:00:00');
  const e = new Date(current.end_date + 'T00:00:00');
  const durationDays = Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
  const prevEnd = new Date(s);
  prevEnd.setDate(s.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevEnd.getDate() - durationDays);
  return { start_date: fmt(prevStart), end_date: fmt(prevEnd) };
}

export function computeDateRange(mode: FilterMode, customStart = '', customEnd = ''): { start_date?: string; end_date?: string } {
  const today = new Date();
  if (mode === 'all') return {};
  if (mode === 'custom') return { start_date: customStart || undefined, end_date: customEnd || undefined };

  if (mode === 'this_week') {
    const day = today.getDay(); // 0=Sun
    const diff = day === 0 ? -6 : 1 - day; // Monday
    const monday = new Date(today);
    monday.setDate(today.getDate() + diff);
    return { start_date: fmt(monday), end_date: fmt(today) };
  }
  if (mode === 'last_week') {
    const day = today.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const thisMonday = new Date(today);
    thisMonday.setDate(today.getDate() + diff);
    const lastMonday = new Date(thisMonday);
    lastMonday.setDate(thisMonday.getDate() - 7);
    const lastSunday = new Date(thisMonday);
    lastSunday.setDate(thisMonday.getDate() - 1);
    return { start_date: fmt(lastMonday), end_date: fmt(lastSunday) };
  }
  if (mode === 'this_month') {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return { start_date: fmt(start), end_date: fmt(today) };
  }
  if (mode === 'last_month') {
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const end = new Date(today.getFullYear(), today.getMonth(), 0);
    return { start_date: fmt(start), end_date: fmt(end) };
  }
  if (mode === 'this_year') {
    const start = new Date(today.getFullYear(), 0, 1);
    return { start_date: fmt(start), end_date: fmt(today) };
  }
  if (mode === 'last_year') {
    const start = new Date(today.getFullYear() - 1, 0, 1);
    const end = new Date(today.getFullYear() - 1, 11, 31);
    return { start_date: fmt(start), end_date: fmt(end) };
  }
  if (mode === '1month') {
    const start = new Date(today);
    start.setDate(today.getDate() - 30);
    return { start_date: fmt(start), end_date: fmt(today) };
  }
  if (mode === '1year') {
    const start = new Date(today);
    start.setFullYear(today.getFullYear() - 1);
    return { start_date: fmt(start), end_date: fmt(today) };
  }
  const months = mode === '3months' ? 3 : 6;
  // Last day of the most recently completed month
  const endMonth = new Date(today.getFullYear(), today.getMonth(), 0);
  // 1st of the month that is `months` before endMonth
  const startMonth = new Date(endMonth.getFullYear(), endMonth.getMonth() + 1 - months, 1);
  return { start_date: fmt(startMonth), end_date: fmt(endMonth) };
}

interface FilterContextType {
  filterMode: FilterMode;
  setFilterMode: (value: FilterMode) => void;
  customStart: string;
  setCustomStart: (value: string) => void;
  customEnd: string;
  setCustomEnd: (value: string) => void;
  // Global search — raw for controlled input, debounced for fetch deps
  globalSearchRaw: string;
  globalSearch: string;
  setGlobalSearchRaw: (value: string) => void;
  clearSearch: () => void;
  // Legacy fields kept for backward compatibility
  timePeriod: string;
  setTimePeriod: (value: string) => void;
  channel: string;
  setChannel: (value: string) => void;
}

const FilterContext = createContext<FilterContextType | undefined>(undefined);

export function FilterProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [filterMode, setFilterMode] = useState<FilterMode>('this_month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [timePeriod, setTimePeriod] = useState('6months');
  const [channel, setChannel] = useState('all');
  const [globalSearchRaw, setGlobalSearchRaw] = useState('');
  const [globalSearch, setGlobalSearch] = useState('');

  // Reset all filters and searches on every page navigation
  useEffect(() => {
    setFilterMode('this_month');
    setChannel('all');
    setCustomStart('');
    setCustomEnd('');
    setGlobalSearchRaw('');
    setGlobalSearch('');
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (globalSearchRaw === '') {
      setGlobalSearch('');
      return;
    }
    const t = setTimeout(() => setGlobalSearch(globalSearchRaw), 400);
    return () => clearTimeout(t);
  }, [globalSearchRaw]);

  const clearSearch = () => {
    setGlobalSearchRaw('');
    setGlobalSearch('');
  };

  return (
    <FilterContext.Provider value={{
      filterMode, setFilterMode,
      customStart, setCustomStart,
      customEnd, setCustomEnd,
      globalSearchRaw, globalSearch, setGlobalSearchRaw, clearSearch,
      timePeriod, setTimePeriod,
      channel, setChannel,
    }}>
      {children}
    </FilterContext.Provider>
  );
}

export function useFilter() {
  const context = useContext(FilterContext);
  if (context === undefined) {
    throw new Error('useFilter must be used within a FilterProvider');
  }
  return context;
}
