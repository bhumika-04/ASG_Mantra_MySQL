'use client';

import { useState, useEffect } from 'react';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { StatsCard, StatsGrid } from '@/components/ui/stats-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, Package, TrendingDown, DollarSign, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
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

interface TopProduct {
  rank: number;
  item_id: number;
  item_name: string;
  total_qty: number;
  total_revenue: number;
}

const TREND_OPTIONS = [
  { label: '1 Month', value: '1month' },
  { label: '3 Months', value: '3months' },
  { label: '6 Months', value: '6months' },
  { label: 'All Time', value: 'all' },
];

function filterTrend(data: any[], period: string) {
  if (period === 'all') return data;
  const months = period === '1month' ? 1 : period === '3months' ? 3 : 6;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  const cutoffStr = cutoff.toISOString().slice(0, 7);
  return data.filter((d) => (d.date || '').slice(0, 7) >= cutoffStr);
}

export default function BlinkitSalesPage() {
  const [trendPeriod, setTrendPeriod] = useState('all');
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState({
    total_qty: 0,
    total_revenue: 0,
    active_items: 0,
    monthly_growth: 0,
    total_records_all_time: 0,
  });
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [dailyTrend, setDailyTrend] = useState<any[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        setFetchError(null);
        // Always fetch all available data (1825 days = 5 years back).
        // BlinkitSales records have actual sale dates, not upload dates.
        const analytics = await (api as any).blinkitSalesData.getAnalytics({ days: 1825 }) as any;

        setStats({
          total_qty: analytics.summary?.total_qty || 0,
          total_revenue: analytics.summary?.total_revenue || 0,
          active_items: analytics.summary?.active_items || 0,
          monthly_growth: analytics.summary?.monthly_growth || 0,
          total_records_all_time: analytics.summary?.total_records_all_time || 0,
        });

        const products = (analytics.top_products || []).slice(0, 5).map((p: any, index: number) => ({
          rank: index + 1,
          item_id: p.item_id || 0,
          item_name: p.item_name || 'Unknown',
          total_qty: p.total_qty || 0,
          total_revenue: p.total_revenue || 0,
        }));
        setTopProducts(products);

        setDailyTrend(analytics.daily_trend || []);
      } catch (error: any) {
        console.error('Error fetching Blinkit sales data:', error);
        setFetchError(error?.message || String(error));
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, []);

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
      <div className="p-6 space-y-6">
        {/* API error banner */}
        {fetchError && (
          <div className="p-4 bg-red-50 border border-red-300 rounded-lg text-sm text-red-800">
            <strong>API Error:</strong> {fetchError}
          </div>
        )}

        {/* KPI Cards */}
        <StatsGrid columns={4}>
          <StatsCard
            title="Total Qty Sold"
            value={Math.round(stats.total_qty).toLocaleString()}
            icon={Package}
            description="Units sold"
            variant="yellow"
          />
          <StatsCard
            title="Total Revenue"
            value={`₹${Math.round(stats.total_revenue).toLocaleString()}`}
            icon={DollarSign}
            description="MRP-based revenue"
            variant="yellow"
          />
          <StatsCard
            title="Active Products"
            value={stats.active_items.toString()}
            icon={TrendingUp}
            description="Distinct items sold"
            variant="yellow"
          />
          <StatsCard
            title="Monthly Growth"
            value={`${growth >= 0 ? '+' : ''}${growth.toFixed(1)}%`}
            icon={growth >= 0 ? TrendingUp : TrendingDown}
            description="vs previous 30-day period"
            trend={{ value: growth, isPositive: growth >= 0 }}
            variant="yellow"
          />
        </StatsGrid>

        {/* Daily Sales Trend Chart */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Daily Sales Trend</CardTitle>
              <select value={trendPeriod} onChange={(e) => setTrendPeriod(e.target.value)} className="h-8 text-xs border border-border rounded-md px-2 py-1 bg-background text-foreground cursor-pointer">
                {TREND_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </CardHeader>
          <CardContent>
            {dailyTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height={320}>
                <AreaChart data={filterTrend(dailyTrend, trendPeriod)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: '#6b7280', fontSize: 11 }}
                    axisLine={{ stroke: '#e5e7eb' }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fill: '#6b7280', fontSize: 12 }}
                    axisLine={{ stroke: '#e5e7eb' }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#fff',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                      padding: '8px',
                    }}
                    formatter={(value: number | undefined) => [Number(value ?? 0).toLocaleString(), 'Qty Sold']}
                  />
                  <Area
                    type="monotone"
                    dataKey="total_qty"
                    stroke="#fbbf24"
                    fill="#fef3c7"
                    strokeWidth={2}
                    name="Qty Sold"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-80 flex items-center justify-center text-muted-foreground">
                {stats.total_records_all_time > 0
                  ? `No data in selected date range (${stats.total_records_all_time.toLocaleString()} records exist in DB)`
                  : 'No Blinkit sales data uploaded yet'}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top Selling Products Table */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Top Selling Products</CardTitle>
              {topProducts.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => exportToCSV(
                    topProducts.map(p => ({
                      'Rank': p.rank,
                      'Product': p.item_name,
                      'Total Qty': Math.round(p.total_qty),
                      'Revenue (₹)': Math.round(p.total_revenue),
                    })),
                    'blinkit_top_products'
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
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left px-6 py-3 font-semibold text-xs text-muted-foreground uppercase tracking-wider w-20">Rank</th>
                      <th className="text-left px-6 py-3 font-semibold text-xs text-muted-foreground uppercase tracking-wider">Product Name</th>
                      <th className="text-right px-6 py-3 font-semibold text-xs text-muted-foreground uppercase tracking-wider">Total Qty</th>
                      <th className="text-right px-6 py-3 font-semibold text-xs text-muted-foreground uppercase tracking-wider">Revenue (₹)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topProducts.map((product) => (
                      <tr
                        key={product.rank}
                        className="border-b border-border/50 hover:bg-muted/50 transition-colors"
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-yellow-100 text-yellow-700 font-bold text-sm">
                            {product.rank}
                          </div>
                        </td>
                        <td className="px-6 py-4 font-medium">{product.item_name}</td>
                        <td className="px-6 py-4 text-right font-semibold text-yellow-600">
                          {Math.round(product.total_qty).toLocaleString()}
                        </td>
                        <td className="px-6 py-4 text-right text-muted-foreground">
                          ₹{Math.round(product.total_revenue).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                {stats.total_records_all_time > 0
                  ? `No product data in selected date range (${stats.total_records_all_time.toLocaleString()} records exist in DB)`
                  : 'No Blinkit sales data uploaded yet'}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </ProtectedRoute>
  );
}
