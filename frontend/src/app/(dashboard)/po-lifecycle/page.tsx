'use client';

import { useState, useEffect } from 'react';
import { useFilter, computeDateRange, FilterMode } from '@/contexts/FilterContext';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { StatsCard, StatsGrid } from '@/components/ui/stats-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DataGrid, GridColumn, useDataGrid, ViewOptionsButton } from '@/components/ui/data-grid';
import { FilterBar } from '@/components/ui/filter-bar';
import { FilterPanel, FilterValues, DEFAULT_FILTER_VALUES } from '@/components/ui/filter-panel';
import { exportToCSV } from '@/lib/export';
import { fmtDate } from '@/lib/format';
import {
  Package,
  FileText,
  Truck,
  AlertTriangle,
  FileCheck,
  Send,
  CheckCircle2,
  XCircle,
  Download,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';

interface PurchaseOrder {
  id: number;
  po_id: number;
  po_number: string;
  channel: string;
  quantity: number;
  dispatchDate: string;
  expectedDate: string;
  expectedDateRaw: string | null;
  orderDateRaw: string | null;
  state: string;
  city: string;
  hub: string;
  courier: string;
  tat: string;
  status: string;
}

const PAGE_SIZE = 50;

const toRow = (po: any, channel: string): PurchaseOrder => ({
  id: po.po_id,
  po_id: po.po_id,
  po_number: po.po_number,
  channel,
  quantity: po.total_qty || 0,
  dispatchDate: po.order_date ? fmtDate(po.order_date) : '-',
  expectedDate: po.expected_delivery_date ? fmtDate(po.expected_delivery_date) : '-',
  expectedDateRaw: po.expected_delivery_date || null,
  orderDateRaw: po.order_date ? po.order_date.slice(0, 10) : null,
  state: po.ship_to_state || '-',
  city: po.ship_to_city || '-',
  hub: po.ship_to_location_code || po.ship_to_name || '-',
  courier: '-',
  tat: po.tat != null ? `${po.tat}d` : '-',
  status: po.status || 'Created',
});

export default function POLifecyclePage() {
  const router = useRouter();
  const { filterMode, customStart, customEnd } = useFilter();
  const [filters, setFilters] = useState<FilterValues>(DEFAULT_FILTER_VALUES);
  const [poSearch, setPoSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [allOrders, setAllOrders] = useState<PurchaseOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isGridLoading, setIsGridLoading] = useState(false);
  const [totalAmazon, setTotalAmazon] = useState(0);
  const [totalBlinkit, setTotalBlinkit] = useState(0);
  const [stats, setStats] = useState({
    amazon: { status_counts: {} as Record<string, number>, total_pos: 0, total_units: 0 },
    blinkit: { status_counts: {} as Record<string, number>, total_pos: 0, total_units: 0 },
  });

  // Debounce search: reset to page 1 when search changes
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(poSearch);
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [poSearch]);

  // Fetch date-filtered KPI stats — re-runs when global filter changes
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const dateParams = filterMode === 'all' ? {} : (() => {
          const { start_date, end_date } = computeDateRange(filterMode as FilterMode, customStart, customEnd);
          return { ...(start_date ? { start_date } : {}), ...(end_date ? { end_date } : {}) };
        })();
        const params = Object.keys(dateParams).length ? dateParams : undefined;
        const [amazonStats, blinkitStats] = await Promise.all([
          (api.purchaseOrders as any).getAmazonStats(params) as any,
          (api.purchaseOrders as any).getBlinkitStats(params) as any,
        ]);
        setStats({ amazon: amazonStats, blinkit: blinkitStats });
      } catch (error) {
        console.error('Error fetching PO stats:', error);
      }
    };
    fetchStats();
  }, [filterMode, customStart, customEnd]);

  // Fetch paginated grid data (server-side search, status, date, channel filters)
  useEffect(() => {
    const fetchGrid = async () => {
      try {
        if (page === 1) setIsLoading(true);
        else setIsGridLoading(true);

        const dateParams = filterMode === 'all' ? {} : (() => {
          const { start_date, end_date } = computeDateRange(filterMode as FilterMode, customStart, customEnd);
          return { ...(start_date ? { start_date } : {}), ...(end_date ? { end_date } : {}) };
        })();

        const params: any = { page, page_size: PAGE_SIZE, ...dateParams };
        if (debouncedSearch) params.search = debouncedSearch;
        if (filters.status !== 'all') params.status = filters.status;

        const showAmazon = filters.channel === 'all' || filters.channel === 'amazon';
        const showBlinkit = filters.channel === 'all' || filters.channel === 'blinkit';

        const [amazonRes, blinkitRes] = await Promise.all([
          showAmazon
            ? (api.purchaseOrders as any).getAmazonOverview(params) as any
            : Promise.resolve({ items: [], total: 0, total_pages: 1 }),
          showBlinkit
            ? (api.purchaseOrders as any).getBlinkitOverview(params) as any
            : Promise.resolve({ items: [], total: 0, total_pages: 1 }),
        ]);

        setTotalAmazon(showAmazon ? (amazonRes.total || 0) : 0);
        setTotalBlinkit(showBlinkit ? (blinkitRes.total || 0) : 0);

        const rows: PurchaseOrder[] = [
          ...(amazonRes.items || []).map((po: any) => toRow(po, 'Amazon')),
          ...(blinkitRes.items || []).map((po: any) => toRow(po, 'Blinkit')),
        ];
        rows.sort((a, b) => (b.orderDateRaw || '').localeCompare(a.orderDateRaw || ''));
        setAllOrders(rows);
      } catch (error) {
        console.error('Error fetching purchase orders:', error);
      } finally {
        setIsLoading(false);
        setIsGridLoading(false);
      }
    };

    fetchGrid();
  }, [page, debouncedSearch, filters.channel, filters.status, filterMode, customStart, customEnd]);

  // Derived stats from stats endpoints (all-time totals, not affected by grid filters)
  const sc_a = stats.amazon.status_counts || {};
  const sc_b = stats.blinkit.status_counts || {};
  const merged: Record<string, number> = {};
  [...new Set([...Object.keys(sc_a), ...Object.keys(sc_b)])].forEach(s => {
    merged[s] = (sc_a[s] || 0) + (sc_b[s] || 0);
  });

  const totalPOs = (stats.amazon.total_pos || 0) + (stats.blinkit.total_pos || 0);
  const totalUnits = (stats.amazon.total_units || 0) + (stats.blinkit.total_units || 0);
  const inTransitPOs = merged['In Transit'] || 0;
  const deliveredCount = merged['Delivered'] || 0;
  const delayedCount = merged['Delayed'] || 0;
  const linkedPOs = totalPOs - (merged['Created'] || 0);

  const createdCount = merged['Created'] || 0;
  const dispatchedCount = merged['Dispatched'] || 0;
  const inTransitCount = merged['In Transit'] || 0;
  const diffLossCount = merged['Diff Loss'] || 0;

  const maxCount = Math.max(createdCount, dispatchedCount, inTransitCount, deliveredCount, delayedCount, diffLossCount, 1);

  // Hub chart from current page data
  const hubMap = allOrders.reduce((acc, order) => {
    if (order.hub && order.hub !== '-') acc[order.hub] = (acc[order.hub] || 0) + order.quantity;
    return acc;
  }, {} as Record<string, number>);
  const hubData = Object.entries(hubMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  const maxHub = hubData.length > 0 ? Math.max(...hubData.map(h => h.value)) : 1;

  // Pagination
  const totalPages = Math.max(
    Math.ceil(totalAmazon / PAGE_SIZE),
    Math.ceil(totalBlinkit / PAGE_SIZE),
    1
  );
  const totalShown = totalAmazon + totalBlinkit;

  const poStatusOptions = [
    { label: 'All', value: 'all' },
    { label: 'Created', value: 'Created' },
    { label: 'Dispatched', value: 'Dispatched' },
    { label: 'In Transit', value: 'In Transit' },
    { label: 'Delivered', value: 'Delivered' },
    { label: 'Delayed', value: 'Delayed' },
    { label: 'Diff Loss', value: 'Diff Loss' },
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Delivered':  return 'bg-green-100 text-green-700 border-green-200';
      case 'In Transit': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'Dispatched': return 'bg-yellow-100 text-yellow-700 border-yellow-200';
      case 'Created':    return 'bg-gray-100 text-gray-700 border-gray-200';
      case 'Delayed':    return 'bg-red-100 text-red-700 border-red-200';
      default:           return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const gridColumns: GridColumn<PurchaseOrder>[] = [
    {
      id: 'poNumber',
      header: 'PO Number',
      accessorKey: 'po_number',
      sortable: true,
      sticky: true,
      width: 190,
      minWidth: 160,
      cell: (row) => <span className="font-medium text-primary">{row.po_number}</span>,
    },
    {
      id: 'channel',
      header: 'Channel',
      accessorKey: 'channel',
      width: 120,
      minWidth: 100,
      cell: (row) => (
        <span className={row.channel === 'Amazon' ? 'text-blue-600 font-medium' : 'text-yellow-600 font-medium'}>
          {row.channel}
        </span>
      ),
    },
    {
      id: 'quantity',
      header: 'Quantity',
      accessorKey: 'quantity',
      sortable: true,
      width: 120,
      minWidth: 100,
      align: 'right',
      cell: (row) => <span className="font-semibold">{row.quantity.toLocaleString('en-IN')}</span>,
    },
    {
      id: 'dispatchDate',
      header: 'PO Creation Date',
      accessorKey: 'dispatchDate',
      sortable: true,
      width: 140,
      minWidth: 120,
      cell: (row) => <span className="text-muted-foreground">{row.dispatchDate}</span>,
    },
    {
      id: 'expectedDate',
      header: 'Expected Date',
      accessorKey: 'expectedDate',
      sortable: true,
      width: 140,
      minWidth: 120,
      cell: (row) => <span className="text-muted-foreground">{row.expectedDate}</span>,
    },
    {
      id: 'state',
      header: 'State',
      accessorKey: 'state',
      sortable: true,
      width: 120,
      minWidth: 100,
      cell: (row) => <span className="text-muted-foreground">{row.state}</span>,
    },
    {
      id: 'city',
      header: 'City',
      accessorKey: 'city',
      sortable: true,
      width: 130,
      minWidth: 110,
      cell: (row) => <span className="text-muted-foreground">{row.city}</span>,
    },
    {
      id: 'hub',
      header: 'Hub / Location',
      accessorKey: 'hub',
      width: 130,
      minWidth: 110,
      cell: (row) => <span className="text-muted-foreground">{row.hub}</span>,
    },
    {
      id: 'courier',
      header: 'Courier',
      accessorKey: 'courier',
      width: 140,
      minWidth: 120,
      cell: (row) => <span className="text-muted-foreground">{row.courier}</span>,
    },
    {
      id: 'tat',
      header: 'TAT',
      accessorKey: 'tat',
      width: 100,
      minWidth: 80,
      align: 'center',
      cell: (row) => <span className="text-muted-foreground">{row.tat}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      accessorKey: 'status',
      width: 150,
      minWidth: 130,
      align: 'center',
      cell: (row) => (
        <Badge variant="outline" className={getStatusColor(row.status)}>
          {row.status}
        </Badge>
      ),
    },
  ];

  const gridState = useDataGrid(gridColumns, 'po-lifecycle');

  if (isLoading) {
    return (
      <ProtectedRoute>
        <div className="p-6 flex items-center justify-center">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
            <p className="text-muted-foreground">Loading purchase order lifecycle...</p>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="p-6 space-y-6">
        {/* Status Cards — all-time totals from stats endpoints */}
        <StatsGrid columns={5}>
          <StatsCard
            title="Total POs"
            value={totalPOs.toString()}
            icon={Package}
            description={`${totalUnits.toLocaleString('en-IN')} units`}
            variant="blue"
          />
          <StatsCard
            title="Linked POs"
            value={linkedPOs.toString()}
            icon={FileText}
            description="Awaiting dispatch"
            variant="purple"
          />
          <StatsCard
            title="In Transit"
            value={inTransitPOs.toString()}
            icon={Truck}
            description="On the way"
            variant="yellow"
          />
          <StatsCard
            title="Delivered"
            value={deliveredCount.toString()}
            icon={CheckCircle2}
            description="Successfully delivered"
            variant="green"
          />
          <StatsCard
            title="Delayed"
            value={delayedCount.toString()}
            icon={XCircle}
            description="Beyond expected date"
            variant="red"
          />
        </StatsGrid>

        {/* Delay Alert Banner */}
        {delayedCount > 0 && (
          <Card className="bg-amber-50 border-amber-200">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
                <div>
                  <p className="font-semibold text-amber-900">{delayedCount} PO{delayedCount > 1 ? 's' : ''} marked as Delayed</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* PO Status Distribution Chart */}
          <Card>
            <CardHeader>
              <CardTitle>PO Status Distribution</CardTitle>
              <p className="text-sm text-muted-foreground">Number of POs by status</p>
            </CardHeader>
            <CardContent>
              <div className="h-80 relative">
                <div className="absolute left-0 top-0 h-full flex flex-col justify-between text-xs text-muted-foreground pr-2">
                  <span>{maxCount}</span>
                  <span>{Math.round(maxCount * 0.75)}</span>
                  <span>{Math.round(maxCount * 0.5)}</span>
                  <span>{Math.round(maxCount * 0.25)}</span>
                  <span>0</span>
                </div>
                <div className="ml-10 h-full flex items-end justify-between gap-4">
                  {[
                    { label: 'Created', count: createdCount, cls: 'bg-chart-1' },
                    { label: 'Dispatched', count: dispatchedCount, cls: 'bg-chart-2' },
                    { label: 'In Transit', count: inTransitCount, cls: 'bg-chart-3' },
                    { label: 'Delivered', count: deliveredCount, cls: 'bg-chart-4' },
                    { label: 'Delayed', count: delayedCount, cls: 'bg-red-400' },
                    { label: 'Diff Loss', count: diffLossCount, cls: 'bg-orange-400' },
                  ].map(({ label, count, cls }) => (
                    <div key={label} className="flex-1 flex flex-col items-center gap-2">
                      <div className={`w-full ${cls} rounded-t`} style={{ height: `${(count / maxCount) * 240}px` }} />
                      <span className="text-xs text-muted-foreground">{label}</span>
                      <span className="text-xs font-semibold">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Quantity by Hub Chart — from current page */}
          <Card>
            <CardHeader>
              <CardTitle>Quantity by Hub</CardTitle>
              <p className="text-sm text-muted-foreground">Units by hub (current page)</p>
            </CardHeader>
            <CardContent>
              <div className="max-h-[350px] overflow-y-auto scrollbar-hide space-y-3 py-2">
                {hubData.length > 0 ? (
                  hubData.map((hub, index) => (
                    <div key={hub.name} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{hub.name}</span>
                        <span className="font-semibold">{hub.value.toLocaleString('en-IN')}</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-4">
                        <div
                          className={`h-4 rounded-full transition-all ${index % 5 === 0 ? 'bg-chart-1' : index % 5 === 1 ? 'bg-chart-2' : index % 5 === 2 ? 'bg-chart-3' : index % 5 === 3 ? 'bg-chart-4' : 'bg-chart-5'}`}
                          style={{ width: `${(hub.value / maxHub) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">No data available</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Lifecycle Flow Timeline */}
        <Card>
          <CardHeader>
            <CardTitle>Lifecycle Flow</CardTitle>
            <p className="text-sm text-muted-foreground">PO count at each lifecycle stage (all-time)</p>
          </CardHeader>
          <CardContent>
            <div className="relative">
              <div className="absolute top-8 left-8 right-8 h-1 bg-gradient-to-r from-chart-1 via-chart-2 via-chart-3 via-chart-4 to-chart-5 hidden md:block" />
              <div className="grid grid-cols-2 md:grid-cols-5 gap-6 md:gap-4 relative">
                {[
                  { label: 'Created', count: createdCount, bg: 'bg-chart-1', Icon: FileCheck },
                  { label: 'Dispatched', count: dispatchedCount, bg: 'bg-chart-2', Icon: Send },
                  { label: 'In Transit', count: inTransitCount, bg: 'bg-chart-3', Icon: Truck },
                  { label: 'Delivered', count: deliveredCount, bg: 'bg-chart-4', Icon: CheckCircle2 },
                  { label: 'Diff Loss', count: diffLossCount, bg: 'bg-chart-5', Icon: XCircle },
                ].map(({ label, count, bg, Icon }) => (
                  <div key={label} className="flex flex-col items-center gap-3">
                    <div className={`w-16 h-16 rounded-full ${bg} flex items-center justify-center shadow-lg relative z-10`}>
                      <Icon className="h-7 w-7 text-white" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium text-muted-foreground">{label}</p>
                      <p className="text-2xl font-bold">{count}</p>
                      <p className="text-xs text-muted-foreground">POs</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* All Purchase Orders Grid */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle>All Purchase Orders</CardTitle>
              <p className="text-sm text-muted-foreground">{totalShown.toLocaleString('en-IN')} total</p>
            </div>
          </CardHeader>
          <CardContent>
            <FilterBar
              searchPlaceholder="Search by PO number... (searches all records)"
              searchValue={poSearch}
              onSearchChange={(v) => { setPoSearch(v); }}
              className="mb-4"
            >
              <div className="flex items-center gap-2 ml-auto">
                <FilterPanel
                  values={filters}
                  onChange={(key, value) => { setFilters(prev => ({ ...prev, [key]: value })); setPage(1); }}
                  onClear={() => { setFilters(DEFAULT_FILTER_VALUES); setPoSearch(''); setPage(1); }}
                  showDateRange={filterMode === 'all'}
                  showChannel
                  showStatus
                  statusOptions={poStatusOptions}
                />
                <ViewOptionsButton
                  columns={gridColumns}
                  visibleColumns={gridState.visibleColumns}
                  onToggleColumn={gridState.toggleColumnVisibility}
                  rowDensity={gridState.rowDensity}
                  onDensityChange={gridState.setRowDensity}
                  onSave={gridState.saveCurrentView}
                  onReset={gridState.resetView}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9"
                  onClick={() => exportToCSV(
                    allOrders.map(o => ({
                      'PO Number': o.po_number,
                      'Channel': o.channel,
                      'Quantity': o.quantity,
                      'PO Creation Date': o.dispatchDate,
                      'Expected Date': o.expectedDate,
                      'State': o.state,
                      'City': o.city,
                      'Hub': o.hub,
                      'Courier': o.courier,
                      'TAT': o.tat,
                      'Status': o.status,
                    })),
                    'purchase_orders'
                  )}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Export
                </Button>
              </div>
            </FilterBar>

            {isGridLoading ? (
              <div className="text-center py-12">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
                <p className="mt-3 text-sm text-muted-foreground">Loading orders...</p>
              </div>
            ) : allOrders.length > 0 ? (
              <>
                <DataGrid
                  data={allOrders}
                  gridState={gridState}
                  onRowClick={(row) => {
                    const path = row.channel === 'Amazon' ? '/amazon-po' : '/blinkit-po';
                    router.push(`${path}?search=${encodeURIComponent(row.po_number)}`);
                  }}
                />
                {totalPages > 1 && (
                  <div className="flex items-center justify-between pt-4">
                    <p className="text-sm text-muted-foreground">
                      Page {page} of {totalPages} &nbsp;·&nbsp; {allOrders.length} shown
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
              </>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No purchase orders found</p>
                {(debouncedSearch || filters.status !== 'all' || filters.channel !== 'all') && (
                  <p className="text-xs mt-1">Try clearing your filters</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </ProtectedRoute>
  );
}
