'use client';

import { createContext, useContext, useState, ReactNode } from 'react';

export type FilterMode = 'all' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | '1month' | '3months' | '6months' | '1year' | 'this_year' | 'custom';

export const FILTER_OPTIONS: { label: string; value: FilterMode }[] = [
  { label: 'This Week', value: 'this_week' },
  { label: 'Last Week', value: 'last_week' },
  { label: 'This Month', value: 'this_month' },
  { label: 'Last Month', value: 'last_month' },
  { label: 'Last 3 Months', value: '3months' },
  { label: 'Last 6 Months', value: '6months' },
  { label: 'This Year', value: 'this_year' },
  { label: 'Custom Range', value: 'custom' },
];

const fmt = (d: Date) => d.toISOString().split('T')[0];

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
  const start = new Date(today);
  start.setMonth(today.getMonth() - months);
  return { start_date: fmt(start), end_date: fmt(today) };
}

interface FilterContextType {
  filterMode: FilterMode;
  setFilterMode: (value: FilterMode) => void;
  customStart: string;
  setCustomStart: (value: string) => void;
  customEnd: string;
  setCustomEnd: (value: string) => void;
  // Legacy fields kept for backward compatibility
  timePeriod: string;
  setTimePeriod: (value: string) => void;
  channel: string;
  setChannel: (value: string) => void;
}

const FilterContext = createContext<FilterContextType | undefined>(undefined);

export function FilterProvider({ children }: { children: ReactNode }) {
  const [filterMode, setFilterMode] = useState<FilterMode>('this_month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [timePeriod, setTimePeriod] = useState('6months');
  const [channel, setChannel] = useState('all');

  return (
    <FilterContext.Provider value={{
      filterMode, setFilterMode,
      customStart, setCustomStart,
      customEnd, setCustomEnd,
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
