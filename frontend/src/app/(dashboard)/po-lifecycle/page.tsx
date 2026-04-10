'use client';

import { useState, useEffect, useMemo } from 'react';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { StatsCard, StatsGrid } from '@/components/ui/stats-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DataGrid, GridColumn, useDataGrid, ViewOptionsButton } from '@/components/ui/data-grid';
import { FilterBar } from '@/components/ui/filter-bar';
import { FilterPanel, FilterValues, DEFAULT_FILTER_VALUES } from '@/components/ui/filter-panel';
import { exportToCSV } from '@/lib/export';
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


export default function POLifecyclePage() {
  const router = useRouter();
  const [filters, setFilters] = useState<FilterValues>(DEFAULT_FILTER_VALUES);
  const [poSearch, setPoSearch] = useState('');
  const [allOrders, setAllOrders] = useState<PurchaseOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  useEffect(() => {
    const fetchPurchaseOrders = async () => {
      try {
        setIsLoading(true);

        const [amazonRes, blinkitRes] = await Promise.all([
          (api.purchaseOrders as any).getAmazonOverview({ page_size: 200 }) as any,
          (api.purchaseOrders as any).getBlinkitOverview({ page_size: 200 }) as any,
        ]);

        const toRow = (po: any, channel: string): PurchaseOrder => ({
          id: po.po_id,
          po_id: po.po_id,
          po_number: po.po_number,
          channel,
          quantity: po.total_qty || 0,
          dispatchDate: po.order_date ? new Date(po.order_date).toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '-',
          expectedDate: po.expected_delivery_date ? new Date(po.expected_delivery_date).toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '-',
          expectedDateRaw: po.expected_delivery_date || null,
          orderDateRaw: po.order_date ? po.order_date.slice(0, 10) : null,
          state: po.ship_to_state || '-',
          city: po.ship_to_city || '-',
          hub: po.ship_to_location_code || po.ship_to_name || '-',
          courier: '-',
          tat: '-',
          status: po.status || 'Created',
        });

        const rows: PurchaseOrder[] = [
          ...(amazonRes.items || []).map((po: any) => toRow(po, 'Amazon')),
          ...(blinkitRes.items || []).map((po: any) => toRow(po, 'Blinkit')),
        ];
        // Sort combined by order date desc
        rows.sort((a, b) => (b.orderDateRaw || '').localeCompare(a.orderDateRaw || ''));
        setAllOrders(rows);
      } catch (error) {
        console.error('Error fetching purchase orders:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchPurchaseOrders();
  }, []);

  const poStatusOptions = [
    { label: 'All', value: 'all' },
    { label: 'Created', value: 'Created' },
    { label: 'Dispatched', value: 'Dispatched' },
    { label: 'In Transit', value: 'In Transit' },
    { label: 'Delivered', value: 'Delivered' },
    { label: 'Delayed', value: 'Delayed' },
    { label: 'Diff Loss', value: 'Diff Loss' },
  ];

  // State options derived from all orders
  const stateOptions = useMemo(() => {
    const states = [...new Set(allOrders.map(o => o.state).filter(s => s && s !== '-' && s !== '—'))].sort();
    return [{ label: 'All', value: 'all' }, ...states.map(s => ({ label: s, value: s }))];
  }, [allOrders]);

  // Filter orders by channel, status, state, date range, and search
  const filteredOrders = allOrders.filter(order => {
    if (filters.channel !== 'all' && (order.channel || '').toLowerCase() !== filters.channel) return false;
    if (filters.status !== 'all' && order.status !== filters.status) return false;
    if (filters.state !== 'all' && order.state !== filters.state) return false;
    if (filters.dateFrom && order.orderDateRaw && order.orderDateRaw < filters.dateFrom) return false;
    if (filters.dateTo && order.orderDateRaw && order.orderDateRaw > filters.dateTo) return false;
    if (poSearch.trim()) {
      const q = poSearch.trim().toLowerCase();
      if (
        !(order.po_number || '').toLowerCase().includes(q) &&
        !(order.hub || '').toLowerCase().includes(q) &&
        !(order.courier || '').toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  // Calculate statistics based on filtered data
  const totalPOs = filteredOrders.length;
  const totalUnits = filteredOrders.reduce((sum, order) => sum + order.quantity, 0);
  const linkedPOs = filteredOrders.filter(o => o.status !== 'Created').length;
  const inTransitPOs = filteredOrders.filter(o => o.status === 'In Transit').length;
  const delayedCount = filteredOrders.filter(o => o.status === 'Delayed').length;

  // Lifecycle counts based on filtered data
  // Lifecycle flow = cumulative funnel: each stage shows POs that have reached OR passed that stage
  const LIFECYCLE_ORDER = ['Created', 'Dispatched', 'In Transit', 'Delivered', 'Diff Loss'];
  const stageIndex = (status: string) => {
    const idx = LIFECYCLE_ORDER.indexOf(status);
    return idx === -1 ? 0 : idx; // unknown statuses count as Created
  };
  const createdCount    = filteredOrders.length; // all POs entered the system = Created
  const dispatchedCount = filteredOrders.filter(o => stageIndex(o.status) >= 1).length;
  const inTransitCount  = filteredOrders.filter(o => stageIndex(o.status) >= 2).length;
  const deliveredCount  = filteredOrders.filter(o => stageIndex(o.status) >= 3).length;
  const diffLossCount   = filteredOrders.filter(o => o.status === 'Diff Loss').length;

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Delivered':
        return 'bg-green-100 text-green-700 border-green-200';
      case 'In Transit':
        return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'Dispatched':
        return 'bg-yellow-100 text-yellow-700 border-yellow-200';
      case 'Created':
        return 'bg-gray-100 text-gray-700 border-gray-200';
      case 'Delayed':
        return 'bg-red-100 text-red-700 border-red-200';
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  // Calculate hub data from filtered orders
  const hubMap = filteredOrders.reduce((acc, order) => {
    acc[order.hub] = (acc[order.hub] || 0) + order.quantity;
    return acc;
  }, {} as Record<string, number>);

  const hubData = Object.entries(hubMap)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  const maxHub = hubData.length > 0 ? Math.max(...hubData.map(h => h.value)) : 1;

  // DataGrid columns configuration
  const gridColumns: GridColumn<PurchaseOrder>[] = [
    {
      id: 'poNumber',
      header: 'PO Number',
      accessorKey: 'po_number',
      sortable: true,
      sticky: true,
      width: 190,
      minWidth: 160,
      cell: (row) => (
        <span className="font-medium text-primary">{row.po_number}</span>
      ),
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
      cell: (row) => <span className="font-semibold">{row.quantity.toLocaleString()}</span>,
    },
    {
      id: 'dispatchDate',
      header: 'Dispatch Date',
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
        {/* Status Cards */}
        <StatsGrid columns={5}>
          <StatsCard
            title="Total POs"
            value={totalPOs.toString()}
            icon={Package}
            description={`${totalUnits.toLocaleString()} units`}
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
                {/* Y-axis labels */}
                <div className="absolute left-0 top-0 h-full flex flex-col justify-between text-xs text-muted-foreground pr-2">
                  <span>3</span>
                  <span>2.25</span>
                  <span>1.5</span>
                  <span>0.75</span>
                  <span>0</span>
                </div>

                {/* Chart area */}
                <div className="ml-8 h-full flex items-end justify-between gap-4">
                  <div className="flex-1 flex flex-col items-center gap-2">
                    <div className="w-full bg-chart-1 rounded-t" style={{ height: `${(createdCount / Math.max(createdCount, dispatchedCount, inTransitCount, deliveredCount, delayedCount, diffLossCount)) * 240}px` }}></div>
                    <span className="text-xs text-muted-foreground">Created</span>
                    <span className="text-xs font-semibold">{createdCount}</span>
                  </div>
                  <div className="flex-1 flex flex-col items-center gap-2">
                    <div className="w-full bg-chart-2 rounded-t" style={{ height: `${(dispatchedCount / Math.max(createdCount, dispatchedCount, inTransitCount, deliveredCount, delayedCount, diffLossCount)) * 240}px` }}></div>
                    <span className="text-xs text-muted-foreground">Dispatched</span>
                    <span className="text-xs font-semibold">{dispatchedCount}</span>
                  </div>
                  <div className="flex-1 flex flex-col items-center gap-2">
                    <div className="w-full bg-chart-3 rounded-t" style={{ height: `${(inTransitCount / Math.max(createdCount, dispatchedCount, inTransitCount, deliveredCount, delayedCount, diffLossCount)) * 240}px` }}></div>
                    <span className="text-xs text-muted-foreground">In Transit</span>
                    <span className="text-xs font-semibold">{inTransitCount}</span>
                  </div>
                  <div className="flex-1 flex flex-col items-center gap-2">
                    <div className="w-full bg-chart-4 rounded-t" style={{ height: `${(deliveredCount / Math.max(createdCount, dispatchedCount, inTransitCount, deliveredCount, delayedCount, diffLossCount)) * 240}px` }}></div>
                    <span className="text-xs text-muted-foreground">Delivered</span>
                    <span className="text-xs font-semibold">{deliveredCount}</span>
                  </div>
                  <div className="flex-1 flex flex-col items-center gap-2">
                    <div className="w-full bg-red-400 rounded-t" style={{ height: `${(delayedCount / Math.max(createdCount, dispatchedCount, inTransitCount, deliveredCount, delayedCount, diffLossCount)) * 240}px` }}></div>
                    <span className="text-xs text-muted-foreground">Delayed</span>
                    <span className="text-xs font-semibold">{delayedCount}</span>
                  </div>
                  <div className="flex-1 flex flex-col items-center gap-2">
                    <div className="w-full bg-orange-400 rounded-t" style={{ height: `${(diffLossCount / Math.max(createdCount, dispatchedCount, inTransitCount, deliveredCount, delayedCount, diffLossCount)) * 240}px` }}></div>
                    <span className="text-xs text-muted-foreground">Diff Loss</span>
                    <span className="text-xs font-semibold">{diffLossCount}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Quantity by Hub Chart */}
          <Card>
            <CardHeader>
              <CardTitle>Quantity by Hub</CardTitle>
              <p className="text-sm text-muted-foreground">Units dispatched/pending by hub</p>
            </CardHeader>
            <CardContent>
              <div className="max-h-[350px] overflow-y-auto scrollbar-hide space-y-3 py-2">
                {hubData.length > 0 ? (
                  hubData.map((hub, index) => (
                    <div key={hub.name} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{hub.name}</span>
                        <span className="font-semibold">{hub.value.toLocaleString()}</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-4">
                        <div
                          className={`h-4 rounded-full transition-all ${index % 5 === 0 ? 'bg-chart-1' : index % 5 === 1 ? 'bg-chart-2' : index % 5 === 2 ? 'bg-chart-3' : index % 5 === 3 ? 'bg-chart-4' : 'bg-chart-5'}`}
                          style={{ width: `${(hub.value / maxHub) * 100}%` }}
                        ></div>
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
            <p className="text-sm text-muted-foreground">PO count at each lifecycle stage</p>
          </CardHeader>
          <CardContent>
            <div className="relative">
              {/* Timeline line */}
              <div className="absolute top-8 left-8 right-8 h-1 bg-gradient-to-r from-chart-1 via-chart-2 via-chart-3 via-chart-4 to-chart-5 hidden md:block"></div>

              {/* Timeline steps */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-6 md:gap-4 relative">
                {/* Created */}
                <div className="flex flex-col items-center gap-3">
                  <div className="w-16 h-16 rounded-full bg-chart-1 flex items-center justify-center shadow-lg ring-4 ring-chart-1/20 relative z-10">
                    <FileCheck className="h-7 w-7 text-white" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-muted-foreground">Created</p>
                    <p className="text-2xl font-bold">{createdCount}</p>
                    <p className="text-xs text-muted-foreground">POs</p>
                  </div>
                </div>

                {/* Dispatched */}
                <div className="flex flex-col items-center gap-3">
                  <div className="w-16 h-16 rounded-full bg-chart-2 flex items-center justify-center shadow-lg ring-4 ring-chart-2/20 relative z-10">
                    <Send className="h-7 w-7 text-white" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-muted-foreground">Dispatched</p>
                    <p className="text-2xl font-bold">{dispatchedCount}</p>
                    <p className="text-xs text-muted-foreground">POs</p>
                  </div>
                </div>

                {/* In Transit */}
                <div className="flex flex-col items-center gap-3">
                  <div className="w-16 h-16 rounded-full bg-chart-3 flex items-center justify-center shadow-lg ring-4 ring-chart-3/20 relative z-10">
                    <Truck className="h-7 w-7 text-white" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-muted-foreground">In Transit</p>
                    <p className="text-2xl font-bold">{inTransitCount}</p>
                    <p className="text-xs text-muted-foreground">POs</p>
                  </div>
                </div>

                {/* Delivered */}
                <div className="flex flex-col items-center gap-3">
                  <div className="w-16 h-16 rounded-full bg-chart-4 flex items-center justify-center shadow-lg ring-4 ring-chart-4/20 relative z-10">
                    <CheckCircle2 className="h-7 w-7 text-white" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-muted-foreground">Delivered</p>
                    <p className="text-2xl font-bold">{deliveredCount}</p>
                    <p className="text-xs text-muted-foreground">POs</p>
                  </div>
                </div>

                {/* Diff Loss */}
                <div className="flex flex-col items-center gap-3">
                  <div className="w-16 h-16 rounded-full bg-chart-5 flex items-center justify-center shadow-lg ring-4 ring-chart-5/20 relative z-10">
                    <XCircle className="h-7 w-7 text-white" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-muted-foreground">Diff Loss</p>
                    <p className="text-2xl font-bold">{diffLossCount}</p>
                    <p className="text-xs text-muted-foreground">POs</p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* All Purchase Orders Grid */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle>All Purchase Orders</CardTitle>
              <p className="text-sm text-muted-foreground">{filteredOrders.length} orders</p>
            </div>
          </CardHeader>
          <CardContent>
            <FilterBar
              searchPlaceholder="Search by PO number, hub, courier..."
              searchValue={poSearch}
              onSearchChange={setPoSearch}
              className="mb-4"
            >
              <div className="flex items-center gap-2 ml-auto">
                <FilterPanel
                  values={filters}
                  onChange={(key, value) => setFilters(prev => ({ ...prev, [key]: value }))}
                  onClear={() => { setFilters(DEFAULT_FILTER_VALUES); setPoSearch(''); }}
                  showChannel
                  showDateRange
                  showStatus
                  statusOptions={poStatusOptions}
                  showState={stateOptions.length > 1}
                  stateOptions={stateOptions}
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
                    filteredOrders.map(o => ({
                      'PO Number': o.po_number,
                      'Channel': o.channel,
                      'Quantity': o.quantity,
                      'Dispatch Date': o.dispatchDate,
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
            {filteredOrders.length > 0 ? (
              <DataGrid
                data={filteredOrders}
                gridState={gridState}
                onRowClick={(row) => {
                  const path = row.channel === 'Amazon' ? '/amazon-po' : '/blinkit-po';
                  router.push(`${path}?search=${encodeURIComponent(row.po_number)}`);
                }}
              />
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No purchase orders found</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </ProtectedRoute>
  );
}
