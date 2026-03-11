'use client';

import { useState, useEffect, useCallback } from 'react';
import { useFilter, computeDateRange, FilterMode } from '@/contexts/FilterContext';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { StatsCard, StatsGrid } from '@/components/ui/stats-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, Package, TrendingDown, BarChart2, Search, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataGrid, useDataGrid, ViewOptionsButton } from '@/components/ui/data-grid';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import api from '@/lib/api';

interface AmazonProduct {
  asin: string;
  productTitle: string;
  sku: string;
  totalUnits: number;
  totalRevenue: number;
  firstSale: string | null;
  lastSale: string | null;
}

function filterTrend(data: any[], mode: string, customStart: string, customEnd: string) {
  if (mode === 'all') return data;
  const { start_date, end_date } = computeDateRange(mode as FilterMode, customStart, customEnd);
  return data.filter((d) => {
    const date = (d.date || '').slice(0, 10);
    if (start_date && date < start_date) return false;
    if (end_date && date > end_date) return false;
    return true;
  });
}

const PAGE_SIZE = 50;

export default function AmazonSalesPage() {
  const { filterMode, customStart, customEnd } = useFilter();
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState({
    total_units: 0,
    active_products: 0,
    avg_units_per_product: 0,
    monthly_growth: 0,
    total_records_all_time: 0,
  });
  const [dailyTrend, setDailyTrend] = useState<any[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Products grid state
  const [products, setProducts] = useState<AmazonProduct[]>([]);
  const [productsTotal, setProductsTotal] = useState(0);
  const [productsTotalPages, setProductsTotalPages] = useState(1);
  const [productsPage, setProductsPage] = useState(1);
  const [productsSearch, setProductsSearch] = useState('');
  const [isProductsLoading, setIsProductsLoading] = useState(false);

  const gridState = useDataGrid<AmazonProduct>([
    {
      id: 'productTitle', header: 'Product Name', accessorKey: 'productTitle', sortable: true, width: 300, minWidth: 180,
      cell: (row) => (
        <span
          className="font-medium text-sm leading-snug"
          style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
          title={row.productTitle}
        >
          {row.productTitle || '—'}
        </span>
      ),
    },
    {
      id: 'asin', header: 'ASIN', accessorKey: 'asin', sortable: true, width: 130,
      cell: (row) => (
        <code className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded border border-blue-200">
          {row.asin || '—'}
        </code>
      ),
    },
    {
      id: 'sku', header: 'SKU', accessorKey: 'sku', sortable: true, sticky: true, width: 150, minWidth: 120,
      cell: (row) => <span className="text-sm text-gray-600">{row.sku || '—'}</span>,
    },
    {
      id: 'totalUnits', header: 'Total Units', accessorKey: 'totalUnits', sortable: true, width: 120, align: 'right',
      cell: (row) => <span className="font-mono font-semibold text-blue-600">{row.totalUnits.toLocaleString()}</span>,
    },
    {
      id: 'totalRevenue', header: 'Revenue (₹)', accessorKey: 'totalRevenue', sortable: true, width: 130, align: 'right',
      cell: (row) => <span className="font-mono text-gray-700">₹{Math.round(row.totalRevenue).toLocaleString()}</span>,
    },
    {
      id: 'firstSale', header: 'First Sale', accessorKey: 'firstSale', sortable: true, width: 110,
      cell: (row) => <span className="text-sm text-gray-500">{row.firstSale || '—'}</span>,
    },
    {
      id: 'lastSale', header: 'Last Sale', accessorKey: 'lastSale', sortable: true, width: 110,
      cell: (row) => <span className="text-sm text-gray-500">{row.lastSale || '—'}</span>,
    },
  ], 'amazon-sales');

  const fetchProducts = useCallback(async (page = 1, search = '') => {
    setIsProductsLoading(true);
    try {
      const data: any = await (api as any).amazonSalesData.getProducts({
        page,
        page_size: PAGE_SIZE,
        ...(search ? { search } : {}),
      });
      setProducts(data.items || []);
      setProductsTotal(data.total || 0);
      setProductsTotalPages(data.total_pages || 1);
    } catch {
      setProducts([]);
    } finally {
      setIsProductsLoading(false);
    }
  }, []);

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        setIsLoading(true);
        setFetchError(null);
        const analytics = await (api as any).amazonSalesData.getAnalytics({ days: 1825 }) as any;
        setStats({
          total_units: analytics.summary?.total_units || 0,
          active_products: analytics.summary?.active_products || 0,
          avg_units_per_product: analytics.summary?.avg_units_per_product || 0,
          monthly_growth: analytics.summary?.monthly_growth || 0,
          total_records_all_time: analytics.summary?.total_records_all_time || 0,
        });
        setDailyTrend(analytics.daily_trend || []);
      } catch (error: any) {
        setFetchError(error?.message || String(error));
      } finally {
        setIsLoading(false);
      }
    };
    fetchAnalytics();
    fetchProducts(1, '');
  }, [fetchProducts]);

  const handleProductSearch = () => {
    setProductsPage(1);
    fetchProducts(1, productsSearch);
  };

  const growth = stats.monthly_growth;

  if (isLoading) {
    return (
      <ProtectedRoute>
        <div className="p-6 flex items-center justify-center">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
            <p className="text-muted-foreground">Loading Amazon sales data...</p>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="p-6 space-y-6">
        {fetchError && (
          <div className="p-4 bg-red-50 border border-red-300 rounded-lg text-sm text-red-800">
            <strong>API Error:</strong> {fetchError}
          </div>
        )}

        {/* KPI Cards */}
        <StatsGrid columns={4}>
          <StatsCard title="Total Sales" value={stats.total_units.toLocaleString()} icon={Package} description="Ordered units" variant="blue" />
          <StatsCard title="Active Products" value={stats.active_products.toString()} icon={BarChart2} description="Distinct ASINs" variant="blue" />
          <StatsCard title="Avg Sales/Product" value={stats.avg_units_per_product.toLocaleString()} icon={TrendingUp} description="Units per product" variant="blue" />
          <StatsCard
            title="Monthly Growth"
            value={`${growth >= 0 ? '+' : ''}${growth.toFixed(1)}%`}
            icon={growth >= 0 ? TrendingUp : TrendingDown}
            description="vs previous 30-day period"
            trend={{ value: growth, isPositive: growth >= 0 }}
            variant="blue"
          />
        </StatsGrid>

        {/* Daily Sales Trend Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Daily Sales Trend</CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const filtered = filterMode === 'custom' && (!customStart || !customEnd)
                ? dailyTrend
                : filterTrend(dailyTrend, filterMode, customStart, customEnd);
              return filtered.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={filtered}>
                    <defs>
                      <linearGradient id="colorAmazonSales" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.6}/>
                        <stop offset="95%" stopColor="#93c5fd" stopOpacity={0.05}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={{ stroke: '#e5e7eb' }} interval="preserveStartEnd" />
                    <YAxis tick={{ fill: '#6b7280', fontSize: 12 }} axisLine={{ stroke: '#e5e7eb' }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '8px' }}
                      formatter={(value: number | undefined) => [Number(value ?? 0).toLocaleString(), 'Units']}
                    />
                    <Area type="monotone" dataKey="total_units" stroke="#60a5fa" fill="url(#colorAmazonSales)" strokeWidth={2} name="Ordered Units" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-64 flex items-center justify-center text-muted-foreground">
                  {stats.total_records_all_time > 0
                    ? `No data in selected date range (${stats.total_records_all_time.toLocaleString()} records exist in DB)`
                    : 'No Amazon sales data uploaded yet'}
                </div>
              );
            })()}
          </CardContent>
        </Card>

        {/* All Products Grid */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <CardTitle className="text-base font-medium">
                All Products ({productsTotal.toLocaleString()})
              </CardTitle>
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  <Input
                    placeholder="Search by product or ASIN..."
                    value={productsSearch}
                    onChange={(e) => setProductsSearch(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleProductSearch()}
                    className="h-9 w-56 text-sm"
                  />
                  <Button variant="outline" size="sm" onClick={handleProductSearch}>
                    <Search className="h-4 w-4" />
                  </Button>
                </div>
                <Button variant="outline" size="sm" onClick={() => { setProductsPage(1); fetchProducts(1, productsSearch); }}>
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
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {isProductsLoading ? (
              <div className="text-center py-10">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
                <p className="mt-3 text-sm text-gray-500">Loading products...</p>
              </div>
            ) : products.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">
                <Package className="h-10 w-10 mx-auto mb-3 text-gray-300" />
                <p className="text-sm font-medium">No products found</p>
                <p className="text-xs mt-1">Upload Amazon sales data to see products here</p>
              </div>
            ) : (
              <>
                <DataGrid data={products} gridState={gridState} pageSize={PAGE_SIZE} />
                <div className="flex items-center justify-between pt-2">
                  <p className="text-sm text-gray-500">{productsTotal.toLocaleString()} products</p>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => { const p = Math.max(1, productsPage - 1); setProductsPage(p); fetchProducts(p, productsSearch); }} disabled={productsPage === 1}>
                      Previous
                    </Button>
                    <span className="text-sm text-gray-500">Page {productsPage} of {productsTotalPages}</span>
                    <Button variant="outline" size="sm" onClick={() => { const p = Math.min(productsTotalPages, productsPage + 1); setProductsPage(p); fetchProducts(p, productsSearch); }} disabled={productsPage === productsTotalPages}>
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
