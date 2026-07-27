'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useFilter, computeDateRange, FilterMode } from '@/contexts/FilterContext';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { FilterBar } from '@/components/ui/filter-bar';
import { FilterPanel, FilterValues, DEFAULT_FILTER_VALUES } from '@/components/ui/filter-panel';
import { DataGrid, GridColumn, useDataGrid, ViewOptionsButton } from '@/components/ui/data-grid';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { exportToCSV } from '@/lib/export';
import { toast } from 'sonner';
import {
  Clock,
  AlertCircle,
  CheckCircle2,
  Truck,
  PackageCheck,
  Download,
  Pencil,
} from 'lucide-react';
import api from '@/lib/api';
import { fmtDate } from '@/lib/format';

const STATUS_OPTIONS = ['Created', 'Dispatched', 'In Transit', 'Delivered', 'Delayed', 'Cancelled'];

interface POOverviewItem {
  id: number;
  po_id: number;
  po_number: string;
  po_date: string;
  orderDateRaw: string | null;
  deliveryDate: string;
  po_expiry: string;
  expiryDateRaw: string | null;
  dispatch_date: string | null;
  courier: string | null;
  shipTo: string;
  state: string;
  items: number;
  totalQty: number;
  status: string;
  po_status: string | null;
}

const NON_COLORED_STATUSES = new Set(['Delivered', 'Received', 'Cancelled', 'Closed', 'Dispatched', 'In Transit']);
const NO_EXPIRY_OVERRIDE = new Set([...NON_COLORED_STATUSES, 'Expired']);

function effStatus(base: string, expiryISO: string | null): string {
  if (NO_EXPIRY_OVERRIDE.has(base)) return base;
  if (!expiryISO) return base;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return today.getTime() > new Date(expiryISO + 'T00:00:00').getTime() ? 'Expired' : base;
}

function getExpiryRowClass(row: POOverviewItem): string | undefined {
  if (NON_COLORED_STATUSES.has(row.status)) return undefined;
  if (!row.expiryDateRaw) return undefined;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = Math.ceil((new Date(row.expiryDateRaw + 'T00:00:00').getTime() - today.getTime()) / 86400000);
  if (d < 0)  return 'bg-red-50 dark:bg-red-950/20';
  if (d <= 7) return 'bg-yellow-50 dark:bg-yellow-950/20';
  return undefined;
}
function getExpiryRowBgColor(row: POOverviewItem): string | undefined {
  if (NON_COLORED_STATUSES.has(row.status)) return undefined;
  if (!row.expiryDateRaw) return undefined;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = Math.ceil((new Date(row.expiryDateRaw + 'T00:00:00').getTime() - today.getTime()) / 86400000);
  if (d < 0)  return 'rgb(254,242,242)';
  if (d <= 7) return 'rgb(254,252,232)';
  return undefined;
}

const KPI_CONFIG: Record<string, { icon: React.ReactNode; color: string; bg: string }> = {
  'Created':    { icon: <Clock className="h-5 w-5" />,        color: 'text-orange-600',  bg: 'bg-orange-100' },
  'Dispatched': { icon: <Truck className="h-5 w-5" />,        color: 'text-blue-600',    bg: 'bg-blue-100' },
  'In Transit': { icon: <AlertCircle className="h-5 w-5" />,  color: 'text-yellow-600',  bg: 'bg-yellow-100' },
  'Delivered':  { icon: <CheckCircle2 className="h-5 w-5" />, color: 'text-emerald-600', bg: 'bg-emerald-100' },
  'Delayed':    { icon: <AlertCircle className="h-5 w-5" />,  color: 'text-red-600',     bg: 'bg-red-100' },
};

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

export default function BlinkitPOOverviewPage() {
  const router = useRouter();
  const { filterMode, customStart, customEnd, globalSearch, setGlobalSearchRaw } = useFilter();
  const [gridSearch, setGridSearch] = useState('');
  const [filters, setFilters] = useState<FilterValues>(DEFAULT_FILTER_VALUES);
  const [poData, setPoData] = useState<POOverviewItem[]>([]);
  const [statsData, setStatsData] = useState<{ status_counts: Record<string, number>; total_pos: number; total_units: number } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const [statsKey, setStatsKey] = useState(0);

  // Status edit dialog
  const [statusDialogRow, setStatusDialogRow] = useState<POOverviewItem | null>(null);
  const [statusInput, setStatusInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const handleSaveStatus = async () => {
    if (!statusDialogRow || statusInput === (statusDialogRow.po_status ?? 'Created')) { setStatusDialogRow(null); return; }
    setIsSaving(true);
    try {
      await api.purchaseOrders.updateBlinkitPOStatus(statusDialogRow.po_id, { status: statusInput });
      setPoData(prev => prev.map(p => p.po_id === statusDialogRow.po_id
        ? { ...p, status: effStatus(statusInput, p.expiryDateRaw), po_status: statusInput }
        : p));
      setStatsKey(k => k + 1);
      fetchGrid(page, globalSearch, filters.status || 'all', effectiveDateFrom, effectiveDateTo);
      toast.success(`Status updated to ${statusInput}`);
      setStatusDialogRow(null);
    } catch {
      toast.error('Failed to update status');
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
  const fetchGrid = useCallback(async (p: number, search: string, statusFilter: string, dateFrom: string, dateTo: string) => {
    const seq = ++fetchSeqRef.current;
    try {
      setIsLoading(true);
      const params: Record<string, any> = { page: p, page_size: 50 };
      if (search.trim()) {
        params.search = search.trim();
      } else {
        if (dateFrom) params.start_date = dateFrom;
        if (dateTo) params.end_date = dateTo;
      }
      if (statusFilter !== 'all') params.status = statusFilter;

      const response = await (api.purchaseOrders as any).getBlinkitOverview(params) as any;
      if (fetchSeqRef.current !== seq) return;
      const data = (response.items || []).map((po: any) => ({
        id: po.po_id,
        po_id: po.po_id,
        po_number: po.po_number,
        po_date: po.order_date ? fmtDate(po.order_date) : 'N/A',
        orderDateRaw: po.order_date ? po.order_date.slice(0, 10) : null,
        deliveryDate: po.expected_delivery_date ? fmtDate(po.expected_delivery_date) : 'N/A',
        po_expiry: po.po_expiry_date ? fmtDate(po.po_expiry_date) : '—',
        expiryDateRaw: po.po_expiry_date ? po.po_expiry_date.slice(0, 10) : null,
        dispatch_date: po.dispatch_date || null,
        courier: po.courier || null,
        shipTo: po.ship_to_name || '—',
        state: po.ship_to_state || '—',
        items: po.item_count,
        totalQty: po.total_qty,
        status: effStatus(po.status || 'Created', po.po_expiry_date ? po.po_expiry_date.slice(0, 10) : null),
        po_status: po.po_status ?? null,
      }));
      setPoData(data);
      setTotal(response.total || 0);
      setTotalPages(response.total_pages || 1);
    } catch (error) {
      if (fetchSeqRef.current !== seq) return;
      console.error('Error fetching Blinkit PO data:', error);
    } finally {
      if (fetchSeqRef.current === seq) setIsLoading(false);
    }
  }, []);

  // Stats — independent of pagination
  useEffect(() => {
    if (filterMode === 'custom' && !customStart) return;
    const params: Record<string, string> = {};
    if (effectiveDateFrom) params.start_date = effectiveDateFrom;
    if (effectiveDateTo) params.end_date = effectiveDateTo;
    (api.purchaseOrders as any).getBlinkitStats(Object.keys(params).length ? params : undefined)
      .then((s: any) => setStatsData(s)).catch(() => {});
  }, [filterMode, customStart, effectiveDateFrom, effectiveDateTo, statsKey]);

  // Initial load — pass globalSearch so arriving with a search term pre-set works immediately
  useEffect(() => {
    fetchGrid(1, globalSearch, filters.status || 'all', effectiveDateFrom, effectiveDateTo);
  }, [fetchGrid]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch on filter/search/date change
  const prevRef = useRef({ search: globalSearch, status: filters.status, dateFrom: effectiveDateFrom, dateTo: effectiveDateTo });
  useEffect(() => {
    if (filterMode === 'custom' && !customStart) return;
    const prev = prevRef.current;
    const changed = prev.search !== globalSearch || prev.status !== filters.status
      || prev.dateFrom !== effectiveDateFrom || prev.dateTo !== effectiveDateTo;
    if (changed) {
      prevRef.current = { search: globalSearch, status: filters.status, dateFrom: effectiveDateFrom, dateTo: effectiveDateTo };
      setPage(1);
      fetchGrid(1, globalSearch, filters.status, effectiveDateFrom, effectiveDateTo);
    }
  }, [filterMode, customStart, globalSearch, filters.status, effectiveDateFrom, effectiveDateTo, fetchGrid]);

  const poStatusOptions = [
    { label: 'All',        value: 'all' },
    { label: 'Created',    value: 'Created' },
    { label: 'Dispatched', value: 'Dispatched' },
    { label: 'In Transit', value: 'In Transit' },
    { label: 'Delivered',  value: 'Delivered' },
    { label: 'Delayed',    value: 'Delayed' },
    { label: 'Cancelled',  value: 'Cancelled' },
  ];

  // State filter is client-side (current page only)
  const filteredData = useMemo(() => {
    let data = poData;
    if (filters.state !== 'all') data = data.filter(p => p.state === filters.state);
    if (gridSearch.trim()) {
      const q = gridSearch.toLowerCase();
      data = data.filter(p =>
        (p.po_number || '').toLowerCase().includes(q) ||
        (p.shipTo || '').toLowerCase().includes(q) ||
        (p.status || '').toLowerCase().includes(q)
      );
    }
    return data;
  }, [poData, filters.state, gridSearch]);

  const stateOptions = useMemo(() => {
    const states = [...new Set(poData.map(p => p.state).filter(s => s && s !== '—'))].sort();
    return [{ label: 'All', value: 'all' }, ...states.map(s => ({ label: s, value: s }))];
  }, [poData]);

  const stats = useMemo(() => {
    const sc = statsData?.status_counts || {};
    return {
      created:    sc['Created']    || 0,
      dispatched: sc['Dispatched'] || 0,
      inTransit:  sc['In Transit'] || 0,
      delivered:  sc['Delivered']  || 0,
      delayed:    sc['Delayed']    || 0,
    };
  }, [statsData]);

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
      cell: (row) => <span className="font-medium text-yellow-700">{row.po_number}</span>,
    },
    {
      id: 'poDate',
      header: 'PO Date',
      accessorKey: 'po_date',
      sortable: true,
      width: 130,
      minWidth: 110,
      cell: (row) => <span className="text-sm">{row.po_date}</span>,
    },
    {
      id: 'deliveryDate',
      header: 'Delivery Date',
      accessorKey: 'deliveryDate',
      sortable: true,
      width: 130,
      minWidth: 110,
      cell: (row) => <span className="text-sm">{row.deliveryDate}</span>,
    },
    {
      id: 'poExpiry',
      header: 'PO Expiry',
      accessorKey: 'po_expiry',
      width: 120,
      minWidth: 100,
      cell: (row) => <span className="text-sm text-muted-foreground">{row.po_expiry}</span>,
    },
    {
      id: 'dispatchDate',
      header: 'Dispatch Date',
      accessorKey: 'dispatch_date',
      width: 130,
      minWidth: 110,
      cell: (row) => row.dispatch_date ? (
        <span className="text-emerald-700 font-medium text-sm">{fmtDate(row.dispatch_date)}</span>
      ) : (
        <span className="text-muted-foreground text-xs">—</span>
      ),
    },
    {
      id: 'courier',
      header: 'Courier',
      accessorKey: 'courier',
      width: 140,
      minWidth: 110,
      cell: (row) => row.courier ? (
        <span className="text-sm">{row.courier}</span>
      ) : (
        <span className="text-muted-foreground text-xs">—</span>
      ),
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
      cell: (row) => <span className="font-semibold">{row.totalQty.toLocaleString('en-IN')}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      accessorKey: 'status',
      sortable: true,
      width: 170,
      minWidth: 140,
      align: 'center',
      cell: (row) => {
        const badge = getStatusBadge(row.status);
        return (
          <div className="flex items-center justify-center gap-1.5">
            <Badge className={`${badge.style} inline-flex items-center`} variant="outline">
              {badge.icon}
              {row.status}
            </Badge>
            <button
              onClick={(e) => { e.stopPropagation(); setStatusDialogRow(row); setStatusInput(row.po_status ?? 'Created'); }}
              className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
              title="Change status"
            >
              <Pencil className="h-3 w-3" />
            </button>
          </div>
        );
      },
    },
  ];

  const gridState = useDataGrid(gridColumns, 'blinkit-po-overview');

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
                onClick={() => setFilters(prev => ({ ...prev, status: prev.status === status ? 'all' : status }))}
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
          searchPlaceholder="Search PO number, location or status..."
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
                    'PO Expiry': p.po_expiry,
                    'Dispatch Date': p.dispatch_date ? fmtDate(p.dispatch_date) : '',
                    'Courier': p.courier || '',
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
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="text-center">
              <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-yellow-600 mb-3"></div>
              <p className="text-sm text-muted-foreground">Loading...</p>
            </div>
          </div>
        ) : filteredData.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 border-2 border-dashed rounded-xl">
            <PackageCheck className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-semibold mb-2">No purchase orders found</h3>
            <p className="text-sm text-muted-foreground">
              {(globalSearch || gridSearch) ? 'Try adjusting your search criteria' : 'No Blinkit POs available'}
            </p>
          </div>
        ) : (
          <>
            <DataGrid
              data={filteredData}
              gridState={gridState}
              onRowClick={(row) => router.push(`/blinkit-po?search=${encodeURIComponent(row.po_number)}`)}
              getRowClass={getExpiryRowClass}
              getRowBgColor={getExpiryRowBgColor}
            />
            <div className="flex items-center justify-between pt-1">
              <p className="text-sm text-muted-foreground">{total.toLocaleString('en-IN')} purchase orders</p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => { const p = Math.max(1, page - 1); setPage(p); fetchGrid(p, globalSearch, filters.status, effectiveDateFrom, effectiveDateTo); }} disabled={page === 1 || isLoading}>
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
                <Button variant="outline" size="sm" onClick={() => { const p = Math.min(totalPages, page + 1); setPage(p); fetchGrid(p, globalSearch, filters.status, effectiveDateFrom, effectiveDateTo); }} disabled={page === totalPages || isLoading}>
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Edit Status Dialog */}
      <Dialog open={!!statusDialogRow} onOpenChange={(open) => { if (!open) setStatusDialogRow(null); }}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>Change PO Status</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <p className="text-xs text-muted-foreground mb-2">{statusDialogRow?.po_number}</p>
            <select
              value={statusInput}
              onChange={(e) => setStatusInput(e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
            >
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setStatusDialogRow(null)}>Cancel</Button>
            <Button size="sm" onClick={handleSaveStatus} disabled={isSaving}>
              {isSaving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ProtectedRoute>
  );
}
