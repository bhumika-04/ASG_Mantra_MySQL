'use client';

import { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useFilter, computeDateRange, FilterMode } from '@/contexts/FilterContext';
import { ProtectedRoute } from '@/components/ProtectedRoute';
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
  RefreshCw,
  Calendar,
} from 'lucide-react';
import api from '@/lib/api';
import { fmtDate, toTitleCase } from '@/lib/format';

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
  'Expired':    'bg-red-50 text-red-700 border-red-200',
};

const STATUS_OPTIONS = ['Created', 'Dispatched', 'In Transit', 'Delivered', 'Delayed', 'Cancelled'];

const NO_EXPIRY_OVERRIDE = new Set(['Delivered', 'Received', 'Cancelled', 'Closed', 'Expired', 'Dispatched', 'In Transit']);
function effStatus(base: string, expiryISO: string | null): string {
  if (NO_EXPIRY_OVERRIDE.has(base)) return base;
  if (!expiryISO) return base;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return (today.getTime() - new Date(expiryISO + 'T00:00:00').getTime()) / 86400000 >= 15 ? 'Expired' : base;
}
function getPoRowClass(status: string, expiryISO: string | null): string | undefined {
  if (['Delivered', 'Received', 'Cancelled', 'Closed', 'Dispatched', 'In Transit'].includes(status)) return undefined;
  if (!expiryISO) return undefined;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = Math.ceil((new Date(expiryISO + 'T00:00:00').getTime() - today.getTime()) / 86400000);
  if (d <= 7)  return 'bg-red-50 dark:bg-red-950/20';
  if (d <= 15) return 'bg-yellow-50 dark:bg-yellow-950/20';
  return undefined;
}
function getPoRowBgColor(status: string, expiryISO: string | null): string | undefined {
  if (['Delivered', 'Received', 'Cancelled', 'Closed', 'Dispatched', 'In Transit'].includes(status)) return undefined;
  if (!expiryISO) return undefined;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = Math.ceil((new Date(expiryISO + 'T00:00:00').getTime() - today.getTime()) / 86400000);
  if (d <= 7)  return 'rgb(254,242,242)';
  if (d <= 15) return 'rgb(254,252,232)';
  return undefined;
}

interface POItem {
  id: number;
  po_id: number;
  po_number: string;
  po_date: string;
  orderDateRaw: string | null;
  blinkitSku: string;
  product_name: string;
  ordered_qty: number;
  accepted_qty: number | null;
  received_qty: number | null;
  mapped_sku: string;
  pending_qty: number;
  unit_cost: number | null;
  total_cost: number | null;
  city: string;
  state: string;
  shipTo: string;
  delivery: string;
  deliveryDateRaw: string | null;
  po_expiry: string;
  expiryDateRaw: string | null;
  dispatch_date: string | null;
  courier: string | null;
  status: string;
  po_status: string;
}


function BlinkitPOPageContent() {
  const searchParams = useSearchParams();
  const { filterMode, setFilterMode, customStart, customEnd, globalSearch, setGlobalSearchRaw } = useFilter();
  const [gridSearch, setGridSearch] = useState('');
  // Initialise search from URL param and switch to All Time so date filter doesn't block the result
  useEffect(() => {
    const urlParam = searchParams.get('search');
    if (urlParam) {
      setGridSearch(urlParam);
      setGlobalSearchRaw(urlParam);
      setFilterMode('all');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [filters, setFilters] = useState<FilterValues>(DEFAULT_FILTER_VALUES);
  const [poData, setPoData] = useState<POItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [statsData, setStatsData] = useState<{ status_counts: Record<string, number>; total_pos: number; total_units: number } | null>(null);
  const [carriers, setCarriers] = useState<string[]>([]);
  const [statsKey, setStatsKey] = useState(0);

  // Action state
  const [actionRow, setActionRow] = useState<POItem | null>(null);
  const [acceptedQtyInput, setAcceptedQtyInput] = useState('');
  const [receivedQtyInput, setReceivedQtyInput] = useState('');
  const [statusInput, setStatusInput] = useState('');
  const [dispatchDateInput, setDispatchDateInput] = useState('');
  const [courierInput, setCourierInput] = useState('');
  const [actionDialogType, setActionDialogType] = useState<'accepted_qty' | 'received_qty' | 'status' | 'dispatch_date' | 'courier' | 'delivery_date' | 'expiry_date' | null>(null);
  const [deliveryDateInput, setDeliveryDateInput] = useState('');
  const [expiryDateInput, setExpiryDateInput] = useState('');
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

  const openDeliveryDateDialog = (row: POItem) => {
    setActionRow(row);
    setDeliveryDateInput(row.deliveryDateRaw || '');
    setActionDialogType('delivery_date');
  };

  const openExpiryDateDialog = (row: POItem) => {
    setActionRow(row);
    setExpiryDateInput(row.expiryDateRaw || '');
    setActionDialogType('expiry_date');
  };

  const closeDialog = () => {
    setActionDialogType(null);
    setActionRow(null);
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
      await api.purchaseOrders.updateBlinkitItemReceivedQty(actionRow.id, qty);
      setPoData(prev => prev.map(p => p.id === actionRow.id ? { ...p, received_qty: qty } : p));
      toast.success(`Received qty updated to ${qty}`);
      closeDialog();
    } catch {
      toast.error('Failed to update received qty');
    } finally {
      setIsSaving(false);
    }
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
      const result = await api.purchaseOrders.updateBlinkitItemAcceptedQty(actionRow.id, qty) as any;
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

  const handleSaveStatus = async () => {
    if (!actionRow || statusInput === actionRow.po_status) { closeDialog(); return; }
    const dbStatus = statusInput;
    setIsSaving(true);
    try {
      await api.purchaseOrders.updateBlinkitPOStatus(actionRow.po_id, { status: dbStatus });
      setPoData(prev => prev.map(p => p.po_id === actionRow.po_id
        ? { ...p, status: effStatus(statusInput, p.expiryDateRaw), po_status: statusInput }
        : p));
      setStatsKey(k => k + 1);
      setPage(1);
      fetchBlinkitPOs(1, filters.status, globalSearch, effectiveDateFrom, effectiveDateTo, true);
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
      await (api.purchaseOrders as any).updateBlinkitPODispatchDate(actionRow.po_id, dateVal);
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
      await (api.purchaseOrders as any).updateBlinkitPOCourier(actionRow.po_id, val);
      setPoData(prev => prev.map(p => p.po_id === actionRow.po_id ? { ...p, courier: val } : p));
      toast.success(val ? `Courier set to "${val}"` : 'Courier cleared');
      closeDialog();
    } catch {
      toast.error('Failed to save courier');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveDeliveryDate = async () => {
    if (!actionRow) return;
    setIsSaving(true);
    try {
      const dateVal = deliveryDateInput.trim() || null;
      await (api.purchaseOrders as any).updateBlinkitPOExpectedDeliveryDate(actionRow.po_id, dateVal);
      setPoData(prev => prev.map(p => p.po_id === actionRow.po_id
        ? { ...p, delivery: dateVal ? fmtDate(dateVal) : '-', deliveryDateRaw: dateVal }
        : p
      ));
      toast.success(dateVal ? `Expected delivery set to ${fmtDate(dateVal)}` : 'Expected delivery date cleared');
      closeDialog();
    } catch {
      toast.error('Failed to save expected delivery date');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveExpiryDate = async () => {
    if (!actionRow) return;
    setIsSaving(true);
    try {
      const dateVal = expiryDateInput.trim() || null;
      await (api.purchaseOrders as any).updateBlinkitPOExpiryDate(actionRow.po_id, dateVal);
      setPoData(prev => prev.map(p => p.po_id === actionRow.po_id
        ? { ...p, po_expiry: dateVal ? fmtDate(dateVal) : '-', expiryDateRaw: dateVal }
        : p
      ));
      toast.success(dateVal ? `PO expiry set to ${fmtDate(dateVal)}` : 'PO expiry date cleared');
      closeDialog();
    } catch {
      toast.error('Failed to save PO expiry date');
    } finally {
      setIsSaving(false);
    }
  };

  const { effectiveDateFrom, effectiveDateTo } = useMemo(() => {
    if (filterMode !== 'all') {
      const { start_date, end_date } = computeDateRange(filterMode as FilterMode, customStart, customEnd);
      return { effectiveDateFrom: start_date || '', effectiveDateTo: end_date || '' };
    }
    return { effectiveDateFrom: filters.dateFrom, effectiveDateTo: filters.dateTo };
  }, [filterMode, customStart, customEnd, filters.dateFrom, filters.dateTo]);

  const fetchSeqRef = useRef(0);
  const fetchBlinkitPOs = useCallback(async (p: number, statusFilter: string, searchQuery: string, dateFrom: string, dateTo: string, silent = false) => {
    const seq = ++fetchSeqRef.current;
    try {
      if (!silent) setIsLoading(true);
      const params: Record<string, any> = { page: p, page_size: 50 };
      if (statusFilter !== 'all') params.status = statusFilter;
      if (searchQuery.trim()) {
        params.search = searchQuery.trim();
      } else {
        if (dateFrom) params.start_date = dateFrom;
        if (dateTo) params.end_date = dateTo;
      }

      const response = await api.purchaseOrders.getBlinkit(params) as any;
      if (fetchSeqRef.current !== seq) return;
      const transformedPOs = (response.items || []).map((po: any) => ({
        id: po.id,
        po_id: po.po_id,
        po_number: po.po_number,
        po_date: po.order_date ? fmtDate(po.order_date) : '-',
        orderDateRaw: po.order_date ? po.order_date.slice(0, 10) : null,
        blinkitSku: po.blinkit_id || po.blinkitId || '',
        product_name: toTitleCase(po.product_name || po.productName || ''),
        ordered_qty: po.quantity,
        accepted_qty: po.accepted_qty ?? null,
        received_qty: po.received_quantity ?? null,
        mapped_sku: po.asg_sku || po.asgSku || '',
        pending_qty: po.accepted_qty != null
          ? Math.max(0, (po.quantity || 0) - po.accepted_qty)
          : Math.max(0, (po.quantity || 0) - (po.received_quantity || 0)),
        unit_cost: po.unit_price ?? null,
        total_cost: po.total_amount ?? null,
        city: po.ship_to_city || '—',
        state: po.ship_to_state || '—',
        shipTo: po.ship_to_name || '—',
        delivery: po.expected_delivery_date ? fmtDate(po.expected_delivery_date) : '-',
        deliveryDateRaw: po.expected_delivery_date || null,
        po_expiry: po.po_expiry_date ? fmtDate(po.po_expiry_date) : '-',
        expiryDateRaw: po.po_expiry_date || null,
        dispatch_date: po.dispatch_date || null,
        courier: po.courier || null,
        status: effStatus(po.status || 'Created', po.po_expiry_date || null),
        po_status: po.po_status || 'Created',
      }));
      setPoData(transformedPOs);
      setTotal(response.total || 0);
      setTotalPages(response.total_pages || 1);
    } catch (error) {
      if (fetchSeqRef.current !== seq) return;
      console.error('Error fetching Blinkit purchase orders:', error);
    } finally {
      if (fetchSeqRef.current === seq) setIsLoading(false);
    }
  }, []);

  // Fetch date-filtered stats for KPI cards — re-runs when date filter or statsKey changes
  useEffect(() => {
    if (filterMode === 'custom' && !customStart) return;
    const params: Record<string, string> = {};
    if (effectiveDateFrom) params.start_date = effectiveDateFrom;
    if (effectiveDateTo) params.end_date = effectiveDateTo;
    (api.purchaseOrders as any).getBlinkitStats(Object.keys(params).length ? params : undefined)
      .then((s: any) => setStatsData(s)).catch(() => {});
  }, [filterMode, customStart, effectiveDateFrom, effectiveDateTo, statsKey]);

  // Initial load + one-time master data fetch
  useEffect(() => {
    fetchBlinkitPOs(1, filters.status, globalSearch, effectiveDateFrom, effectiveDateTo);
    (api.purchaseOrders as any).getCarriers()
      .then((res: any) => setCarriers(res?.carriers ?? []))
      .catch(() => {});
  }, [fetchBlinkitPOs]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch when filters or global date filter change — reset to page 1
  const prevFiltersRef = useRef({ status: filters.status, search: globalSearch, dateFrom: effectiveDateFrom, dateTo: effectiveDateTo });
  useEffect(() => {
    if (filterMode === 'custom' && !customStart) return;
    const prev = prevFiltersRef.current;
    const changed =
      prev.status !== filters.status ||
      prev.search !== globalSearch ||
      prev.dateFrom !== effectiveDateFrom ||
      prev.dateTo !== effectiveDateTo;
    if (changed) {
      prevFiltersRef.current = { status: filters.status, search: globalSearch, dateFrom: effectiveDateFrom, dateTo: effectiveDateTo };
      setPage(1);
      fetchBlinkitPOs(1, filters.status, globalSearch, effectiveDateFrom, effectiveDateTo);
    }
  }, [filterMode, customStart, filters.status, globalSearch, effectiveDateFrom, effectiveDateTo, fetchBlinkitPOs]);

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
      header: 'Ordered',
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
      id: 'receivedQty',
      header: 'Received Qty',
      accessorKey: 'received_qty',
      sortable: true,
      width: 120,
      minWidth: 100,
      align: 'right',
      cell: (row) => (
        row.received_qty != null ? (
          <span className={`font-medium ${row.received_qty < row.ordered_qty ? 'text-amber-600' : 'text-emerald-600'}`}>
            {row.received_qty.toLocaleString('en-IN')}
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
      id: 'pendingQty',
      header: 'Pending',
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
      id: 'city',
      header: 'City',
      accessorKey: 'city',
      width: 130,
      minWidth: 100,
      cell: (row) => <span className="text-muted-foreground">{row.city}</span>,
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
      id: 'shipTo',
      header: 'Ship To',
      accessorKey: 'shipTo',
      sortable: true,
      width: 220,
      minWidth: 160,
      cell: (row) => <span className="text-sm">{row.shipTo}</span>,
    },
    {
      id: 'delivery',
      header: 'Expected Delivery',
      accessorKey: 'delivery',
      width: 130,
      minWidth: 110,
      cell: (row) => <span className="text-muted-foreground">{row.delivery}</span>,
    },
    {
      id: 'poExpiry',
      header: 'PO Expiry',
      accessorKey: 'po_expiry',
      width: 110,
      minWidth: 90,
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
            <DropdownMenuItem onClick={() => openReceivedQtyDialog(row)}>
              <CheckCircle2 className="h-4 w-4 mr-2" />
              {row.received_qty != null ? 'Edit Received Qty' : 'Set Received Qty'}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openDeliveryDateDialog(row)}>
              <Calendar className="h-4 w-4 mr-2" />
              {row.deliveryDateRaw ? 'Edit Expected Delivery' : 'Set Expected Delivery'}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openExpiryDateDialog(row)}>
              <Calendar className="h-4 w-4 mr-2" />
              {row.expiryDateRaw ? 'Edit PO Expiry Date' : 'Set PO Expiry Date'}
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

  const gridState = useDataGrid(gridColumns, 'blinkit-po');

  const poStatusOptions = [
    { label: 'All',        value: 'all' },
    { label: 'Created',    value: 'Created' },
    { label: 'Dispatched', value: 'Dispatched' },
    { label: 'In Transit', value: 'In Transit' },
    { label: 'Delivered',  value: 'Delivered' },
    { label: 'Delayed',    value: 'Delayed' },
    { label: 'Cancelled',  value: 'Cancelled' },
  ];

  const filteredPoData = useMemo(() => {
    let data = poData;
    if (filters.state !== 'all') {
      data = data.filter((po) => po.state === filters.state);
    }
    if (gridSearch.trim()) {
      const q = gridSearch.toLowerCase();
      data = data.filter(p =>
        (p.po_number || '').toLowerCase().includes(q) ||
        (p.product_name || '').toLowerCase().includes(q) ||
        (p.blinkitSku || '').toLowerCase().includes(q) ||
        (p.mapped_sku || '').toLowerCase().includes(q)
      );
    }
    return data;
  }, [poData, filters.state, gridSearch]);

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
          <div className="flex items-center gap-3 p-4 bg-card border rounded-xl">
            <div className="flex items-center justify-center h-10 w-10 rounded-full bg-yellow-100 text-yellow-600">
              <ShoppingCart className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total POs</p>
              <p className="text-xl font-bold">{totalPOs}</p>
              <p className="text-xs text-muted-foreground">{totalUnits.toLocaleString('en-IN')} units</p>
            </div>
          </div>
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
          searchPlaceholder="Search PO number, product or SKU..."
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
                onClick={() => exportToCSV(
                  filteredPoData.map(p => ({
                    'PO Number': p.po_number,
                    'PO Date': p.po_date,
                    'Blinkit SKU': p.blinkitSku,
                    'Product': p.product_name,
                    'Ordered Qty': p.ordered_qty,
                    'Accepted Qty': p.accepted_qty ?? '',
                    'Received Qty': p.received_qty ?? '',
                    'ASG SKU': p.mapped_sku,
                    'Pending Qty': p.pending_qty,
                    'Unit Cost': p.unit_cost ?? '',
                    'Total Cost': p.total_cost ?? '',
                    'City': p.city,
                    'State': p.state,
                    'Ship To': p.shipTo,
                    'Expected Delivery': p.delivery,
                    'PO Expiry': p.po_expiry,
                    'Dispatch Date': p.dispatch_date ? fmtDate(p.dispatch_date) : '',
                    'Courier': p.courier || '',
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

        {/* Data Grid */}
        {filteredPoData.length > 0 ? (
          <>
            <DataGrid data={filteredPoData} gridState={gridState} getRowClass={(row) => getPoRowClass(row.status, row.expiryDateRaw)} getRowBgColor={(row) => getPoRowBgColor(row.status, row.expiryDateRaw)} />
            <div className="flex items-center justify-between pt-1">
              <p className="text-sm text-muted-foreground">{total.toLocaleString('en-IN')} line items</p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => { const p = Math.max(1, page - 1); setPage(p); fetchBlinkitPOs(p, filters.status, globalSearch, effectiveDateFrom, effectiveDateTo); }} disabled={page === 1 || isLoading}>
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
                <Button variant="outline" size="sm" onClick={() => { const p = Math.min(totalPages, page + 1); setPage(p); fetchBlinkitPOs(p, filters.status, globalSearch, effectiveDateFrom, effectiveDateTo); }} disabled={page === totalPages || isLoading}>
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

      {/* Received Qty Dialog */}
      <Dialog open={actionDialogType === 'received_qty'} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {actionRow?.received_qty != null ? 'Edit Received Qty' : 'Set Received Qty'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {actionRow && (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{actionRow.po_number}</span>
                {' — '}{actionRow.product_name || actionRow.blinkitSku}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Ordered: <strong>{actionRow?.ordered_qty}</strong>
              {actionRow?.accepted_qty != null && <> &nbsp;·&nbsp; Accepted: <strong>{actionRow.accepted_qty}</strong></>}
            </p>
            <Input
              type="number"
              min={0}
              placeholder="Enter received quantity"
              value={receivedQtyInput}
              onChange={(e) => setReceivedQtyInput(e.target.value)}
              autoFocus
            />
            {actionRow && receivedQtyInput !== '' && Number(receivedQtyInput) < actionRow.ordered_qty && (
              <p className="text-xs text-amber-600">
                Short delivery: {Number(receivedQtyInput)} of {actionRow.ordered_qty} units
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={isSaving}>Cancel</Button>
            <Button onClick={handleSaveReceivedQty} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                {' — '}{actionRow.product_name || actionRow.blinkitSku}
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
                {' — '}{actionRow.product_name || actionRow.blinkitSku}
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
              list="blk-carrier-list"
              placeholder="Type or select a carrier…"
              value={courierInput}
              onChange={(e) => setCourierInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveCourier()}
              autoFocus
            />
            <datalist id="blk-carrier-list">
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

      {/* Set/Edit Expected Delivery Date Dialog */}
      <Dialog open={actionDialogType === 'delivery_date'} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{actionRow?.deliveryDateRaw ? 'Edit Expected Delivery' : 'Set Expected Delivery'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {actionRow && (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{actionRow.po_number}</span>
              </p>
            )}
            <Input
              type="date"
              value={deliveryDateInput}
              onChange={(e) => setDeliveryDateInput(e.target.value)}
              autoFocus
            />
            {deliveryDateInput && (
              <Button variant="ghost" size="sm" className="text-xs text-red-600 h-7 px-2" onClick={() => setDeliveryDateInput('')}>
                Clear date
              </Button>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={isSaving}>Cancel</Button>
            <Button onClick={handleSaveDeliveryDate} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Set/Edit PO Expiry Date Dialog */}
      <Dialog open={actionDialogType === 'expiry_date'} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{actionRow?.expiryDateRaw ? 'Edit PO Expiry Date' : 'Set PO Expiry Date'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {actionRow && (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{actionRow.po_number}</span>
              </p>
            )}
            <Input
              type="date"
              value={expiryDateInput}
              onChange={(e) => setExpiryDateInput(e.target.value)}
              autoFocus
            />
            {expiryDateInput && (
              <Button variant="ghost" size="sm" className="text-xs text-red-600 h-7 px-2" onClick={() => setExpiryDateInput('')}>
                Clear date
              </Button>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={isSaving}>Cancel</Button>
            <Button onClick={handleSaveExpiryDate} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ProtectedRoute>
  );
}

export default function BlinkitPOPage() {
  return (
    <Suspense>
      <BlinkitPOPageContent />
    </Suspense>
  );
}
