'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight, CalendarDays, ChevronDown, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';

interface SnapshotDatePickerProps {
  availableDates: string[];   // ISO YYYY-MM-DD strings
  selectedDate: string;       // ISO YYYY-MM-DD
  onSelect: (date: string) => void;
  onReset: () => void;
  className?: string;
}

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function toISO(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseISO(iso: string): { year: number; month: number; day: number } {
  const [y, m, d] = iso.split('-').map(Number);
  return { year: y, month: m - 1, day: d };
}

function formatDisplay(iso: string) {
  const { year, month, day } = parseISO(iso);
  return `${String(day).padStart(2, '0')} ${MONTHS[month].slice(0, 3)} ${year}`;
}

export function SnapshotDatePicker({
  availableDates,
  selectedDate,
  onSelect,
  onReset,
  className,
}: SnapshotDatePickerProps) {
  const [open, setOpen] = React.useState(false);

  const latestDate = availableDates[0] ?? '';
  const activeDate = selectedDate || latestDate;

  const { year: initYear, month: initMonth } = activeDate
    ? parseISO(activeDate)
    : { year: new Date().getFullYear(), month: new Date().getMonth() };

  const [viewYear, setViewYear] = React.useState(initYear);
  const [viewMonth, setViewMonth] = React.useState(initMonth);

  // Sync view when selected date changes externally
  React.useEffect(() => {
    if (activeDate) {
      const { year, month } = parseISO(activeDate);
      setViewYear(year);
      setViewMonth(month);
    }
  }, [activeDate]);

  const availableSet = React.useMemo(() => new Set(availableDates), [availableDates]);

  const isLatest = !selectedDate || selectedDate === latestDate;

  // Build calendar grid for current view month
  const firstDow = new Date(viewYear, viewMonth, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  // Pad to full rows
  while (cells.length % 7 !== 0) cells.push(null);

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  };

  const handleDayClick = (day: number) => {
    const iso = toISO(viewYear, viewMonth, day);
    if (availableSet.has(iso)) {
      onSelect(iso);
      setOpen(false);
    }
  };

  const displayLabel = activeDate ? formatDisplay(activeDate) : 'Select date';
  const isLatestSelected = activeDate === latestDate;

  return (
    <div className={cn('flex flex-wrap items-center gap-3', className)}>
      <div className="flex items-center gap-1.5 text-sm shrink-0">
        <CalendarDays className="h-4 w-4 text-blue-500" />
        <span className="font-medium text-foreground">ASG Snapshot Date:</span>
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs font-medium pr-2.5 min-w-[152px] justify-between"
          >
            <span>{displayLabel}{isLatestSelected ? ' (latest)' : ''}</span>
            <ChevronDown className="h-3.5 w-3.5 opacity-50 shrink-0" />
          </Button>
        </PopoverTrigger>

        <PopoverContent className="w-72 p-0" align="start">
          {/* Legend */}
          <div className="flex items-center gap-4 px-4 py-2.5 border-b text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500" /> Snapshot available
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-blue-500" /> Latest
            </span>
          </div>

          {/* Month navigation */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b">
            <button
              onClick={prevMonth}
              className="h-7 w-7 flex items-center justify-center rounded hover:bg-muted transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-semibold">
              {MONTHS[viewMonth]} {viewYear}
            </span>
            <button
              onClick={nextMonth}
              className="h-7 w-7 flex items-center justify-center rounded hover:bg-muted transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Calendar grid */}
          <div className="p-3">
            {/* Day-of-week headers */}
            <div className="grid grid-cols-7 mb-1">
              {DAYS.map(d => (
                <div key={d} className="h-8 flex items-center justify-center text-[11px] font-medium text-muted-foreground">
                  {d}
                </div>
              ))}
            </div>

            {/* Day cells */}
            <div className="grid grid-cols-7">
              {cells.map((day, idx) => {
                if (!day) return <div key={idx} />;

                const iso = toISO(viewYear, viewMonth, day);
                const hasSnapshot = availableSet.has(iso);
                const isSelected = iso === activeDate;
                const isLatestDay = iso === latestDate;

                return (
                  <div key={idx} className="relative flex flex-col items-center">
                    <button
                      onClick={() => handleDayClick(day)}
                      disabled={!hasSnapshot}
                      className={cn(
                        'h-8 w-8 rounded-full text-sm flex items-center justify-center transition-colors',
                        isSelected
                          ? 'bg-primary text-primary-foreground font-semibold'
                          : hasSnapshot
                          ? 'hover:bg-muted font-medium text-foreground cursor-pointer'
                          : 'text-muted-foreground/40 cursor-default',
                      )}
                    >
                      {day}
                    </button>
                    {/* Dot indicator */}
                    {hasSnapshot && !isSelected && (
                      <span
                        className={cn(
                          'absolute bottom-0.5 h-1 w-1 rounded-full',
                          isLatestDay ? 'bg-blue-500' : 'bg-emerald-500'
                        )}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Reset to latest */}
          {!isLatest && (
            <div className="px-3 pb-3 pt-1 border-t">
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs text-blue-600 hover:text-blue-700 gap-1.5"
                onClick={() => { onReset(); setOpen(false); }}
              >
                <RotateCcw className="h-3 w-3" />
                Reset to latest snapshot
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>

      <span className="text-xs text-muted-foreground">
        {availableDates.length} snapshot{availableDates.length !== 1 ? 's' : ''} available
        {availableDates.length > 0 && (
          <> · earliest {formatDisplay(availableDates[availableDates.length - 1])}</>
        )}
      </span>
    </div>
  );
}
