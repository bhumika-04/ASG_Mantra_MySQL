'use client';

import { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import React from 'react';
import { FilterBar } from '@/components/ui/filter-bar';
import { FilterPanel, FilterValues, DEFAULT_FILTER_VALUES } from '@/components/ui/filter-panel';
import { DataGrid, GridColumn, useDataGrid, ViewOptionsButton } from '@/components/ui/data-grid';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { exportToCSV } from '@/lib/export';
import { toast } from 'sonner';
import {
  ShoppingCart,
  CheckCircle2,
  Clock,
  AlertCircle,
  Truck,
  Download,
  MoreVertical,
  PackagePlus,
  PackageCheck,
  RefreshCw,
} from 'lucide-react';
import api from '@/lib/api';

// KPI config keyed by DB status name
const KPI_CONFIG: Record<string, { icon: React.ReactNode; color: string; bg: string; desc: string }> = {
  'Created':    { icon: <Clock className="h-5 w-5" />,        color: 'text-orange-600',  bg: 'bg-orange-100',  desc: 'Awaiting dispatch' },
  'Dispatched': { icon: <Truck className="h-5 w-5" />,        color: 'text-blue-600',    bg: 'bg-blue-100',    desc: 'In transit' },
  'In Transit': { icon: <AlertCircle className="h-5 w-5" />,  color: 'text-yellow-600',  bg: 'bg-yellow-100',  desc: 'In transit' },
  'Delivered':  { icon: <CheckCircle2 className="h-5 w-5" />, color: 'text-emerald-600', bg: 'bg-emerald-100', desc: 'Completed' },
  'Delayed':    { icon: <AlertCircle className="h-5 w-5" />,  color: 'text-red-600',     bg: 'bg-red-100',     desc: 'Delayed' },
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

const STATUS_OPTIONS = ['Created', 'Dispatched', 'In Transit', 'Delivered', 'Delayed', 'Cancelled'];

interface POItem {
  id: number;
  po_number: string;
  po_date: string;
  orderDateRaw: string | null;
  asin: string;
  product_name: string;
  ordered_qty: number;
  accepted_qty: number | null;
  mapped_sku: string;
  received_qty: number;
  pending_qty: number;
  unit_cost: number | null;
  total_cost: number | null;
  po_expiry: string;
  status: string;
  city: string;
  state: string;
}

function AmazonPOPageContent() {
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [filters, setFilters] = useState<FilterValues>(DEFAULT_FILTER_VALUES);
  const [poData, setPoData] = useState<POItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [statsData, setStatsData] = useState<{ status_counts: Record<string, number>; total_pos: number; total_units: number } | null>(null);

  // Action state
  const [actionRow, setActionRow] = useState<POItem | null>(null);
  const [acceptedQtyInput, setAcceptedQtyInput] = useState('');
  const [receivedQtyInput, setReceivedQtyInput] = useState('');
  const [statusInput, setStatusInput] = useState('');
  const [actionDialogType, setActionDialogType] = useState<'accepted_qty' | 'received_qty' | 'status' | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const openAcceptedQtyDialog = (row: POItem) => {
    setActionRow(row);
    setAcceptedQtyInput(row.accepted_qty != null ? String(row.accepted_qty) : '');
    setActionDialogType('accepted_qty');
  };

  const openReceivedQtyDialog = (row: POItem) => {
    setActionRow(row);
    setReceivedQtyInput(String(row.received_qty));
    setActionDialogType('received_qty');
  };

  const openStatusDialog = (row: POItem) => {
    setActionRow(row);
    setStatusInput(row.status);
    setActionDialogType('status');
  };

  const closeDialog = () => {
    setActionDialogType(null);
    setActionRow(null);
  };

  const handleSaveAcceptedQty = async () => {
    if (!actionRow) return;
    const qty = parseInt(acceptedQtyInput);
    if (isNaN(qty) || qty < 0) {
      toast.error('Please enter a valid quantity');
      return;
    }
    setIsSaving(true);
    try {
      const result = await api.purchaseOrders.updateAmazonItemAcceptedQty(actionRow.id, qty) as any;
      setPoData(prev => prev.map(p => p.id === actionRow.id ? { ...p, accepted_qty: qty } : p));
      if (result?.inventory_deducted > 0) {
        if (result.inventory_shortfall > 0) {
          toast.warning(`Accepted qty set to ${qty}. Deducted ${result.inventory_deducted} from inventory. Shortfall: ${result.inventory_shortfall} units.`);
        } else {
          toast.success(`Accepted qty set to ${qty}. Deducted ${result.inventory_deducted} units from packed inventory.`);
        }
      } else {
        toast.success(`Accepted qty updated to ${qty}`);
      }
      closeDialog();
    } catch {
      toast.error('Failed to update accepted qty');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveReceivedQty = async () => {
    if (!actionRow) return;
    const qty = parseInt(receivedQtyInput);
    if (isNaN(qty) || qty < 0) {
      toast.error('Please enter a valid quantity');
      return;
    }
    setIsSaving(true);
    try {
      await api.purchaseOrders.updateAmazonItemReceivedQty(actionRow.id, qty);
      setPoData(prev => prev.map(p => p.id === actionRow.id
        ? { ...p, received_qty: qty, pending_qty: Math.max(0, p.ordered_qty - qty) }
        : p
      ));
      toast.success(`Received qty updated to ${qty}`);
      closeDialog();
    } catch {
      toast.error('Failed to update received qty');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveStatus = async () => {
    if (!actionRow || statusInput === actionRow.status) { closeDialog(); return; }
    const dbStatus = statusInput;
    setIsSaving(true);
    try {
      await api.purchaseOrders.updateAmazonItemStatus(actionRow.id, { status: dbStatus });
      setPoData(prev => prev.map(p => p.id === actionRow.id ? { ...p, status: statusInput } : p));
      toast.success(`Status updated to ${statusInput}`);
      closeDialog();
    } catch {
      toast.error('Failed to update status');
    } finally {
      setIsSaving(false);
    }
  };

  const fetchAmazonPOs = useCallback(async (p: number, statusFilter: string, searchQuery: string, dateFrom: string, dateTo: string) => {
    try {
      setIsLoading(true);
      const params: Record<string, any> = { page: p, page_size: 50 };
      if (statusFilter !== 'all') params.status = statusFilter;
      if (searchQuery.trim()) params.search = searchQuery.trim();
      if (dateFrom) params.start_date = dateFrom;
      if (dateTo) params.end_date = dateTo;

      const response = await api.purchaseOrders.getAmazon(params) as any;
      const transformedPOs = (response.items || []).map((po: any) => ({
        id: po.id,
        po_number: po.po_number,
        po_date: po.order_date ? new Date(po.order_date).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : '-',
        orderDateRaw: po.order_date ? po.order_date.slice(0, 10) : null,
        asin: po.amazon_id || '',
        product_name: po.product_name || po.productName || '',
        ordered_qty: po.quantity,
        accepted_qty: po.accepted_quantity ?? null,
        mapped_sku: po.asg_sku || po.asgSku || '',
        received_qty: po.received_quantity || 0,
        pending_qty: Math.max(0, (po.quantity || 0) - (po.received_quantity || 0)),
        unit_cost: po.unit_price ?? null,
        total_cost: po.total_amount ?? null,
        po_expiry: po.expected_delivery_date ? new Date(po.expected_delivery_date).toLocaleDateString('en-US', { day: 'numeric', month: 'short' }) : '-',
        status: po.status || 'Created',
        city: po.ship_to_city || '—',
        state: po.ship_to_state || '—',
      }));
      setPoData(transformedPOs);
      setTotal(response.total || 0);
      setTotalPages(response.total_pages || 1);
    } catch (error) {
      console.error('Error fetching Amazon purchase orders:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch unfiltered stats once for KPI cards
  useEffect(() => {
    (api.purchaseOrders as any).getAmazonStats().then((s: any) => setStatsData(s)).catch(() => {});
  }, []);

  // Initial load
  useEffect(() => {
    fetchAmazonPOs(1, filters.status, search, filters.dateFrom, filters.dateTo);
  }, [fetchAmazonPOs]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch when filters change — reset to page 1
  const prevFiltersRef = useRef({ status: filters.status, search, dateFrom: filters.dateFrom, dateTo: filters.dateTo });
  useEffect(() => {
    const prev = prevFiltersRef.current;
    const changed =
      prev.status !== filters.status ||
      prev.search !== search ||
      prev.dateFrom !== filters.dateFrom ||
      prev.dateTo !== filters.dateTo;
    if (changed) {
      prevFiltersRef.current = { status: filters.status, search, dateFrom: filters.dateFrom, dateTo: filters.dateTo };
      setPage(1);
      fetchAmazonPOs(1, filters.status, search, filters.dateFrom, filters.dateTo);
    }
  }, [filters.status, search, filters.dateFrom, filters.dateTo, fetchAmazonPOs]);

  const getStatusBadge = (status: string) => {
    return BADGE_STYLES[status] || 'bg-gray-50 text-gray-700 border-gray-200';
  };

  const gridColumns: GridColumn<POItem>[] = [
    {
      id: 'poNumber',
      header: 'PO Number',
      accessorKey: 'po_number',
      sortable: true,
      sticky: true,
      width: 170,
      minWidth: 150,
      cell: (row) => <span className="font-medium text-primary">{row.po_number}</span>,
    },
    {
      id: 'poDate',
      header: 'PO Date',
      accessorKey: 'po_date',
      width: 130,
      minWidth: 110,
      cell: (row) => <span className="text-muted-foreground">{row.po_date}</span>,
    },
    {
      id: 'asin',
      header: 'Amazon ASIN',
      accessorKey: 'asin',
      width: 155,
      minWidth: 130,
      cell: (row) => <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{row.asin}</code>,
    },
    {
      id: 'productName',
      header: 'Product Name',
      accessorKey: 'product_name',
      sortable: true,
      width: 300,
      minWidth: 200,
      wrap: true,
      cell: (row) => (
        <span
          className="font-medium text-sm leading-snug"
          style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
          title={row.product_name ?? undefined}
        >
          {row.product_name || '—'}
        </span>
      ),
    },
    {
      id: 'orderedQty',
      header: 'Ordered Qty',
      accessorKey: 'ordered_qty',
      sortable: true,
      width: 110,
      minWidth: 90,
      align: 'right',
      cell: (row) => <span className="font-medium">{row.ordered_qty.toLocaleString()}</span>,
    },
    {
      id: 'acceptedQty',
      header: 'Accepted Qty',
      accessorKey: 'accepted_qty',
      sortable: true,
      width: 120,
      minWidth: 100,
      align: 'right',
      cell: (row) => (
        row.accepted_qty != null ? (
          <span className={`font-medium ${row.accepted_qty < row.ordered_qty ? 'text-amber-600' : 'text-emerald-600'}`}>
            {row.accepted_qty.toLocaleString()}
          </span>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        )
      ),
    },
    {
      id: 'mappedSku',
      header: 'ASG SKU',
      accessorKey: 'mapped_sku',
      sticky: true,
      width: 170,
      minWidth: 140,
      cell: (row) => row.mapped_sku ? (
        <code className="text-xs text-muted-foreground">{row.mapped_sku}</code>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    },
    {
      id: 'readyQty',
      header: 'Received Qty',
      accessorKey: 'received_qty',
      sortable: true,
      width: 110,
      minWidth: 90,
      align: 'right',
      cell: (row) => (
        <span className={row.received_qty > 0 ? 'font-medium' : 'text-muted-foreground'}>
          {row.received_qty.toLocaleString()}
        </span>
      ),
    },
    {
      id: 'pendingQty',
      header: 'Pending Qty',
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
      id: 'unitCost',
      header: 'Unit Cost',
      accessorKey: 'unit_cost',
      sortable: true,
      width: 110,
      minWidth: 90,
      align: 'right',
      cell: (row) => row.unit_cost != null && row.unit_cost > 0 ? (
        <span className="font-medium">₹{row.unit_cost.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
      ) : (
        <span className="text-muted-foreground text-xs">—</span>
      ),
    },
    {
      id: 'totalCost',
      header: 'Total Cost',
      accessorKey: 'total_cost',
      sortable: true,
      width: 130,
      minWidth: 110,
      align: 'right',
      cell: (row) => row.total_cost != null && row.total_cost > 0 ? (
        <span className="font-medium">₹{row.total_cost.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
      ) : (
        <span className="text-muted-foreground text-xs">—</span>
      ),
    },
    {
      id: 'poExpiry',
      header: 'PO Expiry',
      accessorKey: 'po_expiry',
      width: 130,
      minWidth: 110,
      cell: (row) => <span className="text-muted-foreground">{row.po_expiry}</span>,
    },
    {
      id: 'city',
      header: 'City',
      accessorKey: 'city',
      sortable: true,
      width: 130,
      minWidth: 100,
      cell: (row) => <span className="text-sm text-muted-foreground">{row.city}</span>,
    },
    {
      id: 'state',
      header: 'State',
      accessorKey: 'state',
      sortable: true,
      width: 130,
      minWidth: 100,
      cell: (row) => <span className="text-sm text-muted-foreground">{row.state}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      accessorKey: 'status',
      width: 130,
      minWidth: 110,
      align: 'center',
      cell: (row) => (
        <Badge variant="outline" className={getStatusBadge(row.status)}>
          {row.status}
        </Badge>
      ),
    },
    {
      id: 'action',
      header: 'Action',
      width: 80,
      minWidth: 60,
      align: 'center',
      cell: (row) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => openAcceptedQtyDialog(row)}>
              <PackagePlus className="h-4 w-4 mr-2" />
              {row.accepted_qty != null ? 'Edit Accepted Qty' : 'Set Accepted Qty'}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openReceivedQtyDialog(row); }}>
              <PackageCheck className="h-4 w-4 mr-2" />
              Edit Received Qty
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => openStatusDialog(row)}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Edit Status
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const gridState = useDataGrid(gridColumns, 'amazon-po');

  const poStatusOptions = [
    { label: 'All',        value: 'all' },
    { label: 'Created',    value: 'Created' },
    { label: 'Dispatched', value: 'Dispatched' },
    { label: 'In Transit', value: 'In Transit' },
    { label: 'Delivered',  value: 'Delivered' },
    { label: 'Delayed',    value: 'Delayed' },
    { label: 'Cancelled',  value: 'Cancelled' },
  ];

  // Search, status, and date are server-side. State is client-side (derived from address text).
  const filteredPoData = useMemo(() => {
    if (filters.state !== 'all') {
      return poData.filter((po) => po.state === filters.state);
    }
    return poData;
  }, [poData, filters.state]);

  const stateOptions = useMemo(() => {
    const states = [...new Set(poData.map(p => p.state).filter(s => s && s !== '—'))].sort();
    return [{ label: 'All', value: 'all' }, ...states.map(s => ({ label: s, value: s }))];
  }, [poData]);

  const totalPOs = statsData?.total_pos ?? new Set(poData.map(po => po.po_number)).size;
  const totalUnits = statsData?.total_units ?? poData.reduce((sum, po) => sum + po.ordered_qty, 0);
  const stats = useMemo(() => ({
    created:    statsData?.status_counts?.['Created'] ?? 0,
    dispatched: statsData?.status_counts?.['Dispatched'] ?? 0,
    inTransit:  statsData?.status_counts?.['In Transit'] ?? 0,
    delivered:  statsData?.status_counts?.['Delivered'] ?? 0,
    delayed:    statsData?.status_counts?.['Delayed'] ?? 0,
  }), [statsData]);

  const kpiCards = [
    { label: 'Created',    count: stats.created,    status: 'Created' },
    { label: 'Dispatched', count: stats.dispatched, status: 'Dispatched' },
    { label: 'In Transit', count: stats.inTransit,  status: 'In Transit' },
    { label: 'Delivered',  count: stats.delivered,  status: 'Delivered' },
    { label: 'Delayed',    count: stats.delayed,    status: 'Delayed' },
  ];

  if (isLoading) {
    return (
      <ProtectedRoute>
        <div className="p-6 flex items-center justify-center">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
            <p className="text-muted-foreground">Loading Amazon purchase orders...</p>
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
          <div className="flex items-center gap-3 p-4 bg-card border rounded-xl">
            <div className="flex items-center justify-center h-10 w-10 rounded-full bg-blue-100 text-blue-600">
              <ShoppingCart className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total POs</p>
              <p className="text-xl font-bold">{totalPOs}</p>
              <p className="text-xs text-muted-foreground">{totalUnits.toLocaleString()} units</p>
            </div>
          </div>
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
            {filteredPoData.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                onClick={() => exportToCSV(
                  filteredPoData.map(p => ({
                    'PO Number': p.po_number,
                    'PO Date': p.po_date,
                    'ASIN': p.asin,
                    'Product': p.product_name,
                    'Ordered Qty': p.ordered_qty,
                    'Accepted Qty': p.accepted_qty ?? '',
                    'ASG SKU': p.mapped_sku,
                    'Received Qty': p.received_qty,
                    'Pending Qty': p.pending_qty,
                    'Unit Cost': p.unit_cost ?? '',
                    'Total Cost': p.total_cost ?? '',
                    'Status': p.status,
                  })),
                  'amazon_po'
                )}
              >
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            )}
          </div>
        </FilterBar>

        {/* Data Grid */}
        {filteredPoData.length > 0 ? (
          <>
            <DataGrid data={filteredPoData} gridState={gridState} />
            <div className="flex items-center justify-between pt-1">
              <p className="text-sm text-muted-foreground">{total.toLocaleString()} line items</p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => { const p = Math.max(1, page - 1); setPage(p); fetchAmazonPOs(p, filters.status, search, filters.dateFrom, filters.dateTo); }} disabled={page === 1 || isLoading}>
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
                <Button variant="outline" size="sm" onClick={() => { const p = Math.min(totalPages, page + 1); setPage(p); fetchAmazonPOs(p, filters.status, search, filters.dateFrom, filters.dateTo); }} disabled={page === totalPages || isLoading}>
                  Next
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="text-center py-12 text-muted-foreground border-2 border-dashed rounded-lg">
            <ShoppingCart className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No purchase orders found</p>
          </div>
        )}
      </div>

      {/* Accepted Qty Dialog */}
      <Dialog open={actionDialogType === 'accepted_qty'} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {actionRow?.accepted_qty != null ? 'Edit Accepted Qty' : 'Set Accepted Qty'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {actionRow && (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{actionRow.po_number}</span>
                {' — '}{actionRow.product_name || actionRow.asin}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Ordered: <strong>{actionRow?.ordered_qty}</strong>
            </p>
            <Input
              type="number"
              min={0}
              placeholder="Enter accepted quantity"
              value={acceptedQtyInput}
              onChange={(e) => setAcceptedQtyInput(e.target.value)}
              autoFocus
            />
            {actionRow && acceptedQtyInput !== '' && Number(acceptedQtyInput) < actionRow.ordered_qty && (
              <p className="text-xs text-amber-600">
                Partial shipment: {Number(acceptedQtyInput)} of {actionRow.ordered_qty} units
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={isSaving}>Cancel</Button>
            <Button onClick={handleSaveAcceptedQty} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Received Qty Dialog */}
      <Dialog open={actionDialogType === 'received_qty'} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Received Qty</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {actionRow && (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{actionRow.po_number}</span>
                {' — '}{actionRow.product_name || actionRow.asin}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Ordered: <strong>{actionRow?.ordered_qty}</strong>
              {actionRow?.accepted_qty != null && <>{' · '}Accepted: <strong>{actionRow.accepted_qty}</strong></>}
            </p>
            <Input
              type="number"
              min={0}
              placeholder="Enter received quantity"
              value={receivedQtyInput}
              onChange={(e) => setReceivedQtyInput(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={isSaving}>Cancel</Button>
            <Button onClick={handleSaveReceivedQty} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Status Dialog */}
      <Dialog open={actionDialogType === 'status'} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Status</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {actionRow && (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{actionRow.po_number}</span>
                {' — '}{actionRow.product_name || actionRow.asin}
              </p>
            )}
            <select
              className="w-full h-9 text-sm border border-border rounded-md px-3 bg-background text-foreground"
              value={statusInput}
              onChange={(e) => setStatusInput(e.target.value)}
            >
              {STATUS_OPTIONS.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={isSaving}>Cancel</Button>
            <Button onClick={handleSaveStatus} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Update'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ProtectedRoute>
  );
}

export default function AmazonPOPage() {
  return (
    <Suspense>
      <AmazonPOPageContent />
    </Suspense>
  );
}
