'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import {
  ArrowUp,
  ArrowDown,
  Settings2,
  Eye,
  EyeOff,
  GripVertical,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu';

export interface GridColumn<T> {
  id: string;
  header: string | React.ReactNode;
  accessorKey?: keyof T;
  cell?: (row: T) => React.ReactNode;
  sortable?: boolean;
  width?: number;
  minWidth?: number;
  align?: 'left' | 'center' | 'right';
}

interface DataGridProps<T> {
  data: T[];
  className?: string;
  onRowClick?: (row: T) => void;
  gridState: ReturnType<typeof useDataGrid<T>>;
  pageSize?: number;
}

export type RowDensity = 'compact' | 'normal' | 'comfortable';

type SortDirection = 'asc' | 'desc' | null;

// View Options Component
interface ViewOptionsButtonProps {
  columns: GridColumn<any>[];
  visibleColumns: Set<string>;
  onToggleColumn: (columnId: string) => void;
  rowDensity: RowDensity;
  onDensityChange: (density: RowDensity) => void;
}

export function ViewOptionsButton({
  columns,
  visibleColumns,
  onToggleColumn,
  rowDensity,
  onDensityChange,
}: ViewOptionsButtonProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-2">
          <Settings2 className="h-4 w-4" />
          View
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Column Visibility</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="max-h-64 overflow-y-auto scrollbar-hide">
          {columns.map((column) => (
            <DropdownMenuCheckboxItem
              key={column.id}
              checked={visibleColumns.has(column.id)}
              onCheckedChange={() => onToggleColumn(column.id)}
            >
              <div className="flex items-center gap-2">
                {visibleColumns.has(column.id) ? (
                  <Eye className="h-3.5 w-3.5" />
                ) : (
                  <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span>{typeof column.header === 'string' ? column.header : column.id}</span>
              </div>
            </DropdownMenuCheckboxItem>
          ))}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Row Density</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => onDensityChange('compact')}>
          <Checkbox checked={rowDensity === 'compact'} className="mr-2" />
          Compact
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onDensityChange('normal')}>
          <Checkbox checked={rowDensity === 'normal'} className="mr-2" />
          Normal
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onDensityChange('comfortable')}>
          <Checkbox checked={rowDensity === 'comfortable'} className="mr-2" />
          Comfortable
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Custom Hook to manage grid state
export function useDataGrid<T>(initialColumns: GridColumn<T>[]) {
  const [columns, setColumns] = React.useState(initialColumns);
  const [columnWidths, setColumnWidths] = React.useState<Record<string, number>>(() => {
    const widths: Record<string, number> = {};
    initialColumns.forEach((col) => {
      widths[col.id] = col.width || 150;
    });
    return widths;
  });
  const [visibleColumns, setVisibleColumns] = React.useState<Set<string>>(
    new Set(initialColumns.map((col) => col.id))
  );
  const [sortColumn, setSortColumn] = React.useState<string | null>(null);
  const [sortDirection, setSortDirection] = React.useState<SortDirection>(null);
  const [rowDensity, setRowDensity] = React.useState<RowDensity>('compact');
  const [draggedColumn, setDraggedColumn] = React.useState<string | null>(null);

  const toggleColumnVisibility = (columnId: string) => {
    const newVisible = new Set(visibleColumns);
    if (newVisible.has(columnId)) {
      newVisible.delete(columnId);
    } else {
      newVisible.add(columnId);
    }
    setVisibleColumns(newVisible);
  };

  return {
    columns,
    setColumns,
    columnWidths,
    setColumnWidths,
    visibleColumns,
    toggleColumnVisibility,
    sortColumn,
    setSortColumn,
    sortDirection,
    setSortDirection,
    rowDensity,
    setRowDensity,
    draggedColumn,
    setDraggedColumn,
  };
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export function DataGrid<T extends Record<string, any>>({
  data,
  className,
  onRowClick,
  gridState,
  pageSize: defaultPageSize = 25,
}: DataGridProps<T>) {
  const {
    columns,
    setColumns,
    columnWidths,
    setColumnWidths,
    visibleColumns,
    sortColumn,
    setSortColumn,
    sortDirection,
    setSortDirection,
    rowDensity,
    draggedColumn,
    setDraggedColumn,
  } = gridState;

  const [resizingColumn, setResizingColumn] = React.useState<string | null>(null);

  // Sort data
  const sortedData = React.useMemo(() => {
    if (!sortColumn || !sortDirection) return data;

    const column = columns.find((col) => col.id === sortColumn);
    if (!column || !column.accessorKey) return data;

    return [...data].sort((a, b) => {
      const aVal = a[column.accessorKey as string];
      const bVal = b[column.accessorKey as string];

      if (aVal === bVal) return 0;
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        const comparison = aVal.localeCompare(bVal);
        return sortDirection === 'asc' ? comparison : -comparison;
      }

      const comparison = aVal < bVal ? -1 : 1;
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [data, sortColumn, sortDirection, columns]);

  // Pagination state
  const [currentPage, setCurrentPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(defaultPageSize);
  const totalPages = Math.max(1, Math.ceil(sortedData.length / pageSize));

  // Reset to page 1 when data or pageSize changes and current page is out of bounds
  React.useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(1);
  }, [sortedData.length, pageSize, totalPages, currentPage]);

  const paginatedData = React.useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, currentPage, pageSize]);

  const handleSort = (columnId: string) => {
    const column = columns.find((col) => col.id === columnId);
    if (!column?.sortable) return;

    if (sortColumn === columnId) {
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else if (sortDirection === 'desc') {
        setSortColumn(null);
        setSortDirection(null);
      }
    } else {
      setSortColumn(columnId);
      setSortDirection('asc');
    }
  };

  const handleDragStart = (columnId: string) => {
    setDraggedColumn(columnId);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (targetColumnId: string) => {
    if (!draggedColumn || draggedColumn === targetColumnId) {
      setDraggedColumn(null);
      return;
    }

    const draggedIndex = columns.findIndex((col) => col.id === draggedColumn);
    const targetIndex = columns.findIndex((col) => col.id === targetColumnId);

    const newColumns = [...columns];
    const [removed] = newColumns.splice(draggedIndex, 1);
    newColumns.splice(targetIndex, 0, removed);

    setColumns(newColumns);
    setDraggedColumn(null);
  };

  // Column resize handlers
  const handleResizeStart = (e: React.MouseEvent, columnId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setResizingColumn(columnId);
    const startX = e.clientX;
    const startWidth = columnWidths[columnId];

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const diff = moveEvent.clientX - startX;
      const newWidth = Math.max((columns.find(c => c.id === columnId)?.minWidth || 100), startWidth + diff);
      setColumnWidths((prev) => ({ ...prev, [columnId]: newWidth }));
    };

    const handleMouseUp = () => {
      setResizingColumn(null);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const visibleColumnsArray = columns.filter((col: GridColumn<T>) => visibleColumns.has(col.id));

  const densityClasses: Record<RowDensity, string> = {
    compact: 'py-2',
    normal: 'py-3',
    comfortable: 'py-4',
  };

  return (
    <div className={cn('relative', className)}>
      {/* Grid Table */}
      <div className="rounded-lg border bg-card overflow-auto scrollbar-hide">
        <table className="w-full border-collapse">
          {/* Header */}
          <thead className="bg-muted/50 sticky top-0 z-10">
            <tr>
              {visibleColumnsArray.map((column) => (
                <th
                  key={column.id}
                  draggable
                  onDragStart={() => handleDragStart(column.id)}
                  onDragOver={handleDragOver}
                  onDrop={() => handleDrop(column.id)}
                  className={cn(
                    'relative px-4 py-3 text-left text-sm font-semibold uppercase tracking-wide',
                    column.sortable && 'cursor-pointer select-none hover:bg-muted/70',
                    draggedColumn === column.id && 'opacity-50',
                    column.align === 'center' && 'text-center',
                    column.align === 'right' && 'text-right'
                  )}
                  style={{
                    width: `${columnWidths[column.id]}px`,
                    minWidth: `${column.minWidth || 100}px`,
                  }}
                  onClick={() => column.sortable && handleSort(column.id)}
                >
                  <div className="flex items-center gap-2">
                    <GripVertical className="h-4 w-4 text-muted-foreground/50 cursor-grab flex-shrink-0" />
                    <span className="flex-1 whitespace-nowrap overflow-hidden text-ellipsis">{column.header}</span>
                    {column.sortable && sortColumn === column.id && (
                      <div className="flex-shrink-0">
                        {sortDirection === 'asc' ? (
                          <ArrowUp className="h-4 w-4" />
                        ) : (
                          <ArrowDown className="h-4 w-4" />
                        )}
                      </div>
                    )}
                  </div>
                  {/* Resize Handle */}
                  <div
                    className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/50 active:bg-primary"
                    onMouseDown={(e) => handleResizeStart(e, column.id)}
                  />
                </th>
              ))}
            </tr>
          </thead>

          {/* Body */}
          <tbody className="divide-y">
            {paginatedData.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                className={cn(
                  'hover:bg-muted/50 transition-colors',
                  onRowClick && 'cursor-pointer'
                )}
                onClick={() => onRowClick?.(row)}
              >
                {visibleColumnsArray.map((column) => (
                  <td
                    key={column.id}
                    className={cn(
                      'px-4 text-sm',
                      densityClasses[rowDensity],
                      column.align === 'center' && 'text-center',
                      column.align === 'right' && 'text-right'
                    )}
                    style={{
                      width: `${columnWidths[column.id]}px`,
                      minWidth: `${column.minWidth || 100}px`,
                    }}
                  >
                    {column.cell
                      ? column.cell(row)
                      : column.accessorKey
                      ? (row[column.accessorKey] as React.ReactNode)
                      : null}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      {sortedData.length > 0 && (
        <div className="flex items-center justify-between mt-3 px-1">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Rows:</span>
            <div className="relative">
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="appearance-none bg-muted border border-muted rounded px-3 py-1 pr-7 text-sm text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
              <ChevronsUpDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            </div>
            <span className="ml-2">
              {((currentPage - 1) * pageSize) + 1}–{Math.min(currentPage * pageSize, sortedData.length)} of {sortedData.length}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(1)}
            >
              <ChevronLeft className="h-4 w-4" />
              <ChevronLeft className="h-4 w-4 -ml-2" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((p) => p - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>

            {/* Page number buttons */}
            {(() => {
              const pages: (number | '...')[] = [];
              if (totalPages <= 7) {
                for (let i = 1; i <= totalPages; i++) pages.push(i);
              } else {
                pages.push(1);
                if (currentPage > 3) pages.push('...');
                for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) pages.push(i);
                if (currentPage < totalPages - 2) pages.push('...');
                pages.push(totalPages);
              }
              return pages.map((p, idx) =>
                p === '...' ? (
                  <span key={`dots-${idx}`} className="h-8 w-6 flex items-center justify-center text-muted-foreground text-sm">…</span>
                ) : (
                  <Button
                    key={p}
                    variant={currentPage === p ? 'default' : 'ghost'}
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => setCurrentPage(p as number)}
                  >
                    {p}
                  </Button>
                )
              );
            })()}

            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage((p) => p + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage(totalPages)}
            >
              <ChevronRight className="h-4 w-4" />
              <ChevronRight className="h-4 w-4 -ml-2" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
