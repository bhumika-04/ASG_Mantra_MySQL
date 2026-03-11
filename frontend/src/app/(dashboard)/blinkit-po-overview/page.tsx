'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { FilterBar } from '@/components/ui/filter-bar';
import { FilterPanel, FilterValues, DEFAULT_FILTER_VALUES } from '@/components/ui/filter-panel';
import { DataGrid, GridColumn, useDataGrid, ViewOptionsButton } from '@/components/ui/data-grid';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { exportToCSV } from '@/lib/export';
import {
  Clock,
  AlertCircle,
  CheckCircle2,
  Truck,
  PackageCheck,
  Download,
} from 'lucide-react';
import api from '@/lib/api';

interface POOverviewItem {
  id: number;
  po_id: number;
  po_number: string;
  po_date: string;
  orderDateRaw: string | null;
  deliveryDate: string;
  shipTo: string;
  state: string;
  items: number;
  totalQty: number;
  status: string;
}

// KPI config keyed by DB status name
const KPI_CONFIG: Record<string, { icon: React.ReactNode; color: string; bg: string }> = {
  'Created':    { icon: <Clock className="h-5 w-5" />,        color: 'text-orange-600',  bg: 'bg-orange-100' },
  'Dispatched': { icon: <Truck className="h-5 w-5" />,        color: 'text-blue-600',    bg: 'bg-blue-100' },
  'In Transit': { icon: <AlertCircle className="h-5 w-5" />,  color: 'text-yellow-600',  bg: 'bg-yellow-100' },
  'Delivered':  { icon: <CheckCircle2 className="h-5 w-5" />, color: 'text-emerald-600', bg: 'bg-emerald-100' },
  'Delayed':    { icon: <AlertCircle className="h-5 w-5" />,  color: 'text-red-600',     bg: 'bg-red-100' },
};

// Badge styles keyed by DB status name
const BADGE_STYLES: Record<string, string> = {
  'Created':    'bg-gray-50 text-gray-700 border-gray-200',
  'Dispatched': 'bg-blue-50 text-blue-700 border-blue-200',
  'In Transit': 'bg-yellow-50 text-yellow-700 border-yellow-200',
  'Delivered':  'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Delayed':    'bg-red-50 text-red-700 border-red-200',
  'Cancelled':  'bg-gray-50 text-gray-600 border-gray-200',
  'Diff Loss':  'bg-purple-50 text-purple-700 border-purple-200',
  'Closed':     'bg-slate-50 text-slate-600 border-slate-200',
};

// GST state code → state name (India)
const GSTIN_STATE_MAP: Record<string, string> = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab',
  '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana',
  '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh',
  '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh',
  '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram',
  '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam',
  '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha',
  '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa',
  '32': 'Kerala', '33': 'Tamil Nadu', '36': 'Telangana',
  '37': 'Andhra Pradesh',
};

// Extract state — GSTIN prefix is most reliable, fall back to address text
function extractState(address: string | null, shipToName: string | null, gstin?: string | null): string {
  if (gstin && gstin.length >= 2) {
    const code = gstin.substring(0, 2);
    if (GSTIN_STATE_MAP[code]) return GSTIN_STATE_MAP[code];
  }
  if (!address && !shipToName) return '—';
  const text = (address || '') + ' ' + (shipToName || '');
  const states = [
    'Delhi', 'Maharashtra', 'Karnataka', 'Tamil Nadu', 'Telangana',
    'Gujarat', 'Rajasthan', 'Uttar Pradesh', 'West Bengal', 'Madhya Pradesh',
    'Haryana', 'Punjab', 'Kerala', 'Andhra Pradesh', 'Bihar',
    'Odisha', 'Jharkhand', 'Assam', 'Chhattisgarh', 'Goa',
  ];
  for (const state of states) {
    if (text.toLowerCase().includes(state.toLowerCase())) return state;
  }
  return '—';
}

export default function BlinkitPOOverviewPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<FilterValues>(DEFAULT_FILTER_VALUES);
  const [poData, setPoData] = useState<POOverviewItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  useEffect(() => {
    const fetchPOData = async () => {
      try {
        setIsLoading(true);
        const response = await api.purchaseOrders.getBlinkit({ page_size: 1000 }) as any;

        // Group by PO number for overview
        const grouped = new Map<string, any>();

        (response.items || []).forEach((po: any) => {
          const poNum = po.po_number;
          const rawStatus = po.status || 'Created';
          const shipToName = po.ship_to_name || '';
          const shipToAddress = po.ship_to_address || '';
          const state = extractState(shipToAddress, shipToName, po.ship_to_gstin);

          if (!grouped.has(poNum)) {
            grouped.set(poNum, {
              id: po.id,
              po_id: po.po_id,
              po_number: poNum,
              po_date: po.order_date ? new Date(po.order_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A',
              orderDateRaw: po.order_date ? po.order_date.slice(0, 10) : null,
              deliveryDate: po.expected_delivery_date ? new Date(po.expected_delivery_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A',
              shipTo: shipToName || '—',
              state,
              items: 1,
              totalQty: po.quantity || 0,
              rawStatus,
            });
          } else {
            const existing = grouped.get(poNum);
            existing.items += 1;
            existing.totalQty += po.quantity || 0;
          }
        });

        // Use raw DB status directly
        const data = Array.from(grouped.values()).map((po: any) => {
          return { ...po, status: po.rawStatus || 'Created' };
        });
        setPoData(data);
      } catch (error) {
        console.error('Error fetching Blinkit PO data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchPOData();
  }, []);

  const poStatusOptions = [
    { label: 'All',        value: 'all' },
    { label: 'Created',    value: 'Created' },
    { label: 'Dispatched', value: 'Dispatched' },
    { label: 'In Transit', value: 'In Transit' },
    { label: 'Delivered',  value: 'Delivered' },
    { label: 'Delayed',    value: 'Delayed' },
    { label: 'Cancelled',  value: 'Cancelled' },
  ];

  const filteredData = useMemo(() => {
    let filtered = [...poData];

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter(po =>
        (po.po_number || '').toLowerCase().includes(q)
      );
    }

    if (filters.dateFrom) {
      filtered = filtered.filter(po => po.orderDateRaw && po.orderDateRaw >= filters.dateFrom);
    }
    if (filters.dateTo) {
      filtered = filtered.filter(po => po.orderDateRaw && po.orderDateRaw <= filters.dateTo);
    }

    if (filters.status !== 'all') {
      filtered = filtered.filter(po => po.status === filters.status);
    }

    if (filters.state !== 'all') {
      filtered = filtered.filter(po => po.state === filters.state);
    }

    return filtered;
  }, [poData, search, filters.dateFrom, filters.dateTo, filters.status, filters.state]);

  const stateOptions = useMemo(() => {
    const states = [...new Set(poData.map(p => p.state).filter(s => s && s !== '—'))].sort();
    return [{ label: 'All', value: 'all' }, ...states.map(s => ({ label: s, value: s }))];
  }, [poData]);

  // Stats using display status names
  const stats = useMemo(() => {
    const created    = poData.filter(p => p.status === 'Created').length;
    const dispatched = poData.filter(p => p.status === 'Dispatched').length;
    const inTransit  = poData.filter(p => p.status === 'In Transit').length;
    const delivered  = poData.filter(p => p.status === 'Delivered').length;
    const delayed    = poData.filter(p => p.status === 'Delayed').length;
    return { created, dispatched, inTransit, delivered, delayed };
  }, [poData]);

  const getStatusBadge = (status: string) => {
    const style = BADGE_STYLES[status] || 'bg-gray-50 text-gray-700 border-gray-200';
    const iconMap: Record<string, React.ReactNode> = {
      'Created':    <Clock className="h-3.5 w-3.5 mr-1" />,
      'Dispatched': <Truck className="h-3.5 w-3.5 mr-1" />,
      'In Transit': <AlertCircle className="h-3.5 w-3.5 mr-1" />,
      'Delivered':  <CheckCircle2 className="h-3.5 w-3.5 mr-1" />,
      'Delayed':    <AlertCircle className="h-3.5 w-3.5 mr-1" />,
    };
    return { style, icon: iconMap[status] };
  };

  const gridColumns: GridColumn<POOverviewItem>[] = [
    {
      id: 'poNumber',
      header: 'PO Number',
      accessorKey: 'po_number',
      sortable: true,
      sticky: true,
      width: 180,
      minWidth: 150,
      cell: (row) => (
        <span className="font-medium text-blue-600">{row.po_number}</span>
      ),
    },
    {
      id: 'poDate',
      header: 'PO Date',
      accessorKey: 'po_date',
      sortable: true,
      width: 140,
      minWidth: 120,
      cell: (row) => <span className="text-sm">{row.po_date}</span>,
    },
    {
      id: 'deliveryDate',
      header: 'Delivery Date',
      accessorKey: 'deliveryDate',
      sortable: true,
      width: 140,
      minWidth: 120,
      cell: (row) => <span className="text-sm">{row.deliveryDate}</span>,
    },
    {
      id: 'shipTo',
      header: 'Ship To',
      accessorKey: 'shipTo',
      sortable: true,
      width: 220,
      minWidth: 160,
      cell: (row) => <span className="text-sm text-muted-foreground">{row.shipTo}</span>,
    },
    {
      id: 'state',
      header: 'State',
      accessorKey: 'state',
      sortable: true,
      width: 130,
      minWidth: 100,
      cell: (row) => <span className="text-sm">{row.state}</span>,
    },
    {
      id: 'items',
      header: 'Total Items',
      accessorKey: 'items',
      sortable: true,
      width: 110,
      minWidth: 90,
      align: 'center',
      cell: (row) => <span className="font-semibold">{row.items}</span>,
    },
    {
      id: 'totalQty',
      header: 'Total Qty',
      accessorKey: 'totalQty',
      sortable: true,
      width: 110,
      minWidth: 90,
      align: 'right',
      cell: (row) => <span className="font-semibold">{row.totalQty.toLocaleString()}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      accessorKey: 'status',
      sortable: true,
      width: 150,
      minWidth: 130,
      align: 'center',
      cell: (row) => {
        const badge = getStatusBadge(row.status);
        return (
          <Badge className={`${badge.style} inline-flex items-center`} variant="outline">
            {badge.icon}
            {row.status}
          </Badge>
        );
      },
    },
  ];

  const gridState = useDataGrid(gridColumns, 'blinkit-po-overview');

  if (isLoading) {
    return (
      <ProtectedRoute>
        <div className="p-6 flex items-center justify-center">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-yellow-600 mb-4"></div>
            <p className="text-muted-foreground">Loading Blinkit PO data...</p>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  const kpiCards = [
    { label: 'Created',    count: stats.created,    status: 'Created' },
    { label: 'Dispatched', count: stats.dispatched, status: 'Dispatched' },
    { label: 'In Transit', count: stats.inTransit,  status: 'In Transit' },
    { label: 'Delivered',  count: stats.delivered,  status: 'Delivered' },
    { label: 'Delayed',    count: stats.delayed,    status: 'Delayed' },
  ];

  return (
    <ProtectedRoute>
      <div className="p-6 space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-3 md:grid-cols-5 gap-4">
          {kpiCards.map(({ label, count, status }) => {
            const config = KPI_CONFIG[status];
            return (
              <div
                key={status}
                className={`flex items-center gap-3 p-4 bg-card border rounded-xl cursor-pointer hover:shadow-sm transition-shadow ${filters.status === status ? 'ring-2 ring-yellow-400' : ''}`}
                onClick={() => {
                  if (filters.status === status) {
                    setFilters(prev => ({ ...prev, status: 'all' }));
                  } else {
                    setFilters(prev => ({ ...prev, status }));
                  }
                }}
              >
                <div className={`flex items-center justify-center h-10 w-10 rounded-full ${config.bg} ${config.color}`}>
                  {config.icon}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-xl font-bold">{count}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Filters */}
        <FilterBar
          searchPlaceholder="Search by PO number..."
          searchValue={search}
          onSearchChange={setSearch}
        >
          <div className="flex items-center gap-2 ml-auto">
            <FilterPanel
              values={filters}
              onChange={(key, value) => setFilters(prev => ({ ...prev, [key]: value }))}
              onClear={() => { setFilters(DEFAULT_FILTER_VALUES); setSearch(''); }}
              showDateRange
              showChannel={false}
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
            {filteredData.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                onClick={() => exportToCSV(
                  filteredData.map(p => ({
                    'PO Number': p.po_number,
                    'PO Date': p.po_date,
                    'Delivery Date': p.deliveryDate,
                    'Ship To': p.shipTo,
                    'State': p.state,
                    'Total Items': p.items,
                    'Total Qty': p.totalQty,
                    'Status': p.status,
                  })),
                  'blinkit_po_overview'
                )}
              >
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            )}
          </div>
        </FilterBar>

        {/* Data Grid */}
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Showing {filteredData.length} of {poData.length} purchase orders
          </p>
          {filteredData.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 border-2 border-dashed rounded-xl">
              <PackageCheck className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-semibold mb-2">No purchase orders found</h3>
              <p className="text-sm text-muted-foreground">
                {search ? 'Try adjusting your search criteria' : 'No Blinkit POs available'}
              </p>
            </div>
          ) : (
            <DataGrid
              data={filteredData}
              gridState={gridState}
              onRowClick={(row) => router.push(`/blinkit-po?search=${encodeURIComponent(row.po_number)}`)}
            />
          )}
        </div>
      </div>
    </ProtectedRoute>
  );
}
