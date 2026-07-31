'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useFilter } from '@/contexts/FilterContext';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { StatsCard, StatsGrid } from '@/components/ui/stats-card';
import { FilterBar } from '@/components/ui/filter-bar';
import { DataGrid, GridColumn, useDataGrid, ViewOptionsButton } from '@/components/ui/data-grid';
import { Button } from '@/components/ui/button';
import { SnapshotDatePicker } from '@/components/ui/snapshot-date-picker';
import { exportToCSV } from '@/lib/export';
import { Package, Boxes, ShoppingCart, Download } from 'lucide-react';
import api from '@/lib/api';
import { fmtDate } from '@/lib/format';

interface AmazonInventoryItem {
  id: number;
  asin: string;
  productTitle: string;
  brand: string;
  modelNumber: string;
  sellableOnHandUnits: number;
  unsellableOnHandUnits: number;
  openPurchaseOrderQuantity: number;
  reportDate: string;
}

const PAGE_SIZE = 50;

export default function AmazonInventoryPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [items, setItems] = useState<AmazonInventoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const { globalSearch } = useFilter();
  const [gridSearch, setGridSearch] = useState('');
  const [reportDate, setReportDate] = useState('');
  const fetchSeqRef = useRef(0);
  const [reportDates, setReportDates] = useState<string[]>([]);
  const [stats, setStats] = useState({
    totalSellableUnits: 0,
    totalUnsellableUnits: 0,
    totalOpenPOQty: 0,
    uniqueAsins: 0,
  });

  const fetchData = useCallback(async () => {
    const seq = ++fetchSeqRef.current;
    try {
      setIsLoading(true);
      const params: Record<string, any> = { page, page_size: PAGE_SIZE };
      if (globalSearch) params.search = globalSearch;
      if (reportDate) params.report_date = reportDate;
      const res: any = await api.amazonInventory.getAll(params);
      if (fetchSeqRef.current !== seq) return;
      setItems(res.items || []);
      setTotal(res.total || 0);
      setStats(res.stats || { totalSellableUnits: 0, totalUnsellableUnits: 0, totalOpenPOQty: 0, uniqueAsins: 0 });
      if (res.filters?.report_dates?.length) {
        setReportDates(res.filters.report_dates);
        if (!reportDate) setReportDate(res.filters.report_dates[0]);
      }
    } catch (err) {
      if (fetchSeqRef.current !== seq) return;
      console.error('Error fetching Amazon inventory:', err);
    } finally {
      if (fetchSeqRef.current === seq) setIsLoading(false);
    }
  }, [page, globalSearch, reportDate]);

  useEffect(() => { setPage(1); }, [globalSearch]);
  useEffect(() => { fetchData(); }, [fetchData]);

  const columns: GridColumn<AmazonInventoryItem>[] = [
    {
      id: 'asin',
      header: 'ASIN',
      accessorKey: 'asin',
      sortable: true,
      sticky: true,
      width: 140,
      minWidth: 120,
      cell: (row) => (
        <code className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded border border-blue-200">
          {row.asin}
        </code>
      ),
    },
    {
      id: 'productTitle',
      header: 'Product',
      accessorKey: 'productTitle',
      sortable: true,
      width: 300,
      minWidth: 200,
      wrap: true,
      cell: (row) => (
        <span
          className="text-sm font-medium leading-snug"
          style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
          title={row.productTitle}
        >
          {row.productTitle || '—'}
        </span>
      ),
    },
    {
      id: 'brand',
      header: 'Brand',
      accessorKey: 'brand',
      sortable: true,
      width: 140,
      minWidth: 100,
      cell: (row) => <span className="text-muted-foreground">{row.brand || '—'}</span>,
    },
    {
      id: 'modelNumber',
      header: 'Model / SKU',
      accessorKey: 'modelNumber',
      sortable: true,
      width: 150,
      minWidth: 110,
      cell: (row) => (
        <span className="text-xs font-mono text-muted-foreground">{row.modelNumber || '—'}</span>
      ),
    },
    {
      id: 'sellableOnHandUnits',
      header: 'Sellable (On-Hand)',
      accessorKey: 'sellableOnHandUnits',
      sortable: true,
      width: 160,
      minWidth: 120,
      align: 'right',
      cell: (row) => (
        <span className={`font-semibold ${(row.sellableOnHandUnits || 0) === 0 ? 'text-red-500' : ''}`}>
          {(row.sellableOnHandUnits || 0).toLocaleString('en-IN')}
        </span>
      ),
    },
    {
      id: 'unsellableOnHandUnits',
      header: 'Unsellable',
      accessorKey: 'unsellableOnHandUnits',
      sortable: true,
      width: 120,
      minWidth: 90,
      align: 'right',
      cell: (row) => (
        <span className={`text-sm ${(row.unsellableOnHandUnits || 0) > 0 ? 'text-orange-500 font-medium' : 'text-muted-foreground'}`}>
          {(row.unsellableOnHandUnits || 0).toLocaleString('en-IN')}
        </span>
      ),
    },
    {
      id: 'openPurchaseOrderQuantity',
      header: 'Open PO Qty',
      accessorKey: 'openPurchaseOrderQuantity',
      sortable: true,
      width: 120,
      minWidth: 90,
      align: 'right',
      cell: (row) => (
        <span className="text-sm text-muted-foreground">
          {(row.openPurchaseOrderQuantity || 0).toLocaleString('en-IN')}
        </span>
      ),
    },
  ];

  const gridState = useDataGrid(columns, 'amazon-inventory');

  const displayItems = gridSearch.trim()
    ? items.filter(i => {
        const q = gridSearch.toLowerCase();
        return (i.productTitle || '').toLowerCase().includes(q) ||
               (i.asin || '').toLowerCase().includes(q) ||
               (i.modelNumber || '').toLowerCase().includes(q) ||
               (i.brand || '').toLowerCase().includes(q);
      })
    : items;

  return (
    <ProtectedRoute>
      <div className="p-4 sm:p-6 space-y-6">
        {/* KPI Cards */}
        <StatsGrid columns={4}>
          <StatsCard
            title="Sellable On-Hand"
            value={stats.totalSellableUnits.toLocaleString('en-IN')}
            icon={Package}
            description="Total sellable units"
            variant="blue"
          />
          <StatsCard
            title="Unsellable"
            value={stats.totalUnsellableUnits.toLocaleString('en-IN')}
            icon={Boxes}
            description="Unsellable on-hand"
            variant="yellow"
          />
          <StatsCard
            title="Open PO Quantity"
            value={stats.totalOpenPOQty.toLocaleString('en-IN')}
            icon={ShoppingCart}
            description="Units on open purchase orders"
            variant="purple"
          />
          <StatsCard
            title="Unique ASINs"
            value={stats.uniqueAsins.toLocaleString('en-IN')}
            icon={Package}
            description="Active SKUs"
            variant="green"
          />
        </StatsGrid>

        {/* Report Date Picker */}
        {reportDates.length > 0 && (
          <SnapshotDatePicker
            availableDates={reportDates}
            selectedDate={reportDate || reportDates[0] || ''}
            onSelect={(d) => { setReportDate(d); setPage(1); }}
            onReset={() => { setReportDate(reportDates[0] || ''); setPage(1); }}
            label="Report Date:"
            className="px-1"
          />
        )}

        {/* Search + toolbar */}
        <FilterBar
          searchPlaceholder="Search ASIN, product name or model number..."
          searchValue={gridSearch}
          onSearchChange={setGridSearch}
        >
          <div className="flex items-center gap-2 ml-auto">
            <ViewOptionsButton
              columns={columns}
              visibleColumns={gridState.visibleColumns}
              onToggleColumn={gridState.toggleColumnVisibility}
              rowDensity={gridState.rowDensity}
              onDensityChange={gridState.setRowDensity}
              onSave={gridState.saveCurrentView}
              onReset={gridState.resetView}
            />
            {displayItems.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                onClick={() => exportToCSV(
                  displayItems.map(item => ({
                    'ASIN': item.asin,
                    'Product': item.productTitle,
                    'Brand': item.brand,
                    'Model / SKU': item.modelNumber,
                    'Sellable On-Hand': item.sellableOnHandUnits,
                    'Unsellable': item.unsellableOnHandUnits,
                    'Open PO Qty': item.openPurchaseOrderQuantity,
                    'Report Date': item.reportDate,
                  })),
                  `amazon_inventory_${reportDate || 'latest'}`
                )}
              >
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            )}
          </div>
        </FilterBar>

        {/* Grid */}
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Showing {displayItems.length} of {total.toLocaleString('en-IN')} products
            {reportDate && ` · Report date: ${fmtDate(reportDate)}`}
          </p>

          {isLoading ? (
            <div className="flex justify-center py-16">
              <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
            </div>
          ) : displayItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 border-2 border-dashed rounded-xl">
              <Package className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-semibold mb-2">No inventory data found</h3>
              <p className="text-sm text-muted-foreground">
                {(globalSearch || gridSearch) ? 'Try adjusting your search' : 'Upload an Amazon Inventory CSV to get started'}
              </p>
            </div>
          ) : (
            <DataGrid
              data={displayItems}
              gridState={gridState}
              serverPagination={gridSearch.trim() ? undefined : { total, page, pageSize: PAGE_SIZE, onPageChange: setPage }}
            />
          )}

        </div>
      </div>
    </ProtectedRoute>
  );
}
