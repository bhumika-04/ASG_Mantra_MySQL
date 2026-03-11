'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Search, Filter, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface FilterOption {
  label: string;
  value: string;
}

interface FilterConfig {
  key: string;
  label: string;
  options: FilterOption[];
  defaultValue?: string;
}

interface FilterBarProps {
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  filters?: FilterConfig[];
  filterValues?: Record<string, string>;
  onFilterChange?: (key: string, value: string) => void;
  onClearFilters?: () => void;
  className?: string;
  children?: React.ReactNode;
}

export function FilterBar({
  searchPlaceholder = 'Search...',
  searchValue = '',
  onSearchChange,
  filters = [],
  filterValues = {},
  onFilterChange,
  onClearFilters,
  className,
  children,
}: FilterBarProps) {
  const hasActiveFilters = Object.values(filterValues).some(v => v && v !== 'all');

  return (
    <div className={cn('flex flex-wrap items-center gap-3', className)}>
      {/* Search */}
      {onSearchChange && (
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder={searchPlaceholder}
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value.replace(/^\s+/, ''))}
            className="pl-9 h-9"
          />
        </div>
      )}

      {/* Filters */}
      {filters.length > 0 && filters.map((filter) => (
        <Select
          key={filter.key}
          value={filterValues[filter.key] || filter.defaultValue || 'all'}
          onValueChange={(value) => onFilterChange?.(filter.key, value)}
        >
          <SelectTrigger className="h-9 w-auto min-w-[140px]">
            <Filter className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {filter.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}

      {hasActiveFilters && onClearFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onClearFilters}
          className="h-9 px-3"
        >
          <X className="h-4 w-4 mr-1" />
          Clear
        </Button>
      )}

      {/* Additional actions */}
      {children}
    </div>
  );
}

// Simple search-only variant
interface SearchBarProps {
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  className?: string;
}

export function SearchBar({
  placeholder = 'Search...',
  value = '',
  onChange,
  className,
}: SearchBarProps) {
  return (
    <div className={cn('relative w-full', className)}>
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange?.(e.target.value.replace(/^\s+/, ''))}
        className="pl-9 h-9"
      />
    </div>
  );
}
