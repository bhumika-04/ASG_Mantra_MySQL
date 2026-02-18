'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
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
  CalendarDays,
} from 'lucide-react';
import { api } from '@/lib/api';
import { FilterPanel, FilterValues, DEFAULT_FILTER_VALUES } from '@/components/ui/filter-panel';
import { exportToCSV } from '@/lib/export';

interface InventoryItem {
  id: number;
  productName: string;
  asgSku: string;
  amazonId: string | null;
  blinkitId: string | null;
  gs1: string | null;
  packedQty: number;
  unpackedQty: number;
  amazonStock: number;
  blinkitStock: number;
  totalStock: number;
  reorderLevel: number | null;
  status: string;
}

export default function DispatchInventoryPage() {
  const [filters, setFilters] = useState<FilterValues>(DEFAULT_FILTER_VALUES);
  const [search, setSearch] = useState('');

  const handleFilterChange = (key: keyof FilterValues, value: string) =>
    setFilters(prev => ({ ...prev, [key]: value }));
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [amazonDate, setAmazonDate] = useState<string | null>(null);
  const [blinkitDate, setBlinkitDate] = useState<string | null>(null);
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
        setAmazonDate(response.amazonDate || null);
        setBlinkitDate(response.blinkitDate || null);
        setInventoryDate(response.inventoryDate || null);
        if (response.availableDates?.length) {
          setAvailableDates(response.availableDates);
        }

        // Endpoint already returns one row per product with correct platform stock
        setItems(rawItems.map((row: any) => ({
          id: row.id,
          productName: row.productName,
          asgSku: row.asgSku,
          amazonId: row.amazonId || null,
          blinkitId: row.blinkitId || null,
          gs1: row.gs1 || null,
          packedQty: row.packedQty || 0,
          unpackedQty: row.unpackedQty || 0,
          amazonStock: row.amazonStock || 0,
          blinkitStock: row.blinkitStock || 0,
          totalStock: row.totalStock || 0,
          reorderLevel: row.reorderLevel || null,
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

  const filteredItems = useMemo(() => {
    let filtered = [...items];

    if (filters.channel !== 'all') {
      filtered = filtered.filter((item) =>
        filters.channel === 'amazon' ? item.amazonStock > 0 : item.blinkitStock > 0
      );
    }

    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        (item) =>
          item.productName.toLowerCase().includes(q) ||
          item.asgSku.toLowerCase().includes(q) ||
          (item.amazonId && item.amazonId.toLowerCase().includes(q)) ||
          (item.blinkitId && item.blinkitId.toLowerCase().includes(q)) ||
          (item.gs1 && item.gs1.toLowerCase().includes(q))
      );
    }

    if (filters.status !== 'all') {
      filtered = filtered.filter((item) => {
        const stock = filters.channel === 'amazon' ? item.amazonStock : filters.channel === 'blinkit' ? item.blinkitStock : item.totalStock;
        if (filters.status === 'out-of-stock') return stock === 0;
        if (filters.status === 'low-stock') return stock > 0 && item.reorderLevel !== null && stock < item.reorderLevel;
        if (filters.status === 'in-stock') return stock > 0;
        return true;
      });
    }

    return filtered;
  }, [items, search, filters.status, filters.channel]);
  filteredItemsRef.current = filteredItems;

  const amazonStock = items.reduce((s, i) => s + i.amazonStock, 0);
  const blinkitStock = items.reduce((s, i) => s + i.blinkitStock, 0);
  const totalPackedQty = items.reduce((s, i) => s + i.packedQty, 0);
  const totalUnpackedQty = items.reduce((s, i) => s + i.unpackedQty, 0);
  const totalSkus = filteredItems.length;

  const gridColumns: GridColumn<InventoryItem>[] = [
    {
      id: 'rowNumber',
      header: '#',
      width: 55,
      minWidth: 45,
      align: 'center',
      cell: (row) => <span className="text-muted-foreground font-medium">{filteredItemsRef.current.indexOf(row) + 1}</span>,
    },
    {
      id: 'productName',
      header: 'Product Name',
      accessorKey: 'productName',
      sortable: true,
      width: 360,
      minWidth: 200,
      cell: (row) => (
        <span
          className="font-medium text-sm leading-snug"
          style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
          title={row.productName ?? undefined}
        >
          {row.productName || '—'}
        </span>
      ),
    },
    {
      id: 'asgSku',
      header: 'ASG-SKU-ID',
      accessorKey: 'asgSku',
      sortable: true,
      width: 175,
      minWidth: 130,
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
      width: 150,
      minWidth: 120,
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
      width: 135,
      minWidth: 110,
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
      width: 145,
      minWidth: 110,
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
      width: 115,
      minWidth: 95,
      align: 'center',
      cell: (row) => (
        <span className={`px-2 py-0.5 rounded text-xs font-semibold border ${
          row.packedQty > 0
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
            : 'text-muted-foreground border-transparent'
        }`}>
          {row.packedQty.toLocaleString()}
        </span>
      ),
    },
    {
      id: 'unpackedQty',
      header: 'Unpacked Qty',
      accessorKey: 'unpackedQty',
      sortable: true,
      width: 120,
      minWidth: 100,
      align: 'center',
      cell: (row) => (
        <span className={`px-2 py-0.5 rounded text-xs font-semibold border ${
          row.unpackedQty > 0
            ? 'bg-yellow-50 text-yellow-700 border-yellow-200'
            : 'text-muted-foreground border-transparent'
        }`}>
          {row.unpackedQty.toLocaleString()}
        </span>
      ),
    },
    {
      id: 'amazonStock',
      header: 'Amazon Inv',
      accessorKey: 'amazonStock',
      sortable: true,
      width: 115,
      minWidth: 95,
      align: 'right',
      cell: (row) => (
        <span className={row.amazonStock > 0 ? 'text-blue-600 font-bold text-sm' : 'text-muted-foreground text-sm'}>
          {row.amazonStock.toLocaleString()}
        </span>
      ),
    },
    {
      id: 'blinkitStock',
      header: 'Blinkit Inv',
      accessorKey: 'blinkitStock',
      sortable: true,
      width: 115,
      minWidth: 95,
      align: 'right',
      cell: (row) => (
        <span className={row.blinkitStock > 0 ? 'text-yellow-600 font-bold text-sm' : 'text-muted-foreground text-sm'}>
          {row.blinkitStock.toLocaleString()}
        </span>
      ),
    },
    {
      id: 'totalStock',
      header: 'Total Stock',
      accessorKey: 'totalStock',
      sortable: true,
      width: 120,
      minWidth: 100,
      align: 'right',
      cell: (row) => (
        <span className={`px-2 py-0.5 rounded text-xs font-bold border ${
          row.totalStock > 0
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
            : 'bg-red-50 text-red-600 border-red-200'
        }`}>
          {row.totalStock.toLocaleString()}
        </span>
      ),
    },
  ];

  const gridState = useDataGrid(gridColumns);

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
        <StatsGrid columns={5}>
          <StatsCard
            title="Total SKUs"
            value={totalSkus}
            icon={Package}
            description="Active products"
            variant="purple"
          />
          <StatsCard
            title="Packed Qty"
            value={totalPackedQty.toLocaleString()}
            icon={PackageCheck}
            description={inventoryDate ? `ASG stock as of ${inventoryDate}` : 'Ready to ship'}
            variant="green"
          />
          <StatsCard
            title="Unpacked Qty"
            value={totalUnpackedQty.toLocaleString()}
            icon={PackageOpen}
            description="Raw stock"
            variant="yellow"
          />
          <StatsCard
            title="Amazon Inv"
            value={amazonStock.toLocaleString()}
            icon={PackageCheck}
            description={amazonDate ? `As of ${amazonDate}` : 'Units in Amazon'}
            variant="blue"
          />
          <StatsCard
            title="Blinkit Inv"
            value={blinkitStock.toLocaleString()}
            icon={Boxes}
            description={blinkitDate ? `As of ${blinkitDate}` : 'Units in Blinkit'}
            variant="orange"
          />
        </StatsGrid>

        {/* Filters */}
        <FilterBar
          searchPlaceholder="Search by name, SKU, ASIN, Blinkit ID or GS-1..."
          searchValue={search}
          onSearchChange={setSearch}
        >
          <div className="flex items-center gap-2 ml-auto">
            {availableDates.length > 1 && (
              <div className="flex items-center gap-1.5 border rounded-md px-2 h-9 bg-white text-sm text-muted-foreground">
                <CalendarDays className="h-4 w-4 shrink-0" />
                <select
                  className="border-none outline-none bg-transparent text-sm text-foreground cursor-pointer"
                  value={selectedDate || inventoryDate || ''}
                  onChange={e => setSelectedDate(e.target.value)}
                  title="Select ASG inventory date"
                >
                  {availableDates.map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
            )}
            <FilterPanel
              values={filters}
              onChange={handleFilterChange}
              onClear={() => { setFilters(DEFAULT_FILTER_VALUES); setSearch(''); }}
              showChannel
              showStatus
              statusOptions={statusOptions}
            />
            <ViewOptionsButton
              columns={gridColumns}
              visibleColumns={gridState.visibleColumns}
              onToggleColumn={gridState.toggleColumnVisibility}
              rowDensity={gridState.rowDensity}
              onDensityChange={gridState.setRowDensity}
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
                  'Amazon Stock': i.amazonStock,
                  'Blinkit Stock': i.blinkitStock,
                  'Total Stock': i.totalStock,
                  'Reorder Level': i.reorderLevel ?? '',
                  'Status': i.status,
                })),
                'inventory'
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
            Showing {filteredItems.length} of {items.length} products
            {search && ` matching "${search}"`}
          </p>

          {filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-4 border-2 border-dashed rounded-xl">
              <Package className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-semibold mb-2">No inventory items found</h3>
              <p className="text-sm text-muted-foreground text-center max-w-md">
                {search ? 'Try adjusting your search or filter criteria' : 'No products available at the moment'}
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
