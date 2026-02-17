'use client';

import { useState, useEffect, useMemo } from 'react';
import React from 'react';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { FilterBar } from '@/components/ui/filter-bar';
import { FilterPanel, FilterValues, DEFAULT_FILTER_VALUES } from '@/components/ui/filter-panel';
import { DataGrid, GridColumn, useDataGrid, ViewOptionsButton } from '@/components/ui/data-grid';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { exportToCSV } from '@/lib/export';
import {
  ShoppingCart,
  CheckCircle2,
  Clock,
  AlertCircle,
  Truck,
  PackageCheck,
  Download,
} from 'lucide-react';
import api from '@/lib/api';

// Map internal DB statuses → display names
const STATUS_DISPLAY: Record<string, string> = {
  'Created': 'Pending',
  'Packed': 'Ready',
  'Dispatched': 'Shipped',
  'In Transit': 'Partial',
  'Delivered': 'Delivered',
  'Delayed': 'Pending',
  'Cancelled': 'Cancelled',
};

function displayStatus(status: string) {
  return STATUS_DISPLAY[status] || status;
}

// KPI config keyed by display name
const KPI_CONFIG: Record<string, { icon: React.ReactNode; color: string; bg: string; desc: string }> = {
  'Pending':   { icon: <Clock className="h-5 w-5" />,        color: 'text-orange-600',  bg: 'bg-orange-100',  desc: 'Awaiting assignment' },
  'Partial':   { icon: <AlertCircle className="h-5 w-5" />,  color: 'text-yellow-600',  bg: 'bg-yellow-100',  desc: 'Needs inventory' },
  'Ready':     { icon: <PackageCheck className="h-5 w-5" />, color: 'text-emerald-600', bg: 'bg-emerald-100', desc: 'Ready to dispatch' },
  'Shipped':   { icon: <Truck className="h-5 w-5" />,        color: 'text-blue-600',    bg: 'bg-blue-100',    desc: 'In transit' },
  'Delivered': { icon: <CheckCircle2 className="h-5 w-5" />, color: 'text-emerald-600', bg: 'bg-emerald-100', desc: 'Completed' },
};

// Badge styles for grid status column
const BADGE_STYLES: Record<string, string> = {
  'Pending':   'bg-orange-50 text-orange-700 border-orange-200',
  'Partial':   'bg-yellow-50 text-yellow-700 border-yellow-200',
  'Ready':     'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Shipped':   'bg-blue-50 text-blue-700 border-blue-200',
  'Delivered': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Cancelled': 'bg-gray-50 text-gray-600 border-gray-200',
};

// Reverse mapping: display name → DB status for API calls
const DISPLAY_TO_DB: Record<string, string> = {
  'Pending':   'Created',
  'Ready':     'Packed',
  'Shipped':   'Dispatched',
  'Partial':   'In Transit',
  'Delivered': 'Delivered',
  'Cancelled': 'Cancelled',
};

const STATUS_OPTIONS = ['Pending', 'Ready', 'Partial', 'Shipped', 'Delivered'];

interface POItem {
  id: number;
  po_number: string;
  po_date: string;
  orderDateRaw: string | null;
  blinkitSku: string;
  product_name: string;
  ordered_qty: number;
  mapped_sku: string;
  ready_qty: number;
  pending_qty: number;
  state: string;
  feWarehouse: string;
  beWarehouse: string;
  delivery: string;
  status: string;
}

// Extract state from ShipToAddress (try to parse Indian state names)
function extractState(address: string | null, shipToName: string | null): string {
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

export default function BlinkitPOPage() {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<FilterValues>(DEFAULT_FILTER_VALUES);
  const [poData, setPoData] = useState<POItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  const handleStatusChange = async (poItem: POItem, newDisplayStatus: string) => {
    if (newDisplayStatus === poItem.status) return;
    const dbStatus = DISPLAY_TO_DB[newDisplayStatus] || newDisplayStatus;
    try {
      setUpdatingId(poItem.id);
      await api.purchaseOrders.updateBlinkitItemStatus(poItem.id, { status: dbStatus });
      setPoData(prev => prev.map(p => p.id === poItem.id ? { ...p, status: newDisplayStatus } : p));
    } catch (error) {
      console.error('Error updating status:', error);
    } finally {
      setUpdatingId(null);
    }
  };

  useEffect(() => {
    const fetchBlinkitPOs = async () => {
      try {
        setIsLoading(true);

        // Fetch Blinkit purchase orders
        const response = await api.purchaseOrders.getBlinkit() as any;

        // Transform purchase orders to match our interface
        const transformedPOs = (response.items || []).map((po: any) => ({
          id: po.id,
          po_number: po.po_number,
          po_date: po.order_date ? new Date(po.order_date).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : '-',
          orderDateRaw: po.order_date ? po.order_date.slice(0, 10) : null,
          blinkitSku: po.blinkit_id || po.blinkitId || '',
          product_name: po.product_name || po.productName || '',
          ordered_qty: po.quantity,
          mapped_sku: po.asg_sku || po.asgSku || '',
          ready_qty: po.received_quantity || 0,
          pending_qty: Math.max(0, (po.quantity || 0) - (po.received_quantity || 0)),
          state: po.ship_to_address ? extractState(po.ship_to_address, po.ship_to_name) : '-',
          feWarehouse: po.ship_to_name || '-',
          beWarehouse: '-',
          delivery: po.expected_delivery_date ? new Date(po.expected_delivery_date).toLocaleDateString('en-US', { day: 'numeric', month: 'short' }) : '-',
          status: displayStatus(po.status || 'Created'),
        }));

        setPoData(transformedPOs);
      } catch (error) {
        console.error('Error fetching Blinkit purchase orders:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchBlinkitPOs();
  }, []);

  const gridColumns: GridColumn<POItem>[] = [
    {
      id: 'poNumber',
      header: 'PO Number',
      accessorKey: 'po_number',
      sortable: true,
      width: 170,
      minWidth: 150,
      cell: (row) => <span className="font-medium text-primary">{row.po_number}</span>,
    },
    {
      id: 'poDate',
      header: 'PO Date',
      accessorKey: 'po_date',
      width: 120,
      minWidth: 100,
      cell: (row) => <span className="text-muted-foreground">{row.po_date}</span>,
    },
    {
      id: 'blinkitSku',
      header: 'Blinkit SKU',
      accessorKey: 'blinkitSku',
      width: 150,
      minWidth: 130,
      cell: (row) => <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{row.blinkitSku}</code>,
    },
    {
      id: 'productName',
      header: 'Product',
      accessorKey: 'product_name',
      sortable: true,
      width: 360,
      minWidth: 200,
      cell: (row) => (
        <span
          className="font-medium text-sm leading-snug"
          style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
          title={row.product_name}
        >
          {row.product_name || '—'}
        </span>
      ),
    },
    {
      id: 'orderedQty',
      header: 'Ordered',
      accessorKey: 'ordered_qty',
      sortable: true,
      width: 110,
      minWidth: 90,
      align: 'right',
      cell: (row) => <span className="font-medium">{row.ordered_qty.toLocaleString()}</span>,
    },
    {
      id: 'mappedSku',
      header: 'Mapped SKU',
      accessorKey: 'mapped_sku',
      width: 150,
      minWidth: 130,
      cell: (row) => row.mapped_sku ? (
        <code className="text-xs text-muted-foreground">{row.mapped_sku}</code>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    },
    {
      id: 'readyQty',
      header: 'Ready',
      accessorKey: 'ready_qty',
      sortable: true,
      width: 110,
      minWidth: 90,
      align: 'right',
      cell: (row) => (
        <span className={row.ready_qty > 0 ? 'font-medium' : 'text-muted-foreground'}>
          {row.ready_qty.toLocaleString()}
        </span>
      ),
    },
    {
      id: 'pendingQty',
      header: 'Pending',
      accessorKey: 'pending_qty',
      sortable: true,
      width: 110,
      minWidth: 90,
      align: 'right',
      cell: (row) => (
        <span className={row.pending_qty > 0 ? 'font-medium text-amber-600' : 'text-muted-foreground'}>
          {row.pending_qty.toLocaleString()}
        </span>
      ),
    },
    {
      id: 'state',
      header: 'State',
      accessorKey: 'state',
      width: 130,
      minWidth: 110,
      cell: (row) => <span className="text-muted-foreground">{row.state}</span>,
    },
    {
      id: 'feWarehouse',
      header: 'FE Warehouse',
      accessorKey: 'feWarehouse',
      sortable: true,
      width: 200,
      minWidth: 150,
      cell: (row) => <span className="text-sm">{row.feWarehouse}</span>,
    },
    {
      id: 'beWarehouse',
      header: 'BE Warehouse',
      accessorKey: 'beWarehouse',
      sortable: true,
      width: 200,
      minWidth: 150,
      cell: (row) => <span className="text-sm">{row.beWarehouse}</span>,
    },
    {
      id: 'delivery',
      header: 'Delivery',
      accessorKey: 'delivery',
      width: 110,
      minWidth: 90,
      cell: (row) => <span className="text-muted-foreground">{row.delivery}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      accessorKey: 'status',
      width: 130,
      minWidth: 110,
      align: 'center',
      cell: (row) => (
        <Badge variant="outline" className={BADGE_STYLES[row.status] || 'bg-gray-50 text-gray-700 border-gray-200'}>
          {row.status}
        </Badge>
      ),
    },
    {
      id: 'action',
      header: 'Action',
      width: 150,
      minWidth: 130,
      align: 'center',
      cell: (row) => (
        <select
          className="h-8 text-xs border border-border rounded-md px-2 py-1 bg-background text-foreground cursor-pointer disabled:opacity-50"
          value={row.status}
          disabled={updatingId === row.id}
          onChange={(e) => handleStatusChange(row, e.target.value)}
        >
          {STATUS_OPTIONS.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      ),
    },
  ];

  const gridState = useDataGrid(gridColumns);

  const poStatusOptions = [
    { label: 'All', value: 'all' },
    { label: 'Pending', value: 'Pending' },
    { label: 'Partial', value: 'Partial' },
    { label: 'Ready', value: 'Ready' },
    { label: 'Shipped', value: 'Shipped' },
    { label: 'Delivered', value: 'Delivered' },
  ];

  // Calculate stats and filtered data
  const filteredPoData = useMemo(() => {
    let filtered = [...poData];

    // Apply search filter
    if (search) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter(
        (po) =>
          po.po_number.toLowerCase().includes(searchLower) ||
          po.product_name.toLowerCase().includes(searchLower) ||
          po.blinkitSku.toLowerCase().includes(searchLower)
      );
    }

    // Apply date range filter
    if (filters.dateFrom && filtered.length > 0) {
      filtered = filtered.filter((po) => po.orderDateRaw && po.orderDateRaw >= filters.dateFrom);
    }
    if (filters.dateTo && filtered.length > 0) {
      filtered = filtered.filter((po) => po.orderDateRaw && po.orderDateRaw <= filters.dateTo);
    }

    // Apply status filter
    if (filters.status !== 'all') {
      filtered = filtered.filter((po) => po.status === filters.status);
    }

    // Channel filter (always blinkit for this page, but included for consistency)
    if (filters.channel !== 'all' && filters.channel !== 'blinkit') {
      filtered = [];
    }

    return filtered;
  }, [poData, search, filters.dateFrom, filters.dateTo, filters.status, filters.channel]);

  const totalPOs = new Set(poData.map(po => po.po_number)).size;
  const totalUnits = poData.reduce((sum, po) => sum + po.ordered_qty, 0);
  const stats = useMemo(() => ({
    pending: poData.filter(po => po.status === 'Pending').length,
    partial: poData.filter(po => po.status === 'Partial').length,
    ready: poData.filter(po => po.status === 'Ready').length,
    shipped: poData.filter(po => po.status === 'Shipped').length,
    delivered: poData.filter(po => po.status === 'Delivered').length,
  }), [poData]);

  const kpiCards = [
    { label: 'Pending', count: stats.pending, status: 'Pending' },
    { label: 'Partial', count: stats.partial, status: 'Partial' },
    { label: 'Ready', count: stats.ready, status: 'Ready' },
    { label: 'Shipped', count: stats.shipped, status: 'Shipped' },
    { label: 'Delivered', count: stats.delivered, status: 'Delivered' },
  ];


  if (isLoading) {
    return (
      <ProtectedRoute>
        <div className="p-6 flex items-center justify-center">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-yellow-600 mb-4"></div>
            <p className="text-muted-foreground">Loading Blinkit purchase orders...</p>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="p-6 space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-3 md:grid-cols-6 gap-4">
          {/* Total POs card */}
          <div className="flex items-center gap-3 p-4 bg-card border rounded-xl">
            <div className="flex items-center justify-center h-10 w-10 rounded-full bg-yellow-100 text-yellow-600">
              <ShoppingCart className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total POs</p>
              <p className="text-xl font-bold">{totalPOs}</p>
              <p className="text-xs text-muted-foreground">{totalUnits.toLocaleString()} units</p>
            </div>
          </div>
          {/* Status KPI cards */}
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
                  <p className="text-xs text-muted-foreground">{config.desc}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Filters */}
        <FilterBar
          searchPlaceholder="Search by PO number or product..."
          searchValue={search}
          onSearchChange={setSearch}
        >
          <div className="flex items-center gap-2 ml-auto">
            <FilterPanel
              values={filters}
              onChange={(key, value) => setFilters(prev => ({ ...prev, [key]: value }))}
              onClear={() => { setFilters(DEFAULT_FILTER_VALUES); setSearch(''); }}
              showDateRange
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
            />
            {filteredPoData.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                onClick={() => exportToCSV(
                  filteredPoData.map(p => ({
                    'PO Number': p.po_number,
                    'PO Date': p.po_date,
                    'Blinkit SKU': p.blinkitSku,
                    'Product': p.product_name,
                    'Ordered Qty': p.ordered_qty,
                    'Mapped SKU': p.mapped_sku,
                    'Ready Qty': p.ready_qty,
                    'Pending Qty': p.pending_qty,
                    'State': p.state,
                    'FE Warehouse': p.feWarehouse,
                    'BE Warehouse': p.beWarehouse,
                    'Delivery': p.delivery,
                    'Status': p.status,
                  })),
                  'blinkit_po'
                )}
              >
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            )}
          </div>
        </FilterBar>

        {/* Professional Data Grid */}
        {filteredPoData.length > 0 ? (
          <DataGrid
            data={filteredPoData}
            gridState={gridState}
          />
        ) : (
          <div className="text-center py-12 text-muted-foreground border-2 border-dashed rounded-lg">
            <ShoppingCart className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No purchase orders found</p>
          </div>
        )}
      </div>
    </ProtectedRoute>
  );
}
