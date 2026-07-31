'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useFilter, computeDateRange, FilterMode } from '@/contexts/FilterContext';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { StatsCard, StatsGrid } from '@/components/ui/stats-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataGrid, GridColumn, useDataGrid } from '@/components/ui/data-grid';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TrendingUp, ShoppingCart, Package, Box, Download, Search, X } from 'lucide-react';
import { exportToCSV } from '@/lib/export';
import { fmtCurrency } from '@/lib/format';
import {
  BarChart,
  Bar,
  Legend,
  PieChart,
  Pie,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import api from '@/lib/api';

interface TopProduct {
  rank: number;
  name: string;
  sku: string;
  amazon: number;
  blinkit: number;
  total: number;
  amazonRevenue: number;
  blinkitRevenue: number;
}

function isoToMonthLabel(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

function aggregateDailyToMonthly(
  amazonTrend: any[],
  blinkitTrend: any[],
): { month: string; sortKey: string; Amazon: number; Blinkit: number }[] {
  const map = new Map<string, { Amazon: number; Blinkit: number }>();

  for (const row of amazonTrend) {
    const key = (row.date || '').slice(0, 7);
    if (!key) continue;
    const entry = map.get(key) || { Amazon: 0, Blinkit: 0 };
    entry.Amazon += row.total_units || 0;
    map.set(key, entry);
  }
  for (const row of blinkitTrend) {
    const key = (row.date || '').slice(0, 7);
    if (!key) continue;
    const entry = map.get(key) || { Amazon: 0, Blinkit: 0 };
    entry.Blinkit += row.total_qty || 0;
    map.set(key, entry);
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, vals]) => ({
      sortKey: key,
      month: isoToMonthLabel(key + '-01'),
      Amazon: Math.round(vals.Amazon),
      Blinkit: Math.round(vals.Blinkit),
    }));
}

export default function SalesOverviewPage() {
  const { filterMode, customStart, customEnd, channel, globalSearch } = useFilter();
  const [gridSearch, setGridSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState({
    total_revenue: 0,
    total_orders: 0,
    amazon_revenue: 0,
    blinkit_revenue: 0,
    amazon_units: 0,
    blinkit_units: 0,
    activeProducts: 0,
  });
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [monthlyData, setMonthlyData] = useState<any[]>([]);
  const [productChannel, setProductChannel] = useState<'all' | 'amazon' | 'blinkit'>('all');
  const fetchSeqRef = useRef(0);

  const getDateParams = useCallback(() => {
    const { start_date, end_date } = computeDateRange(filterMode, customStart, customEnd);
    return { start_date, end_date };
  }, [filterMode, customStart, customEnd]);

  // Sync global channel filter → local productChannel (controls chart bars + pie)
  useEffect(() => {
    setProductChannel(channel === 'all' ? 'all' : channel as 'amazon' | 'blinkit');
  }, [channel]);

  // Hide the other channel's column when a single channel is selected
  useEffect(() => {
    gridState.setColumnVisible('amazon',  channel !== 'blinkit');
    gridState.setColumnVisible('blinkit', channel !== 'amazon');
  }, [channel]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (filterMode === 'custom' && !customStart) return;
    const seq = ++fetchSeqRef.current;
    const fetchSalesOverview = async () => {
      try {
        setIsLoading(true);
        const { start_date, end_date } = getDateParams();
        // Amazon is queried by ASIN and Blinkit by item_id. Sending the same raw term to
        // both hides half a cross-listed product's sales: searching by ASIN returned ₹0
        // Blinkit revenue, and searching by Blinkit id returned ₹0 Amazon revenue.
        // Resolve the term first so each channel is queried by the id it actually stores.
        // Free text (e.g. "Epsom") does not resolve and falls through to name matching.
        let searchArgs: { asin?: string; item_id?: string } = {};
        if (globalSearch.trim()) {
          const term = globalSearch.trim();
          const resolved: any = await api.products.resolve(term).catch(() => null);
          searchArgs = resolved?.matched
            // Fall back to the raw term when a channel has no id — it matches nothing
            // there, which is correct for a product that channel does not carry.
            ? { asin: resolved.amazon_id || term, item_id: resolved.blinkit_id || term }
            : { asin: term, item_id: term };
        }

        const [amzResult, blkResult] = await Promise.allSettled([
          api.amazonSalesData.getAnalytics({ start_date, end_date, ...(searchArgs.asin ? { asin: searchArgs.asin } : {}) }),
          api.blinkitSalesData.getAnalytics({ start_date, end_date, ...(searchArgs.item_id ? { item_id: searchArgs.item_id } : {}) }),
        ]);

        if (fetchSeqRef.current !== seq) return;

        const amazonAnalytics: any = amzResult.status === 'fulfilled' ? amzResult.value : null;
        const blinkitAnalytics: any = blkResult.status === 'fulfilled' ? blkResult.value : null;

        const amzRevenue: number = amazonAnalytics?.summary?.total_revenue || 0;
        const blkRevenue: number = blinkitAnalytics?.summary?.total_revenue || 0;
        const amzUnits: number   = Math.round(amazonAnalytics?.summary?.total_units || 0);
        const blkQty: number     = Math.round(blinkitAnalytics?.summary?.total_qty || 0);

        setStats({
          total_revenue:   amzRevenue + blkRevenue,
          total_orders:    amzUnits + blkQty,
          amazon_revenue:  amzRevenue,
          blinkit_revenue: blkRevenue,
          amazon_units:    amzUnits,
          blinkit_units:   blkQty,
          // Placeholder — replaced below with the distinct count after the SKU merge.
          // Summing the per-channel counts double-counted cross-listed SKUs.
          activeProducts:  0,
        });

        // Merge on ASG SKU, not product name — the same product is listed under a
        // different name on each channel, so name matching split it into two rows.
        // Falls back to the lowercased name only when a row has no ASG SKU.
        const productMap = new Map<string, any>();
        const mergeKey = (sku: string | undefined, name: string) =>
          sku && sku.trim() ? `sku:${sku.trim().toLowerCase()}` : `name:${name.toLowerCase()}`;

        (amazonAnalytics?.top_products || []).forEach((p: any) => {
          const name = (p.product_title || p.asin || 'Unknown').trim();
          const units = Math.round(p.total_units || 0);
          const key = mergeKey(p.sku, name);
          const ex = productMap.get(key);
          if (ex) {
            ex.amazon += units;
            ex.total  += units;
            ex.amazonRevenue += (p.total_revenue || 0);
          } else {
            productMap.set(key, { name, sku: p.sku || p.asin || '', amazon: units, blinkit: 0, total: units, amazonRevenue: p.total_revenue || 0, blinkitRevenue: 0 });
          }
        });
        (blinkitAnalytics?.top_products || []).forEach((p: any) => {
          const name = (p.item_name || String(p.item_id)).trim();
          const qty = Math.round(p.total_qty || 0);
          const key = mergeKey(p.asg_sku, name);
          const ex = productMap.get(key);
          if (ex) {
            ex.blinkit += qty;
            ex.total   += qty;
            ex.blinkitRevenue += (p.total_revenue || 0);
          } else {
            productMap.set(key, { name, sku: p.asg_sku || String(p.item_id), amazon: 0, blinkit: qty, total: qty, amazonRevenue: 0, blinkitRevenue: p.total_revenue || 0 });
          }
        });

        const merged = Array.from(productMap.values());

        // Distinct products after the SKU merge. Summing the two channel counts
        // double-counted every cross-listed SKU.
        setStats(prev => ({ ...prev, activeProducts: merged.filter(p => p.total > 0).length }));

        setTopProducts(
          merged
            .sort((a, b) => b.total - a.total)
            .map((p, i) => ({ rank: i + 1, ...p }))
        );
        // Build monthly chart directly from daily_trend — no separate dashboard/charts call needed
        setMonthlyData(aggregateDailyToMonthly(
          amazonAnalytics?.daily_trend || [],
          blinkitAnalytics?.daily_trend || [],
        ));
      } catch (error) {
        if (fetchSeqRef.current !== seq) return;
        console.error('Error fetching sales overview:', error);
      } finally {
        if (fetchSeqRef.current === seq) setIsLoading(false);
      }
    };

    fetchSalesOverview();
  }, [filterMode, customStart, customEnd, globalSearch, getDateParams]);

  const chartData = monthlyData;

  // Channel-derived KPI values
  const kpiRevenue = channel === 'amazon' ? stats.amazon_revenue : channel === 'blinkit' ? stats.blinkit_revenue : stats.total_revenue;
  const kpiOrders  = channel === 'amazon' ? stats.amazon_units  : channel === 'blinkit' ? stats.blinkit_units  : stats.total_orders;
  const kpiRevLabel = channel === 'amazon' ? 'Amazon revenue' : channel === 'blinkit' ? 'Blinkit revenue' : 'Combined Amazon + Blinkit';

  // Channel split for pie chart
  const totalRevenue = stats.amazon_revenue + stats.blinkit_revenue;
  const amazonPct = totalRevenue > 0 ? Math.round((stats.amazon_revenue / totalRevenue) * 100) : 0;
  const blinkitPct = totalRevenue > 0 ? Math.round((stats.blinkit_revenue / totalRevenue) * 100) : 0;

  const pieData = (() => {
    if (productChannel === 'amazon')  return [{ name: 'Amazon',  value: 100,        fill: '#60a5fa' }];
    if (productChannel === 'blinkit') return [{ name: 'Blinkit', value: 100,        fill: '#fbbf24' }];
    return [
      { name: 'Amazon',  value: amazonPct,  fill: '#60a5fa' },
      { name: 'Blinkit', value: blinkitPct, fill: '#fbbf24' },
    ];
  })();

  const gridColumns: GridColumn<TopProduct>[] = [
    {
      id: 'name', header: 'Product Name', accessorKey: 'name', sortable: true, width: 300, minWidth: 180, wrap: true,
      cell: (row) => (
        <span
          className="font-medium text-sm leading-snug"
          style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
          title={row.name ?? undefined}
        >
          {row.name || '—'}
        </span>
      ),
    },
    {
      id: 'sku', header: 'ASG SKU', accessorKey: 'sku', width: 175, minWidth: 130,
      cell: (row) => <Badge variant="outline" className="bg-slate-50 text-slate-700 border-slate-200 font-mono text-xs whitespace-nowrap">{row.sku}</Badge>,
    },
    {
      id: 'amazon', header: 'Amazon Units', accessorKey: 'amazon', sortable: true, width: 130, minWidth: 110, align: 'right',
      cell: (row) => (
        <Badge variant="outline" className={row.amazon > 0 ? 'bg-blue-50 text-blue-700 border-blue-200 font-semibold' : 'bg-gray-50 text-gray-400 border-gray-200'}>
          {row.amazon.toLocaleString('en-IN')}
        </Badge>
      ),
    },
    {
      id: 'blinkit', header: 'Blinkit Units', accessorKey: 'blinkit', sortable: true, width: 130, minWidth: 110, align: 'right',
      cell: (row) => (
        <Badge variant="outline" className={row.blinkit > 0 ? 'bg-yellow-50 text-yellow-700 border-yellow-200 font-semibold' : 'bg-gray-50 text-gray-400 border-gray-200'}>
          {row.blinkit.toLocaleString('en-IN')}
        </Badge>
      ),
    },
    {
      id: 'total', header: 'Total Units', accessorKey: 'total', sortable: true, width: 120, minWidth: 100, align: 'right',
      cell: (row) => (
        <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 font-bold">
          {row.total.toLocaleString('en-IN')}
        </Badge>
      ),
    },
    {
      id: 'totalRevenue', header: 'Total Revenue', accessorKey: 'amazonRevenue', sortable: true, width: 145, minWidth: 120, align: 'right',
      cell: (row) => {
        const rev = (row.amazonRevenue || 0) + (row.blinkitRevenue || 0);
        return (
          <span className={rev > 0 ? 'text-sm font-semibold text-emerald-700' : 'text-sm text-gray-400'}>
            {rev > 0 ? fmtCurrency(Math.round(rev)) : '—'}
          </span>
        );
      },
    },
  ];

  // globalSearch filters KPIs + chart (applied to backend). Here it also narrows the products table.
  // gridSearch is an additional client-side filter for the table only.
  const filteredTopProducts = topProducts.filter(p => {
    if (productChannel === 'amazon'  && p.amazon  === 0) return false;
    if (productChannel === 'blinkit' && p.blinkit === 0) return false;
    if (globalSearch.trim()) {
      const q = globalSearch.trim().toLowerCase();
      if (!p.name.toLowerCase().includes(q) && !p.sku.toLowerCase().includes(q)) return false;
    }
    if (gridSearch.trim()) {
      const q = gridSearch.trim().toLowerCase();
      if (!p.name.toLowerCase().includes(q) && !p.sku.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const gridState = useDataGrid(gridColumns, 'sales-overview');

  if (isLoading) {
    return (
      <ProtectedRoute>
        <div className="p-6 flex items-center justify-center">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
            <p className="text-muted-foreground">Loading sales overview...</p>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="p-4 sm:p-6 space-y-6">
        {/* KPI Cards */}
        <StatsGrid columns={4}>
          <StatsCard
            title={channel === 'amazon' ? 'Amazon Units Sold' : channel === 'blinkit' ? 'Blinkit Units Sold' : 'Total Units Sold'}
            value={kpiOrders.toLocaleString('en-IN')}
            icon={TrendingUp}
            description={kpiRevenue > 0 ? `${fmtCurrency(Math.round(kpiRevenue))} revenue` : kpiRevLabel}
          />
          <StatsCard
            title="Amazon Sales"
            value={fmtCurrency(Math.round(stats.amazon_revenue))}
            icon={ShoppingCart}
            description={`${amazonPct}% of total`}
            variant="blue"
          />
          <StatsCard
            title="Blinkit Sales"
            value={fmtCurrency(Math.round(stats.blinkit_revenue))}
            icon={Package}
            description={`${blinkitPct}% of total`}
            variant="yellow"
          />
          <StatsCard
            title="Active Products"
            value={stats.activeProducts.toString()}
            icon={Box}
            description="Across all channels"
          />
        </StatsGrid>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Monthly Sales Trend Chart */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-base font-medium">Monthly Sales Trend</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="month" tick={{ fill: '#6b7280', fontSize: 12 }} axisLine={{ stroke: '#e5e7eb' }} />
                    <YAxis
                      tick={{ fill: '#6b7280', fontSize: 12 }}
                      axisLine={{ stroke: '#e5e7eb' }}
                      tickFormatter={(v) => `${(v / 1000).toLocaleString('en-IN')}k`}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '8px' }}
                      formatter={(value: number | undefined) => [`${Number(value ?? 0).toLocaleString('en-IN')}`, '']}
                    />
                    <Legend />
                    {productChannel !== 'blinkit' && <Bar dataKey="Amazon"  fill="#60a5fa" radius={[8, 8, 0, 0]} />}
                    {productChannel !== 'amazon'  && <Bar dataKey="Blinkit" fill="#fbbf24" radius={[8, 8, 0, 0]} />}
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                  No sales data available
                </div>
              )}
            </CardContent>
          </Card>

          {/* Channel Distribution */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">
                Channel Distribution
                {productChannel !== 'all' && (
                  <span className={`ml-2 text-xs font-normal ${productChannel === 'amazon' ? 'text-blue-600' : 'text-yellow-600'}`}>
                    ({productChannel === 'amazon' ? 'Amazon only' : 'Blinkit only'})
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    outerRadius={85}
                    dataKey="value"
                  />
                  <Tooltip formatter={(value) => `${value}%`} />
                </PieChart>
              </ResponsiveContainer>

              {/* Custom legend chips */}
              <div className="flex flex-col gap-2 mt-1 px-2">
                {productChannel !== 'blinkit' && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full bg-blue-400 shrink-0" />
                      <span className="text-sm font-medium text-blue-700">Amazon</span>
                      <span className="text-xs text-muted-foreground">({amazonPct}%)</span>
                    </div>
                    <span className="text-sm font-semibold text-slate-700">{fmtCurrency(Math.round(stats.amazon_revenue))}</span>
                  </div>
                )}
                {productChannel !== 'amazon' && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full bg-yellow-400 shrink-0" />
                      <span className="text-sm font-medium text-yellow-700">Blinkit</span>
                      <span className="text-xs text-muted-foreground">({blinkitPct}%)</span>
                    </div>
                    <span className="text-sm font-semibold text-slate-700">{fmtCurrency(Math.round(stats.blinkit_revenue))}</span>
                  </div>
                )}
                <div className="border-t pt-2 mt-1 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground font-medium">Total Revenue</span>
                  <span className="text-sm font-bold text-slate-800">{fmtCurrency(Math.round(totalRevenue))}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Top Products Table */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="text-base font-medium">Top Selling Products</CardTitle>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Search products..."
                    value={gridSearch}
                    onChange={e => setGridSearch(e.target.value.replace(/^\s+/, ''))}
                    className="h-8 pl-8 pr-7 text-xs border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500 w-44"
                  />
                  {gridSearch && (
                    <button onClick={() => setGridSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {topProducts.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    onClick={() => exportToCSV(
                      filteredTopProducts.map(p => ({
                        'Rank':          p.rank,
                        'Product':       p.name,
                        'SKU':           p.sku,
                        'Amazon Units':  p.amazon,
                        'Blinkit Qty':   p.blinkit,
                        'Total Units':   p.total,
                        'Total Revenue': Math.round((p.amazonRevenue || 0) + (p.blinkitRevenue || 0)),
                      })),
                      'sales_overview_top_products'
                    )}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Export
                  </Button>
                )}
              </div>
            </div>
            {(globalSearch || gridSearch || productChannel !== 'all') && (
              <p className="text-xs text-muted-foreground mt-1">
                Showing {filteredTopProducts.length} of {topProducts.length} products
              </p>
            )}
          </CardHeader>
          <CardContent>
            {topProducts.length > 0 ? (
              filteredTopProducts.length > 0 ? (
                <DataGrid data={filteredTopProducts} gridState={gridState} />
              ) : (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  No products match your search or filter
                </div>
              )
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                No top products data available
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </ProtectedRoute>
  );
}
