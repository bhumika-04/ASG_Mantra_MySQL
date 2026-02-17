'use client';

import { useState, useEffect } from 'react';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { StatsCard, StatsGrid } from '@/components/ui/stats-card';
import { FilterBar } from '@/components/ui/filter-bar';
import { DataGrid, GridColumn, useDataGrid, ViewOptionsButton } from '@/components/ui/data-grid';
import { Button } from '@/components/ui/button';
import {
  Package,
  Warehouse,
  Store,
  Boxes,
  Download,
  CalendarDays,
} from 'lucide-react';
import api from '@/lib/api';
import { exportToCSV } from '@/lib/export';

interface BlinkitInventoryItem {
  id: number;
  reportDate: string;
  backendFacilityName: string | null;
  backendFacilityId: number | null;
  itemId: number;
  itemName: string | null;
  backendInvQty: number | null;
  frontendInvQty: number | null;
  createdAt: string | null;
}

interface FiltersData {
  facilities: string[];
  report_dates: string[];
}

export default function BlinkitInventoryPage() {
  const [search, setSearch] = useState('');
  const [facilityFilter, setFacilityFilter] = useState('all');
  const [reportDate, setReportDate] = useState('');
  const [items, setItems] = useState<BlinkitInventoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filtersData, setFiltersData] = useState<FiltersData>({ facilities: [], report_dates: [] });
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [inventoryStats, setInventoryStats] = useState({ totalBackendQty: 0, totalFrontendQty: 0, totalQty: 0, uniqueFacilities: 0 });

  // Fetch data from API
  useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);

        const params: any = {
          page: String(page),
          page_size: '50',
        };
        if (search) params.search = search;
        if (facilityFilter !== 'all') params.facility = facilityFilter;
        if (reportDate) params.report_date = reportDate;

        const response = await api.blinkitInventory.getAll(params) as any;

        setItems(response.items || []);
        setTotal(response.total || 0);
        setTotalPages(response.total_pages || 1);

        if (response.stats) {
          setInventoryStats(response.stats);
        }
        if (response.filters) {
          setFiltersData(response.filters);
        }
      } catch (error) {
        console.error('Error fetching Blinkit inventory:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [page, search, facilityFilter, reportDate]);

  // Stats come from the full filtered dataset via API, not just current page
  const { totalBackendQty, totalFrontendQty, totalQty, uniqueFacilities } = inventoryStats;

  // Define grid columns
  const gridColumns: GridColumn<BlinkitInventoryItem>[] = [
    {
      id: 'rowNumber',
      header: '#',
      width: 60,
      minWidth: 50,
      align: 'center',
      cell: (row) => {
        const idx = items.indexOf(row);
        return <span className="text-muted-foreground font-medium">{(page - 1) * 50 + idx + 1}</span>;
      },
    },
    {
      id: 'itemName',
      header: 'Item Name',
      accessorKey: 'itemName',
      sortable: true,
      width: 360,
      minWidth: 200,
      cell: (row) => (
        <span
          className="font-medium text-sm leading-snug"
          style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
          title={row.itemName}
        >
          {row.itemName || '—'}
        </span>
      ),
    },
    {
      id: 'itemId',
      header: 'Item ID',
      accessorKey: 'itemId',
      sortable: true,
      width: 120,
      minWidth: 90,
      cell: (row) => (
        <code className="text-xs bg-yellow-50 text-yellow-700 px-1.5 py-0.5 rounded border border-yellow-200">
          {row.itemId}
        </code>
      ),
    },
    {
      id: 'backendFacilityName',
      header: 'Facility (Backend Warehouse)',
      accessorKey: 'backendFacilityName',
      sortable: true,
      width: 220,
      minWidth: 150,
      cell: (row) => (
        <span className="text-sm">
          {row.backendFacilityName || '—'}
          {row.backendFacilityId && (
            <span className="text-muted-foreground ml-1 text-xs">({row.backendFacilityId})</span>
          )}
        </span>
      ),
    },
    {
      id: 'backendInvQty',
      header: (
        <div className="flex items-center justify-center gap-1">
          <span>Backend Qty</span>
          <div className="h-1.5 w-1.5 rounded-full bg-blue-500"></div>
        </div>
      ),
      accessorKey: 'backendInvQty',
      sortable: true,
      width: 130,
      minWidth: 100,
      align: 'center',
      cell: (row) => (
        <div className="flex items-center justify-center gap-1">
          <div className="h-1.5 w-1.5 rounded-full bg-blue-500"></div>
          <span className={row.backendInvQty ? 'text-blue-600 font-semibold text-xs' : 'text-muted-foreground text-xs'}>
            {(row.backendInvQty || 0).toLocaleString()}
          </span>
        </div>
      ),
    },
    {
      id: 'frontendInvQty',
      header: (
        <div className="flex items-center justify-center gap-1">
          <span>Frontend Qty</span>
          <div className="h-1.5 w-1.5 rounded-full bg-yellow-400"></div>
        </div>
      ),
      accessorKey: 'frontendInvQty',
      sortable: true,
      width: 130,
      minWidth: 100,
      align: 'center',
      cell: (row) => (
        <div className="flex items-center justify-center gap-1">
          <div className="h-1.5 w-1.5 rounded-full bg-yellow-400"></div>
          <span className={row.frontendInvQty ? 'text-yellow-600 font-semibold text-xs' : 'text-muted-foreground text-xs'}>
            {(row.frontendInvQty || 0).toLocaleString()}
          </span>
        </div>
      ),
    },
    {
      id: 'totalQty',
      header: 'Total Qty',
      sortable: true,
      width: 120,
      minWidth: 100,
      align: 'center',
      cell: (row) => {
        const total = (row.backendInvQty || 0) + (row.frontendInvQty || 0);
        return (
          <span className="bg-emerald-50 text-emerald-700 px-2 py-1 rounded font-semibold text-xs border border-emerald-200">
            {total.toLocaleString()}
          </span>
        );
      },
    },
    {
      id: 'reportDate',
      header: 'Report Date',
      accessorKey: 'reportDate',
      sortable: true,
      width: 120,
      minWidth: 100,
      align: 'center',
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          {row.reportDate || '—'}
        </span>
      ),
    },
  ];

  // Initialize grid state
  const gridState = useDataGrid(gridColumns);

  // Build facility filter options
  const facilityOptions = [
    { label: 'All Facilities', value: 'all' },
    ...filtersData.facilities.map(f => ({ label: f, value: f })),
  ];

  const filterConfigs = [
    {
      key: 'facility',
      label: 'Facility',
      options: facilityOptions,
    },
  ];

  if (isLoading) {
    return (
      <ProtectedRoute>
        <div className="p-6 flex items-center justify-center">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-yellow-500 mb-4"></div>
            <p className="text-muted-foreground">Loading Blinkit inventory...</p>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Blinkit Inventory (Facility-Level)</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Per-facility inventory from Blinkit — Backend warehouse + Frontend (dark store) quantities
            </p>
          </div>
          {/* Report date selector */}
          {filtersData.report_dates.length > 0 && (
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              <select
                value={reportDate}
                onChange={(e) => { setReportDate(e.target.value); setPage(1); }}
                className="border rounded-md px-3 py-1.5 text-sm bg-background"
              >
                <option value="">Latest Report</option>
                {filtersData.report_dates.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* KPI Cards */}
        <StatsGrid columns={4}>
          <StatsCard
            title="Facilities"
            value={uniqueFacilities}
            icon={Warehouse}
            description="Unique facilities"
            variant="purple"
          />
          <StatsCard
            title="Backend Qty"
            value={totalBackendQty.toLocaleString()}
            icon={Boxes}
            description="Warehouse stock"
            variant="blue"
          />
          <StatsCard
            title="Frontend Qty"
            value={totalFrontendQty.toLocaleString()}
            icon={Store}
            description="Dark store stock"
            variant="yellow"
          />
          <StatsCard
            title="Total Qty"
            value={totalQty.toLocaleString()}
            icon={Package}
            description="Backend + Frontend"
            variant="green"
          />
        </StatsGrid>

        {/* Filters */}
        <FilterBar
          searchPlaceholder="Search by item name..."
          searchValue={search}
          onSearchChange={(val) => { setSearch(val); setPage(1); }}
          filters={filterConfigs}
          filterValues={{ facility: facilityFilter }}
          onFilterChange={(key, value) => {
            if (key === 'facility') { setFacilityFilter(value); setPage(1); }
          }}
          onClearFilters={() => {
            setSearch('');
            setFacilityFilter('all');
            setReportDate('');
            setPage(1);
          }}
        >
          <div className="flex items-center gap-2 ml-auto">
            <ViewOptionsButton
              columns={gridColumns}
              visibleColumns={gridState.visibleColumns}
              onToggleColumn={gridState.toggleColumnVisibility}
              rowDensity={gridState.rowDensity}
              onDensityChange={gridState.setRowDensity}
            />
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              onClick={() => exportToCSV(
                items.map(item => ({
                  'Item Name': item.itemName ?? '',
                  'Item ID': item.itemId,
                  'Facility': item.backendFacilityName ?? '',
                  'Facility ID': item.backendFacilityId ?? '',
                  'Backend Qty': item.backendInvQty ?? 0,
                  'Frontend Qty': item.frontendInvQty ?? 0,
                  'Total Qty': (item.backendInvQty ?? 0) + (item.frontendInvQty ?? 0),
                  'Report Date': item.reportDate ?? '',
                })),
                'blinkit_inventory'
              )}
            >
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
          </div>
        </FilterBar>

        {/* Data Grid */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Showing {items.length} of {total} rows
              {search && ` matching "${search}"`}
              {facilityFilter !== 'all' && ` in ${facilityFilter}`}
            </p>
          </div>

          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-4 border-2 border-dashed rounded-xl">
              <Store className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Blinkit inventory data found</h3>
              <p className="text-sm text-muted-foreground text-center max-w-md">
                {search || facilityFilter !== 'all'
                  ? 'Try adjusting your search or filter criteria'
                  : 'Upload a Blinkit Inventory Report CSV from the Blinkit Upload page'}
              </p>
            </div>
          ) : (
            <DataGrid data={items} gridState={gridState} />
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </ProtectedRoute>
  );
}
