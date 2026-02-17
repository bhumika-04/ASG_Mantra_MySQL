'use client';

import { useState, useEffect } from 'react';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { StatsCard, StatsGrid } from '@/components/ui/stats-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataGrid, GridColumn, useDataGrid } from '@/components/ui/data-grid';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TrendingUp, ShoppingCart, Package, Box, Download } from 'lucide-react';
import { exportToCSV } from '@/lib/export';
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
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
}

const TIME_OPTIONS = [
  { label: '3 Months', value: '3months' },
  { label: '6 Months', value: '6months' },
  { label: '1 Year', value: '1year' },
  { label: 'All Time', value: 'all' },
];

function filterMonthly(data: any[], period: string) {
  if (period === 'all') return data;
  const n = period === '3months' ? 3 : period === '6months' ? 6 : 12;
  return data.slice(-n);
}

export default function SalesOverviewPage() {
  const [salesTrendPeriod, setSalesTrendPeriod] = useState('6months');
  const [distPeriod, setDistPeriod] = useState('6months');
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState({
    total_revenue: 0,
    total_orders: 0,
    amazon_revenue: 0,
    blinkit_revenue: 0,
    activeProducts: 0,
  });
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [monthlyData, setMonthlyData] = useState<any[]>([]);

  useEffect(() => {
    const fetchSalesOverview = async () => {
      try {
        setIsLoading(true);

        // Use dedicated analytics endpoints (AmazonSales and BlinkitSales tables).
        // Always fetch full history (1825 days) since data has actual report dates.
        // Use Promise.allSettled so one failure doesn't blank the whole page.
        const results = await Promise.allSettled([
          (api as any).amazonSalesData.getAnalytics({ days: 1825 }),
          (api as any).blinkitSalesData.getAnalytics({ days: 1825 }),
          api.dashboard.getCharts(),
          api.dashboard.getProductOverview({ page_size: 100 }),
        ]);

        const amazonAnalytics: any = results[0].status === 'fulfilled' ? results[0].value : null;
        const blinkitAnalytics: any = results[1].status === 'fulfilled' ? results[1].value : null;
        const chartsData: any = results[2].status === 'fulfilled' ? results[2].value : null;
        const productOverview: any = results[3].status === 'fulfilled' ? results[3].value : null;

        // Build name → ASG SKU lookup from product master
        const skuLookup = new Map<string, string>();
        (productOverview?.items || []).forEach((p: any) => {
          if (p.productName && p.asgSku) {
            skuLookup.set(p.productName.trim().toLowerCase(), p.asgSku);
          }
        });

        const amzRevenue: number = amazonAnalytics?.summary?.total_revenue || 0;
        const blkRevenue: number = blinkitAnalytics?.summary?.total_revenue || 0;
        const amzUnits: number   = Math.round(amazonAnalytics?.summary?.total_units || 0);
        const blkQty: number     = Math.round(blinkitAnalytics?.summary?.total_qty || 0);

        setStats({
          total_revenue:  amzRevenue + blkRevenue,
          total_orders:   amzUnits + blkQty,
          amazon_revenue: amzRevenue,
          blinkit_revenue: blkRevenue,
          activeProducts: (amazonAnalytics?.summary?.active_products || 0) + (blinkitAnalytics?.summary?.active_items || 0),
        });

        // Build combined top products list — merge by product name
        const productMap = new Map<string, any>();

        (amazonAnalytics?.top_products || []).forEach((p: any) => {
          const name = (p.product_title || p.asin || 'Unknown').trim();
          const key = name.toLowerCase();
          if (productMap.has(key)) {
            const existing = productMap.get(key);
            existing.amazon += Math.round(p.total_units || 0);
            existing.total += Math.round(p.total_units || 0);
          } else {
            productMap.set(key, {
              name,
              sku: p.asin || '',
              amazon: Math.round(p.total_units || 0),
              blinkit: 0,
              total: Math.round(p.total_units || 0),
            });
          }
        });

        (blinkitAnalytics?.top_products || []).forEach((p: any) => {
          const name = (p.item_name || String(p.item_id)).trim();
          const key = name.toLowerCase();
          if (productMap.has(key)) {
            const existing = productMap.get(key);
            existing.blinkit += Math.round(p.total_qty || 0);
            existing.total += Math.round(p.total_qty || 0);
          } else {
            productMap.set(key, {
              name,
              sku: String(p.item_id),
              amazon: 0,
              blinkit: Math.round(p.total_qty || 0),
              total: Math.round(p.total_qty || 0),
            });
          }
        });

        // Resolve ASG SKU from product master lookup
        for (const [key, product] of productMap) {
          const asgSku = skuLookup.get(key);
          if (asgSku) {
            product.sku = asgSku;
          }
        }

        const sortedProducts = Array.from(productMap.values())
          .sort((a, b) => b.total - a.total)
          .slice(0, 10)
          .map((p, index) => ({ rank: index + 1, ...p }));

        setTopProducts(sortedProducts);

        // Monthly data from dashboard charts (uses dedicated AmazonSales/BlinkitSales tables)
        setMonthlyData(chartsData?.monthly_sales || []);
      } catch (error) {
        console.error('Error fetching sales overview:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSalesOverview();
  }, []);

  // Calculate percentages
  const totalRevenue = stats.amazon_revenue + stats.blinkit_revenue;
  const amazonPercentage = totalRevenue > 0
    ? Math.round((stats.amazon_revenue / totalRevenue) * 100)
    : 0;
  const blinkitPercentage = totalRevenue > 0
    ? Math.round((stats.blinkit_revenue / totalRevenue) * 100)
    : 0;

  const gridColumns: GridColumn<TopProduct>[] = [
    { id: 'rank', header: '#', accessorKey: 'rank', width: 60, minWidth: 50, align: 'center', cell: (row) => <span className="text-muted-foreground font-medium">{row.rank}</span> },
        { id: 'name', header: 'Product', accessorKey: 'name', sortable: true, width: 360, minWidth: 200, cell: (row) => (
      <span
        className="font-medium text-sm leading-snug"
        style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
        title={row.name}
      >
        {row.name || '—'}
      </span>
    ) },
    { id: 'sku', header: 'SKU', accessorKey: 'sku', width: 175, minWidth: 130, cell: (row) => <Badge variant="outline" className="bg-slate-50 text-slate-700 border-slate-200 font-mono text-xs whitespace-nowrap">{row.sku}</Badge> },
    { id: 'amazon', header: 'Amazon', accessorKey: 'amazon', sortable: true, width: 130, minWidth: 110, align: 'right', cell: (row) => (
      <Badge variant="outline" className={row.amazon > 0 ? 'bg-blue-50 text-blue-700 border-blue-200 font-semibold' : 'bg-gray-50 text-gray-400 border-gray-200'}>{row.amazon.toLocaleString()}</Badge>
    )},
    { id: 'blinkit', header: 'Blinkit', accessorKey: 'blinkit', sortable: true, width: 130, minWidth: 110, align: 'right', cell: (row) => (
      <Badge variant="outline" className={row.blinkit > 0 ? 'bg-yellow-50 text-yellow-700 border-yellow-200 font-semibold' : 'bg-gray-50 text-gray-400 border-gray-200'}>{row.blinkit.toLocaleString()}</Badge>
    )},
    { id: 'total', header: 'Total', accessorKey: 'total', sortable: true, width: 130, minWidth: 110, align: 'right', cell: (row) => (
      <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 font-bold">{row.total.toLocaleString()}</Badge>
    )},
  ];

  const gridState = useDataGrid(gridColumns);

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
      <div className="p-6 space-y-6">
        {/* KPI Cards */}
        <StatsGrid columns={4}>
          <StatsCard
            title="Total Units Sold"
            value={stats.total_orders.toLocaleString()}
            icon={TrendingUp}
            description={stats.total_revenue > 0 ? `₹${Math.round(stats.total_revenue).toLocaleString()} revenue` : 'Amazon units + Blinkit qty'}
          />
          <StatsCard
            title="Amazon Sales"
            value={stats.amazon_revenue > 0 ? `₹${Math.round(stats.amazon_revenue).toLocaleString()}` : `${amazonPercentage}% share`}
            icon={ShoppingCart}
            description={`${amazonPercentage}% of total`}
            variant="blue"
          />
          <StatsCard
            title="Blinkit Sales"
            value={stats.blinkit_revenue > 0 ? `₹${Math.round(stats.blinkit_revenue).toLocaleString()}` : `${blinkitPercentage}% share`}
            icon={Package}
            description={`${blinkitPercentage}% of total`}
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
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-medium">Monthly Sales Trend</CardTitle>
                <select value={salesTrendPeriod} onChange={(e) => setSalesTrendPeriod(e.target.value)} className="h-7 text-xs border border-border rounded-md px-2 py-1 bg-background text-foreground cursor-pointer">
                  {TIME_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={filterMonthly(monthlyData, salesTrendPeriod)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis
                    dataKey="month"
                    tick={{ fill: '#6b7280', fontSize: 12 }}
                    axisLine={{ stroke: '#e5e7eb' }}
                  />
                  <YAxis
                    tick={{ fill: '#6b7280', fontSize: 12 }}
                    axisLine={{ stroke: '#e5e7eb' }}
                    tickFormatter={(value) => `${value / 1000}k`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#fff',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                      padding: '8px'
                    }}
                    formatter={(value: number | undefined) => [`${value?.toLocaleString() ?? '0'}`, '']}
                  />
                  <Legend />
                  <Bar dataKey="Amazon" fill="#60a5fa" radius={[8, 8, 0, 0]} />
                  <Bar dataKey="Blinkit" fill="#fbbf24" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Channel Distribution */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-medium">Channel Distribution</CardTitle>
                <select value={distPeriod} onChange={(e) => setDistPeriod(e.target.value)} className="h-7 text-xs border border-border rounded-md px-2 py-1 bg-background text-foreground cursor-pointer">
                  {TIME_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </CardHeader>
            <CardContent>
              {(() => {
                const filteredDist = filterMonthly(monthlyData, distPeriod);
                const distTotal = filteredDist.reduce((s: number, r: any) => s + (r.Amazon || 0) + (r.Blinkit || 0), 0);
                const distAmz = filteredDist.reduce((s: number, r: any) => s + (r.Amazon || 0), 0);
                const distBlk = filteredDist.reduce((s: number, r: any) => s + (r.Blinkit || 0), 0);
                const distChannelData = [
                  { name: 'Amazon', value: distTotal > 0 ? Math.round((distAmz / distTotal) * 100) : 0, color: '#60a5fa' },
                  { name: 'Blinkit', value: distTotal > 0 ? Math.round((distBlk / distTotal) * 100) : 0, color: '#fbbf24' },
                ];
                return (
                  <ResponsiveContainer width="100%" height={320}>
                    <PieChart>
                      <Pie
                        data={distChannelData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, value }) => `${name}: ${value}%`}
                        outerRadius={100}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {distChannelData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => `${value}%`} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                );
              })()}
            </CardContent>
          </Card>
        </div>

        {/* Top Products Table */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-medium">Top Selling Products</CardTitle>
              {topProducts.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => exportToCSV(
                    topProducts.map(p => ({
                      'Rank': p.rank,
                      'Product': p.name,
                      'SKU': p.sku,
                      'Amazon Units': p.amazon,
                      'Blinkit Qty': p.blinkit,
                      'Total': p.total,
                    })),
                    'sales_overview_top_products'
                  )}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Export
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {topProducts.length > 0 ? (
              <DataGrid data={topProducts} gridState={gridState} />
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
