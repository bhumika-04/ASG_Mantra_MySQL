'use client';

import { useState, useEffect } from 'react';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatsCard, StatsGrid } from '@/components/ui/stats-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataGrid, useDataGrid, ViewOptionsButton } from '@/components/ui/data-grid';
import { FileUpload } from '@/components/ui/file-upload';
import {
  Building2,
  Package,
  TrendingDown,
  Search,
  Upload,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

interface DistributorStockItem {
  id: number;
  reportDate: string;
  distributorId: number | null;
  itemName: string;
  openingQty: number | null;
  closingQty: number | null;
  saleQty: number | null;
}

interface DistributorStockStats {
  totalOpeningQty: number;
  totalClosingQty: number;
  totalSaleQty: number;
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
  const [items, setItems] = useState<DistributorStockItem[]>([]);
  const [stats, setStats] = useState<DistributorStockStats>({ totalOpeningQty: 0, totalClosingQty: 0, totalSaleQty: 0 });
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [reportDate, setReportDate] = useState('');
  const [reportDates, setReportDates] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);

  const PAGE_SIZE = 50;

  const gridState = useDataGrid<DistributorStockItem>([
    { id: 'itemName', header: 'Item Name', accessorKey: 'itemName', sortable: true, width: 360, minWidth: 200, cell: (row) => (
      <span
        className="font-medium text-sm leading-snug"
        style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
        title={row.itemName}
      >
        {row.itemName || '—'}
      </span>
    ) },
    { id: 'reportDate', header: 'Report Date', accessorKey: 'reportDate', sortable: true, width: 120 },
    {
      id: 'openingQty',
      header: 'Opening Qty',
      accessorKey: 'openingQty',
      sortable: true,
      width: 120,
      align: 'right',
      cell: (row) => <span className="font-mono">{row.openingQty ?? '—'}</span>,
    },
    {
      id: 'closingQty',
      header: 'Closing Qty',
      accessorKey: 'closingQty',
      sortable: true,
      width: 120,
      align: 'right',
      cell: (row) => <span className="font-mono font-semibold">{row.closingQty ?? '—'}</span>,
    },
    {
      id: 'saleQty',
      header: 'Dispatched Qty',
      accessorKey: 'saleQty',
      sortable: true,
      width: 130,
      align: 'right',
      cell: (row) => (
        <span className={`font-mono ${(row.saleQty ?? 0) > 0 ? 'text-green-600 font-semibold' : 'text-gray-400'}`}>
          {row.saleQty ?? '—'}
        </span>
      ),
    },
  ]);

  const fetchStock = async (p = 1, s = '', rd = '') => {
    setIsLoading(true);
    try {
      const params: any = { page: p, page_size: PAGE_SIZE };
      if (s) params.search = s;
      if (rd) params.report_date = rd;
      const data: any = await api.distributorStock.getAll({ ...params, distributor_id: 2 });
      setItems(data.items || []);
      setTotal(data.total || 0);
      setTotalPages(data.total_pages || 1);
      setStats(data.stats || { totalOpeningQty: 0, totalClosingQty: 0, totalSaleQty: 0 });
      if (data.filters?.report_dates?.length) {
        setReportDates(data.filters.report_dates);
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to load Eagle stock');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStock(page, search, reportDate);
  }, [page, reportDate]);

  const handleSearch = () => {
    setPage(1);
    fetchStock(1, search, reportDate);
  };

  const handleUpload = async (files: File[]) => {
    if (!files.length) return;
    setIsUploading(true);
    setUploadResult(null);
    try {
      const result: any = await api.distributorStock.upload(files[0], { distributorId: 2 });
      setUploadResult(result);
      if (result.success) {
        toast.success(`Eagle stock uploaded: ${result.data.rows_processed} records`);
        setPage(1);
        fetchStock(1, search, reportDate);
      }
    } catch (error: any) {
      toast.error(error.message || 'Upload failed');
      setUploadResult({ success: false, message: error.message || 'Upload failed', data: { rows_processed: 0, rows_skipped: 0, total_rows: 0 } });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <ProtectedRoute>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Building2 className="h-6 w-6 text-yellow-500" />
            <div>
              <p className="text-sm text-gray-500">Eagle Network weekly stock report (Blinkit distributor)</p>
            </div>
          </div>
          <Badge variant="outline" className="text-xs">
            ASG → Eagle → Blinkit
          </Badge>
        </div>

        {/* KPI Cards */}
        <StatsGrid columns={3}>
          <StatsCard
            title="Opening Stock"
            value={stats.totalOpeningQty.toLocaleString()}
            icon={Package}
            description="Start of week"
          />
          <StatsCard
            title="Closing Stock"
            value={stats.totalClosingQty.toLocaleString()}
            icon={Package}
            description="Current at Eagle"
            variant="blue"
          />
          <StatsCard
            title="Dispatched to Blinkit"
            value={stats.totalSaleQty.toLocaleString()}
            icon={TrendingDown}
            description="Units sent this week"
            variant="yellow"
          />
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
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <Building2 className="h-4 w-4 text-yellow-500" />
                Eagle Network Weekly Stock
              </CardTitle>
              <div className="flex items-center gap-2 flex-wrap">
                {/* Date filter */}
                <select
                  value={reportDate}
                  onChange={(e) => { setReportDate(e.target.value); setPage(1); }}
                  className="text-sm border border-gray-200 rounded-md px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Latest Report</option>
                  {reportDates.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>

                {/* Search */}
                <div className="flex gap-1">
                  <Input
                    placeholder="Search items..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    className="h-9 w-48 text-sm"
                  />
                  <Button variant="outline" size="sm" onClick={handleSearch}>
                    <Search className="h-4 w-4" />
                  </Button>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setPage(1); fetchStock(1, search, reportDate); }}
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>

                <ViewOptionsButton
                  columns={gridState.columns}
                  visibleColumns={gridState.visibleColumns}
                  onToggleColumn={gridState.toggleColumnVisibility}
                  rowDensity={gridState.rowDensity}
                  onDensityChange={gridState.setRowDensity}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* File Upload */}
            <div className="border border-dashed border-gray-200 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <Upload className="h-4 w-4 text-gray-400" />
                <p className="text-sm font-medium text-gray-700">Upload Weekly Report (Excel/CSV)</p>
                {isUploading && <Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
              </div>
              <FileUpload
                accept=".xlsx,.xls,.csv"
                maxSize={10}
                onUpload={handleUpload}
                description={isUploading ? 'Uploading...' : 'Drop Eagle weekly stock file here'}
              />
              <p className="text-xs text-gray-400 mt-2">
                Expected columns: report_date, item_name, opening_qty, closing_qty, sale_qty
              </p>
            </div>

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
