'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useFilter } from '@/contexts/FilterContext';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { StatsCard, StatsGrid } from '@/components/ui/stats-card';
import { FilterBar } from '@/components/ui/filter-bar';
import { DataGrid, GridColumn, useDataGrid, ViewOptionsButton } from '@/components/ui/data-grid';
import { Button } from '@/components/ui/button';
import {
  Package,
  PackageCheck,
  PackageOpen,
  Boxes,
  Download,
} from 'lucide-react';
import { api } from '@/lib/api';
import { FilterPanel, FilterValues, DEFAULT_FILTER_VALUES } from '@/components/ui/filter-panel';
import { exportToCSV } from '@/lib/export';
import { toTitleCase } from '@/lib/format';
import { SnapshotDatePicker } from '@/components/ui/snapshot-date-picker';

interface InventoryItem {
  id: number;
  productName: string;
  asgSku: string;
  amazonId: string | null;
  blinkitId: string | null;
  gs1: string | null;
  packedQty: number;
  unpackedQty: number;
  totalStock: number;
  status: string;
}

export default function InHouseInventoryPage() {
  const { globalSearch } = useFilter();
  const [filters, setFilters] = useState<FilterValues>(DEFAULT_FILTER_VALUES);
  const [gridSearch, setGridSearch] = useState('');

  const handleFilterChange = (key: keyof FilterValues, value: string) =>
    setFilters(prev => ({ ...prev, [key]: value }));

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [inventoryDate, setInventoryDate] = useState<string | null>(null);
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('');

  useEffect(() => {
    const fetchInventory = async () => {
      try {
        setIsLoading(true);
        const params: any = { page_size: 1000 };
        if (selectedDate) params.inventory_date = selectedDate;
        const response = await api.inventory.getDispatchOverview(params) as any;
        const rawItems: any[] = response.items || [];
        setInventoryDate(response.inventoryDate || null);
        if (response.availableDates?.length) {
          setAvailableDates(response.availableDates);
        }

        setItems(rawItems.map((row: any) => ({
          id: row.id,
          productName: row.productName,
          asgSku: row.asgSku,
          amazonId: row.amazonId || null,
          blinkitId: row.blinkitId || null,
          gs1: row.gs1 || null,
          packedQty: row.packedQty || 0,
          unpackedQty: row.unpackedQty || 0,
          totalStock: (row.packedQty || 0) + (row.unpackedQty || 0),
          status: row.status || 'Healthy',
        })));
      } catch (error) {
        console.error('Error fetching inventory:', error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchInventory();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  const filteredItemsRef = useRef<InventoryItem[]>([]);

  // Global search + status filter → drives KPI cards
  const globalFiltered = useMemo(() => {
    let filtered = [...items];
    if (globalSearch) {
      const q = globalSearch.toLowerCase();
      filtered = filtered.filter(
        (item) =>
          (item.productName || '').toLowerCase().includes(q) ||
          (item.asgSku || '').toLowerCase().includes(q) ||
          (item.amazonId || '').toLowerCase().includes(q) ||
          (item.blinkitId || '').toLowerCase().includes(q) ||
          (item.gs1 || '').toLowerCase().includes(q)
      );
    }
    if (filters.status !== 'all') {
      filtered = filtered.filter((item) => {
        const stock = item.packedQty + item.unpackedQty;
        if (filters.status === 'out-of-stock') return stock === 0;
        if (filters.status === 'low-stock') return stock > 0 && stock <= 10;
        if (filters.status === 'in-stock') return stock > 0;
        return true;
      });
    }
    return filtered;
  }, [items, globalSearch, filters.status]);

  // Additional grid-only search → drives grid display and export
  const filteredItems = useMemo(() => {
    if (!gridSearch.trim()) return globalFiltered;
    const q = gridSearch.toLowerCase();
    return globalFiltered.filter(
      (item) =>
        (item.productName || '').toLowerCase().includes(q) ||
        (item.asgSku || '').toLowerCase().includes(q) ||
        (item.amazonId || '').toLowerCase().includes(q) ||
        (item.blinkitId || '').toLowerCase().includes(q) ||
        (item.gs1 || '').toLowerCase().includes(q)
    );
  }, [globalFiltered, gridSearch]);
  filteredItemsRef.current = filteredItems;

  const totalPackedQty = globalFiltered.reduce((s, i) => s + i.packedQty, 0);
  const totalUnpackedQty = globalFiltered.reduce((s, i) => s + i.unpackedQty, 0);
  const totalInHouse = totalPackedQty + totalUnpackedQty;
  const totalSkus = globalFiltered.length;

  const gridColumns: GridColumn<InventoryItem>[] = [
    {
      id: 'productName',
      header: 'Product Name',
      accessorKey: 'productName',
      sortable: true,
      width: 320,
      minWidth: 200,
      wrap: true,
      cell: (row) => (
        <span
          className="font-medium text-sm leading-snug"
          style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
          title={row.productName ?? undefined}
        >
          {toTitleCase(row.productName) || '—'}
        </span>
      ),
    },
    {
      id: 'asgSku',
      header: 'ASG-SKU-ID',
      accessorKey: 'asgSku',
      sortable: true,
      sticky: true,
      width: 180,
      minWidth: 150,
      cell: (row) => (
        <code className="text-xs bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded border border-gray-200 whitespace-nowrap">
          {row.asgSku}
        </code>
      ),
    },
    {
      id: 'amazonId',
      header: 'ASN (Amazon-ID)',
      accessorKey: 'amazonId',
      sortable: true,
      width: 175,
      minWidth: 155,
      cell: (row) =>
        row.amazonId ? (
          <code className="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded border border-blue-200">
            {row.amazonId}
          </code>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'blinkitId',
      header: 'Blinkit-ID',
      accessorKey: 'blinkitId',
      sortable: true,
      width: 140,
      minWidth: 120,
      cell: (row) =>
        row.blinkitId ? (
          <code className="text-xs bg-yellow-50 text-yellow-700 px-1.5 py-0.5 rounded border border-yellow-200">
            {row.blinkitId}
          </code>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'gs1',
      header: 'GS-1',
      accessorKey: 'gs1',
      sortable: true,
      width: 150,
      minWidth: 120,
      cell: (row) =>
        row.gs1 ? (
          <span className="text-xs text-muted-foreground font-mono">{row.gs1}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'packedQty',
      header: 'Packed Qty',
      accessorKey: 'packedQty',
      sortable: true,
      width: 125,
      minWidth: 110,
      align: 'center',
      cell: (row) => (
        <span className={`px-2 py-0.5 rounded text-xs font-semibold border ${
          row.packedQty > 0
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
            : 'text-muted-foreground border-transparent'
        }`}>
          {row.packedQty.toLocaleString('en-IN')}
        </span>
      ),
    },
    {
      id: 'unpackedQty',
      header: 'Unpacked Qty',
      accessorKey: 'unpackedQty',
      sortable: true,
      width: 135,
      minWidth: 115,
      align: 'center',
      cell: (row) => (
        <span className={`px-2 py-0.5 rounded text-xs font-semibold border ${
          row.unpackedQty > 0
            ? 'bg-yellow-50 text-yellow-700 border-yellow-200'
            : 'text-muted-foreground border-transparent'
        }`}>
          {row.unpackedQty.toLocaleString('en-IN')}
        </span>
      ),
    },
    {
      id: 'totalStock',
      header: 'Total In-House Stock',
      accessorKey: 'totalStock',
      sortable: true,
      width: 165,
      minWidth: 130,
      align: 'right',
      cell: (row) => {
        const total = row.packedQty + row.unpackedQty;
        return (
          <span className={`px-2 py-0.5 rounded text-xs font-bold border ${
            total > 0
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : 'bg-red-50 text-red-600 border-red-200'
          }`}>
            {total.toLocaleString('en-IN')}
          </span>
        );
      },
    },
  ];

  const gridState = useDataGrid(gridColumns, 'asg-inhouse-inventory');

  const statusOptions = [
    { label: 'All Products', value: 'all' },
    { label: 'In Stock', value: 'in-stock' },
    { label: 'Low Stock', value: 'low-stock' },
    { label: 'Out of Stock', value: 'out-of-stock' },
  ];

  if (isLoading) {
    return (
      <ProtectedRoute>
        <div className="p-6 flex items-center justify-center">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
            <p className="text-muted-foreground">Loading inventory...</p>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="p-6 space-y-6">
        {/* KPI Cards */}
        <StatsGrid columns={4}>
          <StatsCard
            title="Total SKUs"
            value={totalSkus}
            icon={Package}
            description="Active products"
            variant="purple"
          />
          <StatsCard
            title="Packed Qty"
            value={totalPackedQty.toLocaleString('en-IN')}
            icon={PackageCheck}
            description={inventoryDate ? `ASG stock as of ${inventoryDate}` : 'Ready to ship'}
            variant="green"
          />
          <StatsCard
            title="Unpacked Qty"
            value={totalUnpackedQty.toLocaleString('en-IN')}
            icon={PackageOpen}
            description="Raw stock"
            variant="yellow"
          />
          <StatsCard
            title="Total In-House"
            value={totalInHouse.toLocaleString('en-IN')}
            icon={Boxes}
            description="Packed + Unpacked"
            variant="blue"
          />
        </StatsGrid>

        {/* ASG Snapshot Date Selector */}
        {availableDates.length > 0 && (
          <SnapshotDatePicker
            availableDates={availableDates}
            selectedDate={selectedDate || availableDates[0] || ''}
            onSelect={setSelectedDate}
            onReset={() => setSelectedDate('')}
            className="px-1"
          />
        )}

        {/* Filters */}
        <FilterBar
          searchPlaceholder="Search by name, SKU, ASIN, Blinkit ID or GS-1..."
          searchValue={gridSearch}
          onSearchChange={setGridSearch}
        >
          <div className="flex items-center gap-2 ml-auto">
            <FilterPanel
              values={filters}
              onChange={handleFilterChange}
              onClear={() => { setFilters(DEFAULT_FILTER_VALUES); setGridSearch(''); setSelectedDate(''); }}
              showStatus
              statusOptions={statusOptions}
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
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              onClick={() => exportToCSV(
                filteredItemsRef.current.map(i => ({
                  'Product Name': i.productName,
                  'ASG SKU': i.asgSku,
                  'Amazon ID': i.amazonId ?? '',
                  'Blinkit ID': i.blinkitId ?? '',
                  'GS-1': i.gs1 ?? '',
                  'Packed Qty': i.packedQty,
                  'Unpacked Qty': i.unpackedQty,
                  'Total In-House Stock': i.totalStock,
                  'Status': i.status,
                })),
                'inhouse-inventory'
              )}
            >
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
          </div>
        </FilterBar>

        {/* Data Grid */}
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Showing {filteredItems.length} of {globalFiltered.length} products
            {(globalSearch || gridSearch) && ` · filtered`}
          </p>

          {filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-4 border-2 border-dashed rounded-xl">
              <Package className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-semibold mb-2">No inventory items found</h3>
              <p className="text-sm text-muted-foreground text-center max-w-md">
                {(globalSearch || gridSearch) ? 'Try adjusting your search or filter criteria' : 'No products available at the moment'}
              </p>
            </div>
          ) : (
            <DataGrid data={filteredItems} gridState={gridState} />
          )}
        </div>
      </div>
    </ProtectedRoute>
  );
}
