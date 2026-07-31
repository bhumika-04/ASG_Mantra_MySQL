'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useFilter } from '@/contexts/FilterContext';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { StatsCard, StatsGrid } from '@/components/ui/stats-card';
import { FilterBar } from '@/components/ui/filter-bar';
import { DataGrid, GridColumn, useDataGrid, ViewOptionsButton } from '@/components/ui/data-grid';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SnapshotDatePicker } from '@/components/ui/snapshot-date-picker';
import { exportToCSV } from '@/lib/export';
import { Package, Warehouse, Store, Building2, Download, X } from 'lucide-react';
import api from '@/lib/api';
import { fmtDate, toTitleCase } from '@/lib/format';

interface BlinkitInventoryItem {
  id: number;
  itemId: string;
  itemName: string;
  backendFacilityName: string;
  backendInvQty: number;
  frontendInvQty: number;
  reportDate: string;
}

const PAGE_SIZE = 50;

export default function BlinkitInventoryPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [items, setItems] = useState<BlinkitInventoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const { globalSearch } = useFilter();
  const [gridSearch, setGridSearch] = useState('');
  const [reportDate, setReportDate] = useState('');
  const [facility, setFacility] = useState('all');
  const [state, setState] = useState('all');
  const [reportDates, setReportDates] = useState<string[]>([]);
  const [facilities, setFacilities] = useState<string[]>([]);
  const [states, setStates] = useState<string[]>([]);
  const fetchSeqRef = useRef(0);
  const [stats, setStats] = useState({
    totalBackendQty: 0,
    totalFrontendQty: 0,
    totalQty: 0,
    uniqueFacilities: 0,
  });

  const fetchData = useCallback(async () => {
    const seq = ++fetchSeqRef.current;
    try {
      setIsLoading(true);
      const params: Record<string, any> = { page, page_size: PAGE_SIZE };
      if (globalSearch) params.search = globalSearch;
      if (reportDate) params.report_date = reportDate;
      if (state && state !== 'all') params.state = state;
      if (facility && facility !== 'all') params.facility = facility;
      const res: any = await api.blinkitInventory.getAll(params);
      if (fetchSeqRef.current !== seq) return;
      setItems(res.items || []);
      setTotal(res.total || 0);
      setStats(res.stats || { totalBackendQty: 0, totalFrontendQty: 0, totalQty: 0, uniqueFacilities: 0 });
      if (res.filters?.report_dates?.length) {
        setReportDates(res.filters.report_dates);
        if (!reportDate) setReportDate(res.filters.report_dates[0]);
      }
      if (res.filters?.facilities) {
        setFacilities(res.filters.facilities);
      }
      if (res.filters?.states?.length) {
        setStates(res.filters.states);
      }
    } catch (err) {
      if (fetchSeqRef.current !== seq) return;
      console.error('Error fetching Blinkit inventory:', err);
    } finally {
      if (fetchSeqRef.current === seq) setIsLoading(false);
    }
  }, [page, globalSearch, reportDate, state, facility]);

  useEffect(() => { setPage(1); }, [globalSearch]);
  useEffect(() => { fetchData(); }, [fetchData]);

  const columns: GridColumn<BlinkitInventoryItem>[] = [
    {
      id: 'itemName',
      header: 'Product',
      accessorKey: 'itemName',
      sortable: true,
      width: 280,
      minWidth: 180,
      wrap: true,
      cell: (row) => (
        <span
          className="text-sm font-medium leading-snug"
          style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
          title={row.itemName}
        >
          {toTitleCase(row.itemName) || '—'}
        </span>
      ),
    },
    {
      id: 'itemId',
      header: 'Item ID',
      accessorKey: 'itemId',
      sortable: true,
      sticky: true,
      width: 130,
      minWidth: 100,
      cell: (row) => (
        <code className="text-xs bg-yellow-50 text-yellow-700 px-2 py-1 rounded border border-yellow-200">
          {row.itemId || '—'}
        </code>
      ),
    },
    {
      id: 'backendFacilityName',
      header: 'Facility (Hub)',
      accessorKey: 'backendFacilityName',
      sortable: true,
      width: 200,
      minWidth: 150,
      cell: (row) => (
        <span className="text-sm text-muted-foreground">{row.backendFacilityName || '—'}</span>
      ),
    },
    {
      id: 'backendInvQty',
      header: 'Backend Qty (Hub)',
      accessorKey: 'backendInvQty',
      sortable: true,
      width: 150,
      minWidth: 110,
      align: 'right',
      cell: (row) => (
        <span className={`font-semibold ${(row.backendInvQty || 0) === 0 ? 'text-red-500' : 'text-blue-700'}`}>
          {(row.backendInvQty || 0).toLocaleString('en-IN')}
        </span>
      ),
    },
    {
      id: 'frontendInvQty',
      header: 'Frontend Qty (Store)',
      accessorKey: 'frontendInvQty',
      sortable: true,
      width: 160,
      minWidth: 120,
      align: 'right',
      cell: (row) => (
        <span className={`font-semibold ${(row.frontendInvQty || 0) === 0 ? 'text-red-500' : 'text-yellow-700'}`}>
          {(row.frontendInvQty || 0).toLocaleString('en-IN')}
        </span>
      ),
    },
    {
      id: 'totalQty',
      header: 'Total',
      accessorKey: 'backendInvQty',
      sortable: false,
      width: 110,
      minWidth: 80,
      align: 'right',
      cell: (row) => (
        <span className="font-bold">
          {((row.backendInvQty || 0) + (row.frontendInvQty || 0)).toLocaleString('en-IN')}
        </span>
      ),
    },
  ];

  const gridState = useDataGrid(columns, 'blinkit-inventory');

  const displayItems = gridSearch.trim()
    ? items.filter(i => {
        const q = gridSearch.toLowerCase();
        return (i.itemName || '').toLowerCase().includes(q) ||
               (i.itemId || '').toLowerCase().includes(q) ||
               (i.backendFacilityName || '').toLowerCase().includes(q);
      })
    : items;

  const hasFilters = gridSearch || (state && state !== 'all') || (facility && facility !== 'all');

  return (
    <ProtectedRoute>
      <div className="p-4 sm:p-6 space-y-6">
        {/* KPI Cards */}
        <StatsGrid columns={4}>
          <StatsCard
            title="Total Stock"
            value={stats.totalQty.toLocaleString('en-IN')}
            icon={Package}
            description="Backend + Frontend units"
            variant="blue"
          />
          <StatsCard
            title="Backend (Hub)"
            value={stats.totalBackendQty.toLocaleString('en-IN')}
            icon={Warehouse}
            description="Hub warehouse stock"
            variant="purple"
          />
          <StatsCard
            title="Frontend (Store)"
            value={stats.totalFrontendQty.toLocaleString('en-IN')}
            icon={Store}
            description="Dark store stock"
            variant="yellow"
          />
          <StatsCard
            title="Facilities"
            value={stats.uniqueFacilities.toLocaleString('en-IN')}
            icon={Building2}
            description="Active Blinkit hubs"
            variant="green"
          />
        </StatsGrid>

        {/* Report Date Picker */}
        {reportDates.length > 0 && (
          <SnapshotDatePicker
            availableDates={reportDates}
            selectedDate={reportDate || reportDates[0] || ''}
            onSelect={(d) => { setReportDate(d); setPage(1); }}
            onReset={() => { setReportDate(reportDates[0] || ''); setPage(1); }}
            label="Report Date:"
            className="px-1"
          />
        )}

        {/* Search + toolbar */}
        <FilterBar
          searchPlaceholder="Search product name or facility..."
          searchValue={gridSearch}
          onSearchChange={setGridSearch}
        >
          <div className="flex items-center gap-2 ml-auto">
            {/* State filter */}
            {states.length > 0 && (
              <Select value={state} onValueChange={(v) => { setState(v); setFacility('all'); setPage(1); }}>
                <SelectTrigger className="w-[150px] h-9 text-sm">
                  <SelectValue placeholder="All States" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All States</SelectItem>
                  {states.map(s => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {/* Facility filter — shows only facilities in selected state when state filter active */}
            {facilities.length > 0 && (
              <Select value={facility} onValueChange={(v) => { setFacility(v); setPage(1); }}>
                <SelectTrigger className="w-[180px] h-9 text-sm">
                  <SelectValue placeholder="All Facilities" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Facilities</SelectItem>
                  {facilities.map(f => (
                    <SelectItem key={f} value={f}>{f}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={() => { setGridSearch(''); setState('all'); setFacility('all'); setPage(1); }}>
                <X className="h-4 w-4 mr-1" /> Clear
              </Button>
            )}
            <ViewOptionsButton
              columns={columns}
              visibleColumns={gridState.visibleColumns}
              onToggleColumn={gridState.toggleColumnVisibility}
              rowDensity={gridState.rowDensity}
              onDensityChange={gridState.setRowDensity}
              onSave={gridState.saveCurrentView}
              onReset={gridState.resetView}
            />
            {displayItems.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                onClick={() => exportToCSV(
                  displayItems.map(item => ({
                    'Item ID': item.itemId,
                    'Product': item.itemName,
                    'Facility': item.backendFacilityName,
                    'Backend Qty (Hub)': item.backendInvQty,
                    'Frontend Qty (Store)': item.frontendInvQty,
                    'Total': (item.backendInvQty || 0) + (item.frontendInvQty || 0),
                    'Report Date': item.reportDate,
                  })),
                  `blinkit_inventory_${reportDate || 'latest'}`
                )}
              >
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            )}
          </div>
        </FilterBar>

        {/* Grid */}
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Showing {displayItems.length} of {total.toLocaleString('en-IN')} rows
            {reportDate && ` · Report date: ${fmtDate(reportDate)}`}
          </p>

          {isLoading ? (
            <div className="flex justify-center py-16">
              <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-yellow-500" />
            </div>
          ) : displayItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 border-2 border-dashed rounded-xl">
              <Package className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-semibold mb-2">No inventory data found</h3>
              <p className="text-sm text-muted-foreground">
                {(globalSearch || gridSearch) ? 'Try adjusting your search' : 'Upload a Blinkit Inventory CSV to get started'}
              </p>
            </div>
          ) : (
            <DataGrid
              data={displayItems}
              gridState={gridState}
              serverPagination={gridSearch.trim() ? undefined : { total, page, pageSize: PAGE_SIZE, onPageChange: setPage }}
            />
          )}

        </div>
      </div>
    </ProtectedRoute>
  );
}
