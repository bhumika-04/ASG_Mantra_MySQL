'use client';

import { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react';
import { useFilter, computeDateRange, FilterMode } from '@/contexts/FilterContext';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import React from 'react';
import { FilterBar } from '@/components/ui/filter-bar';
import { FilterPanel, FilterValues, DEFAULT_FILTER_VALUES } from '@/components/ui/filter-panel';
import { DataGrid, GridColumn, useDataGrid, ViewOptionsButton } from '@/components/ui/data-grid';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
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
import { fetchAllPages } from '@/lib/export-all';
import { toast } from 'sonner';
import {
  ShoppingCart,
  CheckCircle2,
  Clock,
  XCircle,
  AlertCircle,
  Truck,
  Download,
  MoreVertical,
  PackagePlus,
  PackageCheck,
  RefreshCw,
  Calendar,
} from 'lucide-react';
import { getPoRowClass, getPoRowBgColor } from '@/lib/po-status';
import api from '@/lib/api';
import { fmtDate, toTitleCase } from '@/lib/format';

// KPI config keyed by DB status name
const KPI_CONFIG: Record<string, { icon: React.ReactNode; color: string; bg: string; desc: string }> = {
  'Created':    { icon: <Clock className="h-5 w-5" />,        color: 'text-orange-600',  bg: 'bg-orange-100',  desc: 'Awaiting dispatch' },
  'Dispatched': { icon: <Truck className="h-5 w-5" />,        color: 'text-blue-600',    bg: 'bg-blue-100',    desc: 'In transit' },
  'In Transit': { icon: <AlertCircle className="h-5 w-5" />,  color: 'text-yellow-600',  bg: 'bg-yellow-100',  desc: 'In transit' },
  'Delivered':  { icon: <CheckCircle2 className="h-5 w-5" />, color: 'text-emerald-600', bg: 'bg-emerald-100', desc: 'Completed' },
  'Delayed':    { icon: <AlertCircle className="h-5 w-5" />,  color: 'text-red-600',     bg: 'bg-red-100',     desc: 'Delayed' },
  'Expired':    { icon: <XCircle className="h-5 w-5" />,      color: 'text-rose-600',    bg: 'bg-rose-100',    desc: 'Past expiry date' },
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
  'Expired':    'bg-red-50 text-red-700 border-red-200',
};

const STATUS_OPTIONS = ['Created', 'Dispatched', 'In Transit', 'Delivered', 'Delayed', 'Cancelled'];


interface POItem {
  id: number;
  po_id: number;
  po_number: string;
  po_date: string;
  orderDateRaw: string | null;
  asin: string;
  product_name: string;
  ordered_qty: number;
  accepted_qty: number | null;
  mapped_sku: string;
  received_qty: number | null;
  pending_qty: number;
  unit_cost: number | null;
  total_cost: number | null;
  po_expiry: string;
  expectedDateRaw: string | null;
  cancellationDateRaw: string | null;
  shipWindowEndDateRaw: string | null;
  dispatch_date: string | null;
  courier: string | null;
  status: string;
  po_status: string;
  city: string;
  state: string;
}

// Shared by the grid fetch and the export so a CSV can never drift from what is
// on screen.
const toPOItem = (po: any): POItem => ({
id: po.id,
  po_id: po.po_id,
  po_number: po.po_number,
  po_date: po.order_date ? fmtDate(po.order_date) : '-',
  orderDateRaw: po.order_date ? po.order_date.slice(0, 10) : null,
  asin: po.amazon_id || '',
  product_name: toTitleCase(po.product_name || po.productName || ''),
  ordered_qty: po.quantity,
  accepted_qty: po.accepted_quantity ?? null,
  mapped_sku: po.asg_sku || po.asgSku || '',
  received_qty: po.received_quantity ?? null,
  pending_qty: po.accepted_quantity != null
    ? Math.max(0, (po.quantity || 0) - po.accepted_quantity)
    : Math.max(0, (po.quantity || 0) - (po.received_quantity || 0)),
  unit_cost: po.unit_price ?? null,
  total_cost: po.total_amount ?? null,
  po_expiry: po.po_cancellation_date ? fmtDate(po.po_cancellation_date)
    : po.expected_delivery_date ? fmtDate(po.expected_delivery_date) : '-',
  expectedDateRaw: po.expected_delivery_date || null,
  cancellationDateRaw: po.po_cancellation_date || null,
  shipWindowEndDateRaw: po.ship_window_end_date ? po.ship_window_end_date.slice(0, 10) : null,
  dispatch_date: po.dispatch_date || null,
  courier: po.courier || null,
  status: po.status || 'Created',
  po_status: po.po_status || 'Created',
  city: po.ship_to_city || '—',
  state: po.ship_to_state || '—',
});

function AmazonPOPageContent() {
  const { filterMode, customStart, customEnd, globalSearch, setGlobalSearchRaw } = useFilter();
  const [gridSearch, setGridSearch] = useState('');
  const [filters, setFilters] = useState<FilterValues>(DEFAULT_FILTER_VALUES);
  const [poData, setPoData] = useState<POItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;
  const [statsData, setStatsData] = useState<{ status_counts: Record<string, number>; total_pos: number; total_units: number } | null>(null);
  const [allStates, setAllStates] = useState<string[]>([]);
  const [carriers, setCarriers] = useState<string[]>([]);
  const [statsKey, setStatsKey] = useState(0);

  // Action state
  const [actionRow, setActionRow] = useState<POItem | null>(null);
  const [acceptedQtyInput, setAcceptedQtyInput] = useState('');
  const [receivedQtyInput, setReceivedQtyInput] = useState('');
  const [statusInput, setStatusInput] = useState('');
  const [dispatchDateInput, setDispatchDateInput] = useState('');
  const [courierInput, setCourierInput] = useState('');
  const [actionDialogType, setActionDialogType] = useState<'accepted_qty' | 'received_qty' | 'status' | 'dispatch_date' | 'courier' | 'expected_date' | null>(null);
  const [expectedDateInput, setExpectedDateInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const openAcceptedQtyDialog = (row: POItem) => {
    setActionRow(row);
    setAcceptedQtyInput(row.accepted_qty != null ? String(row.accepted_qty) : '');
    setActionDialogType('accepted_qty');
  };

  const openReceivedQtyDialog = (row: POItem) => {
    setActionRow(row);
    setReceivedQtyInput(row.received_qty != null ? String(row.received_qty) : '');
    setActionDialogType('received_qty');
  };

  const openStatusDialog = (row: POItem) => {
    setActionRow(row);
    setStatusInput(row.po_status);
    setActionDialogType('status');
  };

  const openDispatchDateDialog = (row: POItem) => {
    setActionRow(row);
    setDispatchDateInput(row.dispatch_date || '');
    setActionDialogType('dispatch_date');
  };

  const openCourierDialog = (row: POItem) => {
    setActionRow(row);
    setCourierInput(row.courier || '');
    setActionDialogType('courier');
  };

  const openExpectedDateDialog = (row: POItem) => {
    setActionRow(row);
    setExpectedDateInput(row.expectedDateRaw || '');
    setActionDialogType('expected_date');
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
      setPoData(prev => prev.map(p => p.id === actionRow.id
        ? { ...p, accepted_qty: qty, pending_qty: Math.max(0, p.ordered_qty - qty) }
        : p));
      const moved = result?.inventory_deducted ?? 0;
      if (moved > 0) {
        if (result.inventory_shortfall > 0) {
          toast.warning(`Accepted qty set to ${qty}. Deducted ${moved} from inventory. Shortfall: ${result.inventory_shortfall} units.`);
        } else {
          toast.success(`Accepted qty set to ${qty}. Deducted ${moved} units from packed inventory.`);
        }
      } else if (moved < 0) {
        toast.success(`Accepted qty set to ${qty}. Returned ${-moved} units to packed inventory.`);
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
    if (!actionRow || statusInput === actionRow.po_status) { closeDialog(); return; }
    const dbStatus = statusInput;
    setIsSaving(true);
    try {
      await api.purchaseOrders.updateAmazonPOStatus(actionRow.po_id, { status: dbStatus });
      setPoData(prev => prev.map(p => p.po_id === actionRow.po_id
        ? { ...p, status: statusInput, po_status: statusInput }
        : p));
      setStatsKey(k => k + 1);
      setPage(1);
      fetchAmazonPOs(1, filters.status, globalSearch, effectiveDateFrom, effectiveDateTo, filters.state, true);
      toast.success(`Status updated to ${statusInput}`);
      closeDialog();
    } catch {
      toast.error('Failed to update status');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveDispatchDate = async () => {
    if (!actionRow) return;
    setIsSaving(true);
    try {
      const dateVal = dispatchDateInput.trim() || null;
      await (api.purchaseOrders as any).updateAmazonPODispatchDate(actionRow.po_id, dateVal);
      setPoData(prev => prev.map(p => p.po_id === actionRow.po_id ? { ...p, dispatch_date: dateVal } : p));
      toast.success(dateVal ? `Dispatch date set to ${fmtDate(dateVal)}` : 'Dispatch date cleared');
      closeDialog();
    } catch {
      toast.error('Failed to save dispatch date');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveCourier = async () => {
    if (!actionRow) return;
    setIsSaving(true);
    try {
      const val = courierInput.trim() || null;
      await (api.purchaseOrders as any).updateAmazonPOCourier(actionRow.po_id, val);
      setPoData(prev => prev.map(p => p.po_id === actionRow.po_id ? { ...p, courier: val } : p));
      toast.success(val ? `Courier set to "${val}"` : 'Courier cleared');
      closeDialog();
    } catch {
      toast.error('Failed to save courier');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveExpectedDate = async () => {
    if (!actionRow) return;
    setIsSaving(true);
    try {
      const dateVal = expectedDateInput.trim() || null;
      await (api.purchaseOrders as any).updateAmazonItemExpectedDate(actionRow.id, dateVal);
      setPoData(prev => prev.map(p => p.id === actionRow.id
        ? {
            ...p,
            expectedDateRaw: dateVal,
            po_expiry: !p.cancellationDateRaw
              ? (dateVal ? fmtDate(dateVal) : '—')
              : p.po_expiry,
          }
        : p
      ));
      toast.success(dateVal ? `Expected date set to ${fmtDate(dateVal)}` : 'Expected date cleared');
      closeDialog();
    } catch {
      toast.error('Failed to save expected date');
    } finally {
      setIsSaving(false);
    }
  };

  // Global filter overrides local FilterPanel date range when active
  const { effectiveDateFrom, effectiveDateTo } = useMemo(() => {
    if (filterMode !== 'all') {
      const { start_date, end_date } = computeDateRange(filterMode as FilterMode, customStart, customEnd);
      return { effectiveDateFrom: start_date || '', effectiveDateTo: end_date || '' };
    }
    return { effectiveDateFrom: filters.dateFrom, effectiveDateTo: filters.dateTo };
  }, [filterMode, customStart, customEnd, filters.dateFrom, filters.dateTo]);

  const fetchSeqRef = useRef(0);
  const fetchAmazonPOs = useCallback(async (p: number, statusFilter: string, searchQuery: string, dateFrom: string, dateTo: string, stateFilter: string, silent = false) => {
    const seq = ++fetchSeqRef.current;
    try {
      if (!silent) setIsLoading(true);
      const params: Record<string, any> = { page: p, page_size: 50 };
      if (statusFilter !== 'all') params.status = statusFilter;
      if (stateFilter !== 'all') params.state = stateFilter;
      if (searchQuery.trim()) {
        params.search = searchQuery.trim();
        // PO number search bypasses date filter — POs should be findable regardless of period
      } else {
        if (dateFrom) params.start_date = dateFrom;
        if (dateTo) params.end_date = dateTo;
      }

      const response = await api.purchaseOrders.getAmazon(params) as any;
      if (fetchSeqRef.current !== seq) return;
      const transformedPOs = (response.items || []).map(toPOItem);
      setPoData(transformedPOs);
      setTotal(response.total || 0);
    } catch (error) {
      if (fetchSeqRef.current !== seq) return;
      console.error('Error fetching Amazon purchase orders:', error);
    } finally {
      if (fetchSeqRef.current === seq) setIsLoading(false);
    }
  }, []);

  // Fetch all distinct states once on mount for the state filter dropdown
  useEffect(() => {
    (api.purchaseOrders as any).getAmazonStates()
      .then((res: any) => setAllStates(res?.states ?? []))
      .catch(() => {});
    (api.purchaseOrders as any).getCarriers()
      .then((res: any) => setCarriers(res?.carriers ?? []))
      .catch(() => {});
  }, []);

  // Fetch date-filtered stats for KPI cards — re-runs when global filter changes
  useEffect(() => {
    if (filterMode === 'custom' && !customStart) return;
    const params: Record<string, string> = {};
    if (effectiveDateFrom) params.start_date = effectiveDateFrom;
    if (effectiveDateTo) params.end_date = effectiveDateTo;
    (api.purchaseOrders as any).getAmazonStats(Object.keys(params).length ? params : undefined)
      .then((s: any) => setStatsData(s)).catch(() => {});
  }, [filterMode, customStart, effectiveDateFrom, effectiveDateTo, statsKey]);

  // Initial load
  useEffect(() => {
    fetchAmazonPOs(1, filters.status, globalSearch, effectiveDateFrom, effectiveDateTo, filters.state);
  }, [fetchAmazonPOs]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch when filters or global date filter change — reset to page 1
  const prevFiltersRef = useRef({ status: filters.status, state: filters.state, search: globalSearch, dateFrom: effectiveDateFrom, dateTo: effectiveDateTo });
  useEffect(() => {
    if (filterMode === 'custom' && !customStart) return;
    const prev = prevFiltersRef.current;
    const changed =
      prev.status !== filters.status ||
      prev.state !== filters.state ||
      prev.search !== globalSearch ||
      prev.dateFrom !== effectiveDateFrom ||
      prev.dateTo !== effectiveDateTo;
    if (changed) {
      prevFiltersRef.current = { status: filters.status, state: filters.state, search: globalSearch, dateFrom: effectiveDateFrom, dateTo: effectiveDateTo };
      setPage(1);
      fetchAmazonPOs(1, filters.status, globalSearch, effectiveDateFrom, effectiveDateTo, filters.state);
    }
  }, [filterMode, customStart, filters.status, filters.state, globalSearch, effectiveDateFrom, effectiveDateTo, fetchAmazonPOs]);

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
      cell: (row) => <span className="font-medium">{row.ordered_qty.toLocaleString('en-IN')}</span>,
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
            {row.accepted_qty.toLocaleString('en-IN')}
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
        <span className={(row.received_qty ?? 0) > 0 ? 'font-medium' : 'text-muted-foreground'}>
          {(row.received_qty ?? 0).toLocaleString('en-IN')}
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
          {row.pending_qty.toLocaleString('en-IN')}
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
      id: 'dispatchDate',
      header: 'Dispatch Date',
      accessorKey: 'dispatch_date',
      width: 140,
      minWidth: 110,
      cell: (row) => row.dispatch_date ? (
        <span className="text-sm text-emerald-700 font-medium">{fmtDate(row.dispatch_date)}</span>
      ) : (
        <span className="text-muted-foreground text-xs">—</span>
      ),
    },
    {
      id: 'courier',
      header: 'Courier',
      accessorKey: 'courier',
      width: 140,
      minWidth: 100,
      cell: (row) => row.courier ? (
        <span className="text-sm text-slate-700">{row.courier}</span>
      ) : (
        <span className="text-muted-foreground text-xs">—</span>
      ),
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
            <DropdownMenuItem onClick={() => openExpectedDateDialog(row)}>
              <Calendar className="h-4 w-4 mr-2" />
              {row.expectedDateRaw ? 'Edit Expected Date' : 'Set Expected Date'}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openDispatchDateDialog(row)}>
              <Calendar className="h-4 w-4 mr-2" />
              {row.dispatch_date ? 'Edit Dispatch Date' : 'Set Dispatch Date'}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openCourierDialog(row)}>
              <Truck className="h-4 w-4 mr-2" />
              {row.courier ? 'Edit Courier' : 'Set Courier'}
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

  // Exports every row matching the active filters, not just the page on screen.
  const [isExporting, setIsExporting] = useState(false);
  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      const base: Record<string, any> = {};
      if (filters.status !== 'all') base.status = filters.status;
      if (filters.state !== 'all') base.state = filters.state;
      if (globalSearch.trim()) {
        base.search = globalSearch.trim();
      } else {
        if (effectiveDateFrom) base.start_date = effectiveDateFrom;
        if (effectiveDateTo) base.end_date = effectiveDateTo;
      }
      const { rows, total, truncated } = await fetchAllPages<any>(
        (page, page_size) => api.purchaseOrders.getAmazon({ ...base, page, page_size }) as any,
      );
      let items = rows.map(toPOItem);
      // Grid search is client-side, so apply it to the full set too
      if (gridSearch.trim()) {
        const q = gridSearch.toLowerCase();
        items = items.filter(p =>
          (p.po_number || '').toLowerCase().includes(q) ||
          (p.product_name || '').toLowerCase().includes(q) ||
          (p.asin || '').toLowerCase().includes(q) ||
          (p.mapped_sku || '').toLowerCase().includes(q));
      }
      exportToCSV(items.map(p => ({
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
        'Dispatch Date': p.dispatch_date ? fmtDate(p.dispatch_date) : '',
        'Courier': p.courier || '',
        'Status': p.status,
      })), 'amazon_po');
      toast.success(
        truncated
          ? `Exported ${items.length.toLocaleString('en-IN')} of ${total.toLocaleString('en-IN')} rows (export limit reached)`
          : `Exported ${items.length.toLocaleString('en-IN')} rows`);
    } catch {
      toast.error('Export failed');
    } finally {
      setIsExporting(false);
    }
  }, [filters.status, filters.state, globalSearch, gridSearch, effectiveDateFrom, effectiveDateTo]);

  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage);
    fetchAmazonPOs(newPage, filters.status, globalSearch, effectiveDateFrom, effectiveDateTo, filters.state);
  }, [filters.status, globalSearch, effectiveDateFrom, effectiveDateTo, filters.state, fetchAmazonPOs]);

  const poStatusOptions = [
    { label: 'All',        value: 'all' },
    { label: 'Created',    value: 'Created' },
    { label: 'Dispatched', value: 'Dispatched' },
    { label: 'In Transit', value: 'In Transit' },
    { label: 'Delivered',  value: 'Delivered' },
    { label: 'Delayed',    value: 'Delayed' },
    { label: 'Cancelled',  value: 'Cancelled' },
    { label: 'Expired',    value: 'Expired' },
  ];

  // Global search + server filters are applied server-side. Grid search is client-side only.
  const filteredPoData = gridSearch.trim()
    ? poData.filter(p => {
        const q = gridSearch.toLowerCase();
        return (p.po_number || '').toLowerCase().includes(q) ||
               (p.product_name || '').toLowerCase().includes(q) ||
               (p.asin || '').toLowerCase().includes(q) ||
               (p.mapped_sku || '').toLowerCase().includes(q);
      })
    : poData;

  const stateOptions = useMemo(() => {
    return [{ label: 'All', value: 'all' }, ...allStates.map(s => ({ label: s, value: s }))];
  }, [allStates]);

  const totalPOs = statsData?.total_pos ?? new Set(poData.map(po => po.po_number)).size;
  const totalUnits = statsData?.total_units ?? poData.reduce((sum, po) => sum + po.ordered_qty, 0);
  const stats = useMemo(() => ({
    created:    statsData?.status_counts?.['Created'] ?? 0,
    dispatched: statsData?.status_counts?.['Dispatched'] ?? 0,
    inTransit:  statsData?.status_counts?.['In Transit'] ?? 0,
    delivered:  statsData?.status_counts?.['Delivered'] ?? 0,
    delayed:    statsData?.status_counts?.['Delayed'] ?? 0,
    expired:    statsData?.status_counts?.['Expired'] ?? 0,
  }), [statsData]);

  const kpiCards = [
    { label: 'Created',    count: stats.created,    status: 'Created' },
    { label: 'Dispatched', count: stats.dispatched, status: 'Dispatched' },
    { label: 'In Transit', count: stats.inTransit,  status: 'In Transit' },
    { label: 'Delivered',  count: stats.delivered,  status: 'Delivered' },
    { label: 'Delayed',    count: stats.delayed,    status: 'Delayed' },
    { label: 'Expired',    count: stats.expired,    status: 'Expired' },
  ];

  if (isLoading) {
    return (
      <ProtectedRoute>
        <div className="p-6 space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-4 bg-card border rounded-xl">
                <Skeleton className="h-10 w-10 rounded-full flex-shrink-0" />
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-6 w-10" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-9 w-32" />
            <Skeleton className="h-9 w-28" />
          </div>
          <div className="rounded-lg border bg-card overflow-hidden">
            <div className="p-3 border-b bg-muted/50 flex gap-4">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-4 w-20" />)}
            </div>
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="p-3 border-b flex gap-4 items-center">
                <Skeleton className="h-4 w-6" />
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="p-6 space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
          <div className="flex items-center gap-3 p-4 bg-card border rounded-xl">
            <div className="flex items-center justify-center h-10 w-10 rounded-full bg-blue-100 text-blue-600">
              <ShoppingCart className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total POs</p>
              <p className="text-xl font-bold">{totalPOs}</p>
              <p className="text-xs text-muted-foreground">{totalUnits.toLocaleString('en-IN')} units · {total.toLocaleString('en-IN')} items</p>
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
          searchPlaceholder="Search PO number, product, ASIN or SKU..."
          searchValue={gridSearch}
          onSearchChange={setGridSearch}
        >
          <div className="flex items-center gap-2 ml-auto">
            <FilterPanel
              values={filters}
              onChange={(key, value) => setFilters(prev => ({ ...prev, [key]: value }))}
              onClear={() => { setFilters(DEFAULT_FILTER_VALUES); setGlobalSearchRaw(''); setGridSearch(''); }}
              showDateRange={filterMode === 'all'}
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
                onClick={handleExport}
                disabled={isExporting}
              >
                <Download className="h-4 w-4 mr-2" />
                {isExporting ? 'Exporting…' : 'Export'}
              </Button>
            )}
          </div>
        </FilterBar>

        {/* Data Grid */}
        {filteredPoData.length > 0 ? (
          <>
            <DataGrid
              data={filteredPoData}
              gridState={gridState}
              getRowClass={(row) => getPoRowClass(row.status, row.shipWindowEndDateRaw)}
              getRowBgColor={(row) => getPoRowBgColor(row.status, row.shipWindowEndDateRaw)}
              serverPagination={gridSearch.trim() ? undefined : { total, page, pageSize: PAGE_SIZE, onPageChange: handlePageChange }}
            />
            <p className="text-sm text-muted-foreground pt-1">{total.toLocaleString('en-IN')} line items from {totalPOs} POs</p>
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

      {/* Set/Edit Courier Dialog */}
      <Dialog open={actionDialogType === 'courier'} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{actionRow?.courier ? 'Edit Courier' : 'Set Courier'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {actionRow && (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{actionRow.po_number}</span>
              </p>
            )}
            <Input
              list="amz-carrier-list"
              placeholder="Type or select a carrier…"
              value={courierInput}
              onChange={(e) => setCourierInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveCourier()}
              autoFocus
            />
            <datalist id="amz-carrier-list">
              {carriers.map(c => <option key={c} value={c} />)}
            </datalist>
            {courierInput && (
              <Button variant="ghost" size="sm" className="text-xs text-red-600 h-7 px-2" onClick={() => setCourierInput('')}>
                Clear
              </Button>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={isSaving}>Cancel</Button>
            <Button onClick={handleSaveCourier} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Set/Edit Dispatch Date Dialog */}
      <Dialog open={actionDialogType === 'dispatch_date'} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{actionRow?.dispatch_date ? 'Edit Dispatch Date' : 'Set Dispatch Date'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {actionRow && (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{actionRow.po_number}</span>
              </p>
            )}
            <Input
              type="date"
              value={dispatchDateInput}
              onChange={(e) => setDispatchDateInput(e.target.value)}
              autoFocus
            />
            {dispatchDateInput && (
              <Button variant="ghost" size="sm" className="text-xs text-red-600 h-7 px-2" onClick={() => setDispatchDateInput('')}>
                Clear date
              </Button>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={isSaving}>Cancel</Button>
            <Button onClick={handleSaveDispatchDate} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Set/Edit Expected Date Dialog */}
      <Dialog open={actionDialogType === 'expected_date'} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{actionRow?.expectedDateRaw ? 'Edit Expected Date' : 'Set Expected Date'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {actionRow && (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{actionRow.po_number}</span>
                {' — '}{actionRow.product_name || actionRow.asin}
              </p>
            )}
            <Input
              type="date"
              value={expectedDateInput}
              onChange={(e) => setExpectedDateInput(e.target.value)}
              autoFocus
            />
            {expectedDateInput && (
              <Button variant="ghost" size="sm" className="text-xs text-red-600 h-7 px-2" onClick={() => setExpectedDateInput('')}>
                Clear date
              </Button>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={isSaving}>Cancel</Button>
            <Button onClick={handleSaveExpectedDate} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save'}
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
