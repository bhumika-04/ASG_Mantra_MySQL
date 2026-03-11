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
  BookmarkCheck,
  RotateCcw,
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
  sticky?: boolean;
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
  onSave?: () => void;
  onReset?: () => void;
}

export function ViewOptionsButton({
  columns,
  visibleColumns,
  onToggleColumn,
  rowDensity,
  onDensityChange,
  onSave,
  onReset,
}: ViewOptionsButtonProps) {
  const [open, setOpen] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  const handleSave = () => {
    onSave?.();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
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
              onSelect={(e) => e.preventDefault()}
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
        <DropdownMenuItem onSelect={(e) => e.preventDefault()} onClick={() => onDensityChange('compact')}>
          <Checkbox checked={rowDensity === 'compact'} className="mr-2" />
          Compact
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={(e) => e.preventDefault()} onClick={() => onDensityChange('normal')}>
          <Checkbox checked={rowDensity === 'normal'} className="mr-2" />
          Normal
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={(e) => e.preventDefault()} onClick={() => onDensityChange('comfortable')}>
          <Checkbox checked={rowDensity === 'comfortable'} className="mr-2" />
          Comfortable
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <div className="flex flex-col gap-1.5 px-2 py-2">
          {onSave && (
            <Button
              size="sm"
              variant="default"
              className="w-full h-8 text-xs gap-1.5"
              onClick={handleSave}
            >
              <BookmarkCheck className="h-3.5 w-3.5" />
              {saved ? 'Saved!' : 'Save as Default'}
            </Button>
          )}
          <div className="flex gap-1.5">
            {onReset && (
              <Button
                size="sm"
                variant="ghost"
                className="flex-1 h-8 text-xs gap-1.5 text-gray-500"
                onClick={onReset}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="flex-1 h-8 text-xs"
              onClick={() => setOpen(false)}
            >
              Done
            </Button>
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Custom Hook to manage grid state with optional localStorage view persistence
export function useDataGrid<T>(initialColumns: GridColumn<T>[], viewId?: string) {
  const storageKey = viewId ? `techgenia-grid-${viewId}` : null;

  const loadSavedView = () => {
    if (!storageKey || typeof window === 'undefined') return null;
    try { return JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch { return null; }
  };

  const saveView = React.useCallback((cols: Set<string>, density: RowDensity) => {
    if (!storageKey || typeof window === 'undefined') return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ visibleColumns: Array.from(cols), rowDensity: density }));
    } catch {}
  }, [storageKey]);

  const [columns, setColumns] = React.useState(initialColumns);
  const [columnWidths, setColumnWidths] = React.useState<Record<string, number>>(() => {
    const widths: Record<string, number> = {};
    initialColumns.forEach((col) => { widths[col.id] = col.width || col.minWidth || 100; });
    return widths;
  });

  const allColumnIds = React.useMemo(() => new Set(initialColumns.map((col) => col.id)), []);

  const [visibleColumns, setVisibleColumns] = React.useState<Set<string>>(() => {
    const saved = loadSavedView();
    if (saved?.visibleColumns) {
      // Only keep IDs that exist in current columns (handles schema changes)
      return new Set((saved.visibleColumns as string[]).filter((id) => allColumnIds.has(id)));
    }
    return new Set(initialColumns.map((col) => col.id));
  });

  const [sortColumn, setSortColumn] = React.useState<string | null>(null);
  const [sortDirection, setSortDirection] = React.useState<SortDirection>(null);

  const [rowDensity, setRowDensityState] = React.useState<RowDensity>(() => {
    const saved = loadSavedView();
    return saved?.rowDensity || 'compact';
  });

  const [draggedColumn, setDraggedColumn] = React.useState<string | null>(null);

  const toggleColumnVisibility = (columnId: string) => {
    const newVisible = new Set(visibleColumns);
    if (newVisible.has(columnId)) { newVisible.delete(columnId); } else { newVisible.add(columnId); }
    setVisibleColumns(newVisible);
  };

  const setColumnVisible = (columnId: string, visible: boolean) => {
    setVisibleColumns(prev => {
      const next = new Set(prev);
      if (visible) next.add(columnId); else next.delete(columnId);
      return next;
    });
  };

  const setRowDensity = (density: RowDensity) => {
    setRowDensityState(density);
  };

  const saveCurrentView = React.useCallback(() => {
    saveView(visibleColumns, rowDensity);
  }, [saveView, visibleColumns, rowDensity]);

  const resetView = React.useCallback(() => {
    if (!storageKey || typeof window === 'undefined') return;
    try { localStorage.removeItem(storageKey); } catch {}
    setVisibleColumns(new Set(initialColumns.map((col) => col.id)));
    setRowDensityState('compact');
  }, [storageKey, initialColumns]);

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
    saveCurrentView,
    resetView,
    setColumnVisible,
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
    const startX = e.clientX;
    const startWidth = columnWidths[columnId];

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const diff = moveEvent.clientX - startX;
      const newWidth = Math.max((columns.find(c => c.id === columnId)?.minWidth || 100), startWidth + diff);
      setColumnWidths((prev) => ({ ...prev, [columnId]: newWidth }));
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const visibleColumnsArray = columns.filter((col: GridColumn<T>) => visibleColumns.has(col.id));

  // Sticky column offsets — S.No is always col 0 at left:0, width 48px
  const SNO_WIDTH = 48;
  const stickyOffsets: Record<string, number> = {};
  let stickyAcc = SNO_WIDTH;
  visibleColumnsArray.forEach((col) => {
    if (col.sticky) {
      stickyOffsets[col.id] = stickyAcc;
      stickyAcc += columnWidths[col.id] || col.width || 150;
    }
  });
  const hasStickyUserCols = visibleColumnsArray.some((c) => c.sticky);
  // The last sticky user column (or S.No if none) gets the right-shadow separator
  const lastStickyUserCol = [...visibleColumnsArray].reverse().find((c) => c.sticky);

  // Total table width so the table never squeezes columns below their specified widths
  const totalTableWidth = SNO_WIDTH + visibleColumnsArray.reduce(
    (sum, col) => sum + (columnWidths[col.id] || col.width || 150), 0
  );

  const densityClasses: Record<RowDensity, string> = {
    compact: 'py-2',
    normal: 'py-3',
    comfortable: 'py-4',
  };

  // Shadow style for the right edge of the frozen pane
  const frozenShadow = '2px 0 6px -2px rgba(0,0,0,0.14)';

  return (
    <div className={cn('relative', className)}>
      {/* Grid Table */}
      <div className="rounded-lg border bg-card overflow-auto scrollbar-hide">
        <table className="w-full border-collapse" style={{ minWidth: `${totalTableWidth}px` }}>
          {/* Header */}
          <thead className="bg-muted/50">
            <tr>
              {/* S.No — always first, always sticky (left + top) */}
              <th
                className="px-3 py-3 text-left text-sm font-semibold uppercase tracking-wide whitespace-nowrap"
                style={{
                  width: `${SNO_WIDTH}px`,
                  minWidth: `${SNO_WIDTH}px`,
                  overflow: 'hidden',
                  position: 'sticky',
                  left: 0,
                  top: 0,
                  zIndex: 21,
                  background: '#f1f5f9',
                  boxShadow: !hasStickyUserCols ? frozenShadow : undefined,
                }}
              >
                #
              </th>
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
                    minWidth: `${column.minWidth || columnWidths[column.id] || 100}px`,
                    overflow: 'hidden',
                    position: 'sticky',
                    top: 0,
                    zIndex: column.sticky ? 20 : 10,
                    background: '#f1f5f9',
                    ...(column.sticky ? {
                      width: `${columnWidths[column.id] || column.width || 150}px`,
                      maxWidth: `${columnWidths[column.id] || column.width || 150}px`,
                      left: `${stickyOffsets[column.id]}px`,
                      boxShadow: column === lastStickyUserCol ? frozenShadow : undefined,
                    } : {}),
                  }}
                  onClick={() => column.sortable && handleSort(column.id)}
                >
                  <div className="flex items-center gap-2">
                    {!column.sticky && (
                      <GripVertical className="h-4 w-4 text-muted-foreground/50 cursor-grab flex-shrink-0" />
                    )}
                    <span className="flex-1 whitespace-nowrap">{column.header}</span>
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
                  {!column.sticky && (
                    <div
                      className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/50 active:bg-primary"
                      onMouseDown={(e) => handleResizeStart(e, column.id)}
                    />
                  )}
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
                  'hover:bg-muted/30 transition-colors',
                  onRowClick && 'cursor-pointer'
                )}
                onClick={() => onRowClick?.(row)}
              >
                {/* S.No cell */}
                <td
                  className={cn('px-3 text-sm text-muted-foreground font-medium tabular-nums', densityClasses[rowDensity])}
                  style={{
                    width: `${SNO_WIDTH}px`,
                    minWidth: `${SNO_WIDTH}px`,
                    maxWidth: `${SNO_WIDTH}px`,
                    position: 'sticky',
                    left: 0,
                    zIndex: 3,
                    backgroundColor: '#ffffff',
                    boxShadow: !hasStickyUserCols ? frozenShadow : undefined,
                  }}
                >
                  {(currentPage - 1) * pageSize + rowIndex + 1}
                </td>
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
                      minWidth: `${column.minWidth || columnWidths[column.id] || 100}px`,
                      overflow: 'hidden',
                      backgroundColor: '#ffffff',
                      ...(column.sticky ? {
                        position: 'sticky',
                        width: `${columnWidths[column.id] || column.width || 150}px`,
                        maxWidth: `${columnWidths[column.id] || column.width || 150}px`,
                        left: `${stickyOffsets[column.id]}px`,
                        zIndex: 3,
                        boxShadow: column === lastStickyUserCol ? frozenShadow : undefined,
                      } : {}),
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
