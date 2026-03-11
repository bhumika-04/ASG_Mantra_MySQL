'use client';

import { useState, useEffect } from 'react';
import { useFilter, computeDateRange } from '@/contexts/FilterContext';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatsCard, StatsGrid } from '@/components/ui/stats-card';
import { Button } from '@/components/ui/button';
import { DataGrid, useDataGrid, ViewOptionsButton } from '@/components/ui/data-grid';
import { FilterBar } from '@/components/ui/filter-bar';
import { FileUpload } from '@/components/ui/file-upload';
import {
  Building2,
  Package,
  Upload,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Calendar,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

interface DistributorStockItem {
  id: number;
  reportDate: string;
  distributorId: number | null;
  itemName: string;
  sku: string | null;
  closingQty: number | null;
  dlQty: number | null;
  mhQty: number | null;
  ktQty: number | null;
  wbQty: number | null;
}

interface PreviewRow {
  itemName: string;
  sku: string | null;
  closingQty: number | null;
  dlQty: number | null;
  mhQty: number | null;
  ktQty: number | null;
  wbQty: number | null;
  reportDate: string;
}

interface UploadResult {
  success: boolean;
  message: string;
  data: {
    rows_processed: number;
    rows_skipped: number;
    total_rows: number;
    errors?: string[];
  };
}

export default function DistributorPage() {
  const { filterMode, customStart, customEnd } = useFilter();
  const [items, setItems] = useState<DistributorStockItem[]>([]);
  const [stats, setStats] = useState({ totalClosingQty: 0, totalDlQty: 0, totalMhQty: 0, totalKtQty: 0, totalWbQty: 0, totalSkus: 0 });
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);

  // Preview state
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [previewRows, setPreviewRows] = useState<PreviewRow[] | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [reportDate, setReportDate] = useState('');
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  const PAGE_SIZE = 50;

  const gridState = useDataGrid<DistributorStockItem>([
    { id: 'sku', header: 'SKU', accessorKey: 'sku', sortable: true, sticky: true, width: 220, minWidth: 160, cell: (row) => (
      <span className="text-xs font-mono text-gray-700 font-medium">{row.sku || '—'}</span>
    ) },
    { id: 'itemName', header: 'Item Name', accessorKey: 'itemName', sortable: true, width: 300, minWidth: 200, cell: (row) => (
      <span
        className="text-sm leading-snug"
        style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
        title={row.itemName ?? undefined}
      >
        {row.itemName || '—'}
      </span>
    ) },
    { id: 'reportDate', header: 'Report Date', accessorKey: 'reportDate', sortable: true, width: 120 },
    {
      id: 'closingQty',
      header: 'Total Stock',
      accessorKey: 'closingQty',
      sortable: true,
      width: 110,
      align: 'right',
      cell: (row) => <span className="font-mono font-semibold">{row.closingQty ?? '—'}</span>,
    },
    {
      id: 'dlQty',
      header: 'DL',
      accessorKey: 'dlQty',
      sortable: true,
      width: 80,
      align: 'right',
      cell: (row) => <span className="font-mono text-sm">{row.dlQty ?? '—'}</span>,
    },
    {
      id: 'mhQty',
      header: 'MH',
      accessorKey: 'mhQty',
      sortable: true,
      width: 80,
      align: 'right',
      cell: (row) => <span className="font-mono text-sm">{row.mhQty ?? '—'}</span>,
    },
    {
      id: 'ktQty',
      header: 'KT',
      accessorKey: 'ktQty',
      sortable: true,
      width: 80,
      align: 'right',
      cell: (row) => <span className="font-mono text-sm">{row.ktQty ?? '—'}</span>,
    },
    {
      id: 'wbQty',
      header: 'WB',
      accessorKey: 'wbQty',
      sortable: true,
      width: 80,
      align: 'right',
      cell: (row) => <span className="font-mono text-sm">{row.wbQty ?? '—'}</span>,
    },
  ], 'distributor-stock');

  const fetchStock = async (p = 1, s = '') => {
    setIsLoading(true);
    try {
      const { start_date, end_date } = computeDateRange(filterMode, customStart, customEnd);
      const params: any = { page: p, page_size: PAGE_SIZE, distributor_id: 2 };
      if (s.trim()) params.search = s.trim();
      if (start_date) params.date_from = start_date;
      if (end_date) params.date_to = end_date;
      const data: any = await api.distributorStock.getAll(params);
      setItems(data.items || []);
      setTotal(data.total || 0);
      setTotalPages(data.total_pages || 1);
      setStats(data.stats || { totalClosingQty: 0, totalDlQty: 0, totalMhQty: 0, totalKtQty: 0, totalWbQty: 0, totalSkus: 0 });
    } catch (error: any) {
      toast.error(error.message || 'Failed to load Eagle stock');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStock(page, search);
  }, [page, filterMode, customStart, customEnd]);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      fetchStock(1, search);
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  const handleFileSelected = async (files: File[]) => {
    if (!files.length) return;
    const file = files[0];
    setSelectedFile(file);
    setIsPreviewing(true);
    setPreviewRows(null);
    setUploadResult(null);
    try {
      const result: any = await api.distributorStock.preview(file, { channel: 'Blinkit' });
      setPreviewRows(result.rows || []);
      setDuplicateWarning(result.duplicateWarning || null);
      // Pre-fill date picker with detected date from file
      if (result.detectedDate) {
        setReportDate(result.detectedDate);
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to parse file');
      setPreviewRows(null);
      setSelectedFile(null);
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleConfirmUpload = async () => {
    if (!selectedFile) return;
    setIsConfirming(true);
    setUploadResult(null);
    try {
      const result: any = await api.distributorStock.upload(selectedFile, {
        channel: 'Blinkit',
        reportDate: reportDate || undefined,
      });
      setUploadResult(result);
      if (result.success) {
        if (result.data.rows_processed === 0) {
          toast.warning('Upload completed but 0 rows saved. Check column names match: SKU, ITEM, Total Stock, DL, MH, KT, WB');
        } else {
          toast.success(`Eagle stock uploaded: ${result.data.rows_processed} records`);
        }
        setPreviewRows(null);
        setSelectedFile(null);
        setReportDate('');
        setPage(1);
        fetchStock(1, search);
      }
    } catch (error: any) {
      toast.error(error.message || 'Upload failed');
      setUploadResult({ success: false, message: error.message || 'Upload failed', data: { rows_processed: 0, rows_skipped: 0, total_rows: 0 } });
    } finally {
      setIsConfirming(false);
    }
  };

  const handleCancelPreview = () => {
    setPreviewRows(null);
    setSelectedFile(null);
    setReportDate('');
    setUploadResult(null);
    setDuplicateWarning(null);
  };

  return (
    <ProtectedRoute>
      <div className="p-6 space-y-6">
        {/* KPI Cards */}
        <StatsGrid columns={6}>
          <StatsCard title="Total SKUs" value={stats.totalSkus.toLocaleString()} icon={Package} description="Distinct products" variant="blue" />
          <StatsCard title="Total Stock" value={stats.totalClosingQty.toLocaleString()} icon={Package} description="Closing qty across all regions" variant="green" />
          <StatsCard title="DL" value={stats.totalDlQty.toLocaleString()} icon={Building2} description="Delhi stock" variant="orange" />
          <StatsCard title="MH" value={stats.totalMhQty.toLocaleString()} icon={Building2} description="Maharashtra stock" variant="purple" />
          <StatsCard title="KT" value={stats.totalKtQty.toLocaleString()} icon={Building2} description="Karnataka stock" variant="red" />
          <StatsCard title="WB" value={stats.totalWbQty.toLocaleString()} icon={Building2} description="West Bengal stock" variant="yellow" />
        </StatsGrid>

        {/* Upload Result */}
        {uploadResult && (
          <Card className={uploadResult.success ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}>
            <CardContent className="pt-4">
              <div className="flex items-start gap-3">
                {uploadResult.success
                  ? <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5" />
                  : <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />}
                <div>
                  <p className={`font-medium text-sm ${uploadResult.success ? 'text-green-800' : 'text-red-800'}`}>
                    {uploadResult.message}
                  </p>
                  {uploadResult.success && (
                    <p className="text-xs text-gray-600 mt-1">
                      Processed: {uploadResult.data.rows_processed} &nbsp;|&nbsp;
                      Skipped: {uploadResult.data.rows_skipped} &nbsp;|&nbsp;
                      Total rows: {uploadResult.data.total_rows}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Upload + Filter + Data */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Building2 className="h-4 w-4 text-yellow-500" />
              Eagle Network Weekly Stock
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* File Upload or Preview */}
            {previewRows === null ? (
              <div className="border border-dashed border-gray-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Upload className="h-4 w-4 text-gray-400" />
                  <p className="text-sm font-medium text-gray-700">Upload Weekly Report (Excel/CSV)</p>
                  {isPreviewing && <Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
                </div>
                <FileUpload
                  accept=".xlsx,.xls,.csv"
                  maxSize={10}
                  onUpload={handleFileSelected}
                  description={isPreviewing ? 'Parsing file...' : 'Drop Eagle weekly stock file here'}
                />
                <p className="text-xs text-gray-400 mt-2">
                  Columns: SKU, ITEM (item name), Total Stock, DL / MH / KT / WB (regional stock)
                </p>
              </div>
            ) : (
              /* Preview Panel */
              <div className="border border-blue-200 rounded-lg bg-blue-50/40">
                <div className="flex items-center justify-between px-4 py-3 border-b border-blue-200">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-4 w-4 text-blue-600" />
                    <span className="text-sm font-medium text-blue-900">
                      Preview — {previewRows.length} rows parsed from <span className="font-semibold">{selectedFile?.name}</span>
                    </span>
                  </div>
                  <button onClick={handleCancelPreview} className="p-1 rounded hover:bg-blue-100 text-blue-400 hover:text-blue-600 transition-colors">
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Duplicate warning */}
                {duplicateWarning && (
                  <div className="px-4 py-2.5 flex items-start gap-2 bg-amber-50 border-b border-amber-200">
                    <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-amber-800">{duplicateWarning}</p>
                  </div>
                )}

                {/* Date picker */}
                <div className="px-4 py-3 flex items-center gap-3 border-b border-blue-100">
                  <Calendar className="h-4 w-4 text-blue-500 flex-shrink-0" />
                  <label className="text-sm font-medium text-gray-700">Report Date</label>
                  <input
                    type="date"
                    value={reportDate}
                    onChange={(e) => setReportDate(e.target.value)}
                    className="h-9 text-sm border border-border rounded-md px-2 bg-white text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500 w-40"
                  />
                  <span className="text-xs text-muted-foreground">
                    {reportDate ? 'All rows will be saved with this date' : 'Using date from file (if present), else today'}
                  </span>
                </div>

                {/* Preview table */}
                <div className="overflow-x-auto max-h-64">
                  <table className="w-full text-xs">
                    <thead className="bg-blue-100 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-blue-800">Item Name</th>
                        <th className="px-3 py-2 text-left font-medium text-blue-800">SKU</th>
                        <th className="px-3 py-2 text-right font-medium text-blue-800">Total</th>
                        <th className="px-3 py-2 text-right font-medium text-blue-800">DL</th>
                        <th className="px-3 py-2 text-right font-medium text-blue-800">MH</th>
                        <th className="px-3 py-2 text-right font-medium text-blue-800">KT</th>
                        <th className="px-3 py-2 text-right font-medium text-blue-800">WB</th>
                        <th className="px-3 py-2 text-right font-medium text-blue-800">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-blue-100">
                      {previewRows.slice(0, 100).map((r, i) => (
                        <tr key={i} className="hover:bg-blue-50/60">
                          <td className="px-3 py-1.5 max-w-[200px] truncate" title={r.itemName}>{r.itemName}</td>
                          <td className="px-3 py-1.5 font-mono text-gray-500">{r.sku || '—'}</td>
                          <td className="px-3 py-1.5 text-right font-semibold">{r.closingQty ?? '—'}</td>
                          <td className="px-3 py-1.5 text-right text-gray-600">{r.dlQty ?? '—'}</td>
                          <td className="px-3 py-1.5 text-right text-gray-600">{r.mhQty ?? '—'}</td>
                          <td className="px-3 py-1.5 text-right text-gray-600">{r.ktQty ?? '—'}</td>
                          <td className="px-3 py-1.5 text-right text-gray-600">{r.wbQty ?? '—'}</td>
                          <td className="px-3 py-1.5 text-right text-gray-400">{reportDate || r.reportDate}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {previewRows.length > 100 && (
                    <p className="text-xs text-center text-muted-foreground py-2">
                      Showing first 100 of {previewRows.length} rows
                    </p>
                  )}
                </div>

                {/* Confirm / Cancel */}
                <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-blue-200">
                  <Button variant="outline" size="sm" onClick={handleCancelPreview} disabled={isConfirming}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleConfirmUpload} disabled={isConfirming}>
                    {isConfirming ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Saving...</> : `Confirm Upload (${previewRows.length} rows)`}
                  </Button>
                </div>
              </div>
            )}

            {/* Filter bar — search + view options */}
            <FilterBar
              searchPlaceholder="Search items..."
              searchValue={search}
              onSearchChange={setSearch}
            >
              <div className="flex items-center gap-2 ml-auto">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9"
                  onClick={() => { setPage(1); fetchStock(1, search); }}
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
                <ViewOptionsButton
                  columns={gridState.columns}
                  visibleColumns={gridState.visibleColumns}
                  onToggleColumn={gridState.toggleColumnVisibility}
                  rowDensity={gridState.rowDensity}
                  onDensityChange={gridState.setRowDensity}
                  onSave={gridState.saveCurrentView}
                  onReset={gridState.resetView}
                />
              </div>
            </FilterBar>

            {/* Data Grid */}
            {isLoading ? (
              <div className="text-center py-10">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-500" />
                <p className="mt-3 text-sm text-gray-500">Loading Eagle stock...</p>
              </div>
            ) : items.length === 0 ? (
              <div className="text-center py-10 text-gray-500">
                <Building2 className="h-10 w-10 mx-auto mb-3 text-gray-300" />
                <p className="text-sm font-medium">No Eagle stock data</p>
                <p className="text-xs mt-1">Upload Eagle's weekly Excel report above</p>
              </div>
            ) : (
              <>
                <DataGrid
                  data={items}
                  gridState={gridState}
                  pageSize={PAGE_SIZE}
                />
                {/* Pagination */}
                <div className="flex items-center justify-between pt-2">
                  <p className="text-sm text-gray-500">
                    {total.toLocaleString()} items
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1}
                    >
                      Previous
                    </Button>
                    <span className="text-sm text-gray-500">
                      Page {page} of {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </ProtectedRoute>
  );
}
