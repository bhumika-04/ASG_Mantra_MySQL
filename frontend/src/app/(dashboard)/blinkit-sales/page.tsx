'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useFilter, computeDateRange, computeGrowthPrevPeriod, FilterMode } from '@/contexts/FilterContext';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { StatsCard, StatsGrid } from '@/components/ui/stats-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, Package, TrendingDown, DollarSign, RefreshCw, Search, X, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DataGrid, useDataGrid, ViewOptionsButton } from '@/components/ui/data-grid';
import { exportToCSV } from '@/lib/export';
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
import { fmtDate } from '@/lib/format';

interface BlinkitProduct {
  itemId: string;
  itemName: string;
  totalQty: number;
  totalRevenue: number;
  firstSale: string | null;
  lastSale: string | null;
}

const PAGE_SIZE = 50;

export default function BlinkitSalesPage() {
  const { filterMode, customStart, customEnd, globalSearch } = useFilter();
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [stats, setStats] = useState({
    total_qty: 0,
    total_revenue: 0,
    active_items: 0,
    monthly_growth: 0,
    total_records_all_time: 0,
  });
  const [dailyTrend, setDailyTrend] = useState<any[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);
  const fetchSeqRef = useRef(0);

  // Products grid state
  const [products, setProducts] = useState<BlinkitProduct[]>([]);
  const [productsTotal, setProductsTotal] = useState(0);
  const [productsPage, setProductsPage] = useState(1);
  const [isProductsLoading, setIsProductsLoading] = useState(false);
  const [gridSearch, setGridSearch] = useState('');

  const gridState = useDataGrid<BlinkitProduct>([
    {
      id: 'itemName', header: 'Product Name', accessorKey: 'itemName', sortable: true, width: 300, minWidth: 180, wrap: true,
      cell: (row) => (
        <span
          className="font-medium text-sm leading-snug"
          style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
          title={row.itemName}
        >
          {row.itemName || '—'}
        </span>
      ),
    },
    {
      id: 'itemId', header: 'Item ID', accessorKey: 'itemId', sortable: true, sticky: true, width: 130, minWidth: 100,
      cell: (row) => (
        <code className="text-xs bg-yellow-50 text-yellow-700 px-2 py-1 rounded border border-yellow-200">
          {row.itemId || '—'}
        </code>
      ),
    },
    {
      id: 'totalQty', header: 'Total Qty Sold', accessorKey: 'totalQty', sortable: true, width: 130, align: 'right',
      cell: (row) => <span className="font-mono font-semibold text-yellow-600">{Math.round(row.totalQty).toLocaleString('en-IN')}</span>,
    },
    {
      id: 'totalRevenue', header: 'Revenue (₹)', accessorKey: 'totalRevenue', sortable: true, width: 130, align: 'right',
      cell: (row) => <span className="font-mono text-gray-700">₹{Math.round(row.totalRevenue).toLocaleString('en-IN')}</span>,
    },
    {
      id: 'firstSale', header: 'First Sale', accessorKey: 'firstSale', sortable: true, width: 110,
      cell: (row) => <span className="text-sm text-gray-500">{fmtDate(row.firstSale)}</span>,
    },
    {
      id: 'lastSale', header: 'Last Sale', accessorKey: 'lastSale', sortable: true, width: 110,
      cell: (row) => <span className="text-sm text-gray-500">{fmtDate(row.lastSale)}</span>,
    },
  ], 'blinkit-sales');

  const getDateParams = useCallback(() => {
    const current = filterMode === 'all' ? {} : computeDateRange(filterMode as FilterMode, customStart, customEnd);
    const prev = computeGrowthPrevPeriod(filterMode as FilterMode, customStart, customEnd);
    return {
      ...(current.start_date ? { start_date: current.start_date } : {}),
      ...(current.end_date ? { end_date: current.end_date } : {}),
      ...(prev.start_date ? { prev_start_date: prev.start_date } : {}),
      ...(prev.end_date ? { prev_end_date: prev.end_date } : {}),
    };
  }, [filterMode, customStart, customEnd]);

  const fetchAnalytics = useCallback(async (item_id: string = '') => {
    const seq = ++fetchSeqRef.current;
    try {
      setFetchError(null);
      if (!hasLoadedRef.current) {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }
      const dateParams = getDateParams();
      const analytics = await (api as any).blinkitSalesData.getAnalytics({
        ...dateParams,
        ...(item_id ? { item_id } : {}),
      }) as any;
      if (fetchSeqRef.current !== seq) return;
      setStats({
        total_qty: analytics.summary?.total_qty || 0,
        total_revenue: analytics.summary?.total_revenue || 0,
        active_items: analytics.summary?.active_items || 0,
        monthly_growth: analytics.summary?.monthly_growth || 0,
        total_records_all_time: analytics.summary?.total_records_all_time || 0,
      });
      setDailyTrend(analytics.daily_trend || []);
      hasLoadedRef.current = true;
    } catch (error: any) {
      if (fetchSeqRef.current !== seq) return;
      setFetchError(error?.message || String(error));
    } finally {
      if (fetchSeqRef.current === seq) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [getDateParams]); // hasLoadedRef is a ref — always fresh, no dep needed

  const fetchProducts = useCallback(async (page = 1, search = '') => {
    setIsProductsLoading(true);
    try {
      const data: any = await (api as any).blinkitSalesData.getProducts({
        page,
        page_size: PAGE_SIZE,
        ...(search ? { search } : {}),  // grid-level search
        ...getDateParams(),
      });
      setProducts(data.items || []);
      setProductsTotal(data.total || 0);
    } catch {
      setProducts([]);
    } finally {
      setIsProductsLoading(false);
    }
  }, [getDateParams]);

  // Analytics + grid: re-run when date range or global search changes
  useEffect(() => {
    if (filterMode === 'custom' && !customStart) return;
    fetchAnalytics(globalSearch);
  }, [fetchAnalytics, globalSearch, filterMode, customStart, customEnd]);

  useEffect(() => {
    setProductsPage(1);
    fetchProducts(1, globalSearch);
  }, [fetchProducts, globalSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  const growth = stats.monthly_growth;

  if (isLoading) {
    return (
      <ProtectedRoute>
        <div className="p-6 flex items-center justify-center">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-yellow-600 mb-4"></div>
            <p className="text-muted-foreground">Loading Blinkit sales data...</p>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="p-4 sm:p-6 space-y-6">
        {isRefreshing && (
          <div className="flex items-center gap-2 text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 rounded px-3 py-2">
            <RefreshCw className="h-3 w-3 animate-spin" />
            Updating to selected date range…
          </div>
        )}

        {fetchError && (
          <div className="p-4 bg-red-50 border border-red-300 rounded-lg text-sm text-red-800">
            <strong>API Error:</strong> {fetchError}
          </div>
        )}

        {/* KPI Cards */}
        <StatsGrid columns={4}>
          <StatsCard title="Total Qty Sold" value={Math.round(stats.total_qty).toLocaleString('en-IN')} icon={Package} description="Units sold" variant="yellow" />
          <StatsCard title="Total Revenue" value={`₹${Math.round(stats.total_revenue).toLocaleString('en-IN')}`} icon={DollarSign} description="MRP-based revenue" variant="yellow" />
          <StatsCard title="Active Products" value={stats.active_items.toString()} icon={TrendingUp} description="Distinct items sold" variant="yellow" />
          <StatsCard
            title="Period Growth"
            value={`${growth >= 0 ? '+' : ''}${growth.toFixed(1)}%`}
            icon={growth >= 0 ? TrendingUp : TrendingDown}
            description={(() => {
              switch (filterMode) {
                case 'this_week': return 'vs last complete week';
                case 'last_week': return 'vs the week prior';
                case 'this_month': return 'vs same days last month';
                case 'last_month': return 'vs the month before';
                case 'this_year': return 'vs same period last year';
                case 'last_year': return 'vs year before last';
                case '3months': return 'vs prior 3 months';
                case '6months': return 'vs prior 6 months';
                case '1month': return 'vs prior 30 days';
                case '1year': return 'vs prior year';
                case 'custom': return 'vs equivalent prior period';
                default: return 'vs prior 30 days';
              }
            })()}
            trend={{ value: growth, isPositive: growth >= 0 }}
            variant="yellow"
          />
        </StatsGrid>

        {/* Daily Sales Trend Chart */}
        <Card>
          <CardHeader>
            <CardTitle>
              Daily Sales Trend{globalSearch ? ` — ${globalSearch}` : ''}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {dailyTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={dailyTrend}>
                  <defs>
                    <linearGradient id="colorBlinkitSales" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#fbbf24" stopOpacity={0.6}/>
                      <stop offset="95%" stopColor="#fde68a" stopOpacity={0.05}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={{ stroke: '#e5e7eb' }} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: '#6b7280', fontSize: 12 }} axisLine={{ stroke: '#e5e7eb' }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '8px' }}
                    formatter={(value: number | undefined) => [Number(value ?? 0).toLocaleString('en-IN'), 'Qty Sold']}
                  />
                  <Area type="monotone" dataKey="total_qty" stroke="#fbbf24" fill="url(#colorBlinkitSales)" strokeWidth={2} name="Qty Sold" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-64 flex items-center justify-center text-muted-foreground">
                {isRefreshing ? (
                  <div className="flex items-center gap-2"><RefreshCw className="h-4 w-4 animate-spin" /> Loading chart…</div>
                ) : stats.total_records_all_time > 0
                  ? `No data in selected date range (${stats.total_records_all_time.toLocaleString('en-IN')} records exist in DB)`
                  : 'No Blinkit sales data uploaded yet'}
              </div>
            )}
          </CardContent>
        </Card>

        {/* All Products Grid */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <CardTitle className="text-base font-medium">
                All Products ({productsTotal.toLocaleString('en-IN')})
              </CardTitle>
              <div className="flex items-center gap-2">
                {/* Grid search */}
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Search products…"
                    value={gridSearch}
                    onChange={e => setGridSearch(e.target.value.replace(/^\s+/, ''))}
                    onKeyDown={e => { if (e.key === 'Enter') { setProductsPage(1); fetchProducts(1, gridSearch.trim() || globalSearch); } }}
                    className="h-8 pl-8 pr-7 text-xs border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-yellow-500 w-44"
                  />
                  {gridSearch && (
                    <button onClick={() => { setGridSearch(''); setProductsPage(1); fetchProducts(1, globalSearch); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {/* Export */}
                {products.length > 0 && (
                  <Button variant="outline" size="sm" className="h-8" onClick={() => exportToCSV(
                    products.map(p => ({
                      'Product Name': p.itemName,
                      'Item ID': p.itemId,
                      'Total Qty Sold': Math.round(p.totalQty),
                      'Revenue (₹)': Math.round(p.totalRevenue),
                      'First Sale': p.firstSale || '',
                      'Last Sale': p.lastSale || '',
                    })),
                    'blinkit_sales_products'
                  )}>
                    <Download className="h-4 w-4 mr-1.5" />
                    Export
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => { setProductsPage(1); fetchProducts(1, gridSearch.trim() || globalSearch); }}>
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
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-500" />
                <p className="mt-3 text-sm text-gray-500">Loading products...</p>
              </div>
            ) : products.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">
                <Package className="h-10 w-10 mx-auto mb-3 text-gray-300" />
                <p className="text-sm font-medium">No products found</p>
                <p className="text-xs mt-1">Upload Blinkit sales data to see products here</p>
              </div>
            ) : (
              <>
                <DataGrid
                  data={products}
                  gridState={gridState}
                  serverPagination={{
                    total: productsTotal,
                    page: productsPage,
                    pageSize: PAGE_SIZE,
                    onPageChange: (p) => { setProductsPage(p); fetchProducts(p, gridSearch.trim() || globalSearch); },
                  }}
                />
                <p className="text-sm text-gray-500 pt-2">{productsTotal.toLocaleString('en-IN')} products</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </ProtectedRoute>
  );
}
