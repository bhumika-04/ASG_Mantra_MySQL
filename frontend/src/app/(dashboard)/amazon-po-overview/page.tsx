'use client';

import { useState, useEffect, useMemo } from 'react';
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
import { POStatusModal, POModalData } from '@/components/ui/po-status-modal';

interface POOverviewItem {
  id: number;
  ids: number[];
  po_number: string;
  po_date: string;
  orderDateRaw: string | null;
  po_expiry: string;
  expectedDeliveryDateRaw: string | null;
  products: number;
  totalQty: number;
  packed_qty: number;
  gap: number;
  status: string;
}

function isDelayed(expectedDate: string | null, status: string): boolean {
  if (!expectedDate || status === 'Delivered' || status === 'Cancelled' || status === 'Delayed') return false;
  return new Date(expectedDate) < new Date(new Date().toDateString());
}

// Map internal statuses → display names matching reference design
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
const KPI_CONFIG: Record<string, { icon: React.ReactNode; color: string; bg: string }> = {
  'Pending':   { icon: <Clock className="h-5 w-5" />,        color: 'text-orange-600',  bg: 'bg-orange-100' },
  'Partial':   { icon: <AlertCircle className="h-5 w-5" />,  color: 'text-yellow-600',  bg: 'bg-yellow-100' },
  'Ready':     { icon: <PackageCheck className="h-5 w-5" />, color: 'text-emerald-600', bg: 'bg-emerald-100' },
  'Shipped':   { icon: <Truck className="h-5 w-5" />,        color: 'text-blue-600',    bg: 'bg-blue-100' },
  'Delivered': { icon: <CheckCircle2 className="h-5 w-5" />, color: 'text-emerald-600', bg: 'bg-emerald-100' },
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

export default function AmazonPOOverviewPage() {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<FilterValues>(DEFAULT_FILTER_VALUES);
  const [poData, setPoData] = useState<POOverviewItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedPO, setSelectedPO] = useState<POModalData | null>(null);

  useEffect(() => {
    const fetchPOData = async () => {
      try {
        setIsLoading(true);
        const response = await api.purchaseOrders.getAmazon({ page_size: 100 }) as any;

        // Group POs by PO number
        const grouped = new Map<string, any>();

        response.items?.forEach((po: any) => {
          const poNum = po.po_number;
          if (!grouped.has(poNum)) {
            grouped.set(poNum, {
              id: po.id,
              ids: [po.id],
              po_number: poNum,
              po_date: po.order_date ? new Date(po.order_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A',
              orderDateRaw: po.order_date ? po.order_date.slice(0, 10) : null,
              po_expiry: po.expected_delivery_date ? new Date(po.expected_delivery_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A',
              expectedDeliveryDateRaw: po.expected_delivery_date || null,
              products: 1,
              totalQty: po.quantity || 0,
              packed_qty: po.packed_qty ?? 0,
              gap: po.gap ?? 0,
              status: po.status || 'Created',
            });
          } else {
            const existing = grouped.get(poNum);
            existing.ids.push(po.id);
            existing.products += 1;
            existing.totalQty += po.quantity || 0;
            existing.packed_qty += po.packed_qty ?? 0;
            existing.gap += po.gap ?? 0;
          }
        });

        // Auto-flag delayed POs and map to display status names
        const data = Array.from(grouped.values()).map((po: any) => {
          const rawStatus = isDelayed(po.expectedDeliveryDateRaw, po.status) ? 'Delayed' : po.status;
          return { ...po, status: displayStatus(rawStatus) };
        });
        setPoData(data);
      } catch (error) {
        console.error('Error fetching Amazon PO data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchPOData();
  }, []);

  const handleStatusUpdated = (poNumber: string, newStatus: string) => {
    setPoData(prev => prev.map(p => p.po_number === poNumber ? { ...p, status: newStatus } : p));
  };

  const poStatusOptions = [
    { label: 'All', value: 'all' },
    { label: 'Pending', value: 'Pending' },
    { label: 'Partial', value: 'Partial' },
    { label: 'Ready', value: 'Ready' },
    { label: 'Shipped', value: 'Shipped' },
    { label: 'Delivered', value: 'Delivered' },
  ];

  const filteredData = useMemo(() => {
    let filtered = [...poData];

    if (search) {
      filtered = filtered.filter(po =>
        po.po_number.toLowerCase().includes(search.toLowerCase())
      );
    }

    if (filters.dateFrom && filtered.length > 0) {
      filtered = filtered.filter(po => po.orderDateRaw && po.orderDateRaw >= filters.dateFrom);
    }
    if (filters.dateTo && filtered.length > 0) {
      filtered = filtered.filter(po => po.orderDateRaw && po.orderDateRaw <= filters.dateTo);
    }

    if (filters.status !== 'all') {
      filtered = filtered.filter(po => po.status === filters.status);
    }

    if (filters.channel !== 'all' && filters.channel !== 'amazon') {
      filtered = [];
    }

    return filtered;
  }, [poData, search, filters.dateFrom, filters.dateTo, filters.status, filters.channel]);

  // Calculate stats using display status names
  const stats = useMemo(() => {
    const pending = poData.filter(p => p.status === 'Pending').length;
    const partial = poData.filter(p => p.status === 'Partial').length;
    const ready = poData.filter(p => p.status === 'Ready').length;
    const shipped = poData.filter(p => p.status === 'Shipped').length;
    const delivered = poData.filter(p => p.status === 'Delivered').length;

    return { pending, partial, ready, shipped, delivered };
  }, [poData]);

  const getStatusBadge = (status: string) => {
    const style = BADGE_STYLES[status] || 'bg-gray-50 text-gray-700 border-gray-200';
    const iconMap: Record<string, React.ReactNode> = {
      'Pending': <Clock className="h-3.5 w-3.5 mr-1" />,
      'Partial': <AlertCircle className="h-3.5 w-3.5 mr-1" />,
      'Ready': <PackageCheck className="h-3.5 w-3.5 mr-1" />,
      'Shipped': <Truck className="h-3.5 w-3.5 mr-1" />,
      'Delivered': <CheckCircle2 className="h-3.5 w-3.5 mr-1" />,
    };
    return { style, icon: iconMap[status] };
  };

  const gridColumns: GridColumn<POOverviewItem>[] = [
    {
      id: 'poNumber',
      header: 'PO Number',
      accessorKey: 'po_number',
      sortable: true,
      width: 180,
      minWidth: 150,
      cell: (row) => <span className="font-medium text-blue-600">{row.po_number}</span>,
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
      id: 'poExpiry',
      header: 'PO Expiry',
      accessorKey: 'po_expiry',
      sortable: true,
      width: 140,
      minWidth: 120,
      cell: (row) => <span className="text-sm">{row.po_expiry}</span>,
    },
    {
      id: 'products',
      header: 'Products',
      accessorKey: 'products',
      sortable: true,
      width: 110,
      minWidth: 90,
      align: 'center',
      cell: (row) => <span className="font-semibold">{row.products}</span>,
    },
    {
      id: 'totalQty',
      header: 'Total Qty',
      accessorKey: 'totalQty',
      sortable: true,
      width: 120,
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
        if (typeof badge === 'string') {
          return <Badge className={badge} variant="outline">{row.status}</Badge>;
        }
        return (
          <Badge className={`${badge.style} inline-flex items-center`} variant="outline">
            {badge.icon}
            {row.status}
          </Badge>
        );
      },
    },
  ];

  const gridState = useDataGrid(gridColumns);

  if (isLoading) {
    return (
      <ProtectedRoute>
        <div className="p-6 flex items-center justify-center">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
            <p className="text-muted-foreground">Loading Amazon PO data...</p>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  const kpiCards = [
    { label: 'Pending', count: stats.pending, status: 'Pending' },
    { label: 'Partial', count: stats.partial, status: 'Partial' },
    { label: 'Ready', count: stats.ready, status: 'Ready' },
    { label: 'Shipped', count: stats.shipped, status: 'Shipped' },
    { label: 'Delivered', count: stats.delivered, status: 'Delivered' },
  ];

  return (
    <ProtectedRoute>
      <div className="p-6 space-y-6">
        {/* KPI Cards - Compact with colored icons */}
        <div className="grid grid-cols-3 md:grid-cols-5 gap-4">
          {kpiCards.map(({ label, count, status }) => {
            const config = KPI_CONFIG[status];
            return (
              <div
                key={status}
                className={`flex items-center gap-3 p-4 bg-card border rounded-xl cursor-pointer hover:shadow-sm transition-shadow ${filters.status === status ? 'ring-2 ring-blue-400' : ''}`}
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
            {filteredData.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                onClick={() => exportToCSV(
                  filteredData.map(p => ({
                    'PO Number': p.po_number,
                    'PO Date': p.po_date,
                    'PO Expiry': p.po_expiry,
                    'Products': p.products,
                    'Total Qty': p.totalQty,
                    'Status': p.status,
                  })),
                  'amazon_po_overview'
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
                {search ? 'Try adjusting your search criteria' : 'No Amazon POs available'}
              </p>
            </div>
          ) : (
            <DataGrid
              data={filteredData}
              gridState={gridState}
              onRowClick={(row) => setSelectedPO({ id: row.id, ids: row.ids, po_number: row.po_number, status: row.status, quantity: row.totalQty })}
            />
          )}
        </div>
      </div>

      {/* PO Status Update Modal */}
      <POStatusModal
        po={selectedPO}
        onClose={() => setSelectedPO(null)}
        onStatusUpdated={handleStatusUpdated}
      />
    </ProtectedRoute>
  );
}
