'use client';

import { useState, useEffect, useRef } from 'react';
import { fmtDate, fmtDayMonth, fmtMonthYear } from '@/lib/format';
import { useFilter, computeDateRange, FilterMode } from '@/contexts/FilterContext';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { StatsCard, StatsGrid } from '@/components/ui/stats-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Package,
  PackageCheck,
  PackageOpen,
  ClipboardList,
  AlertTriangle,
  ArrowRight,
  ShoppingCart,
  Truck,
  XCircle,
} from 'lucide-react';
import {
  PieChart,
  Pie,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import Link from 'next/link';
import { api } from '@/lib/api';

// Dashboard is INVENTORY-focused, NOT sales-focused
// Sales metrics belong in Sales Overview page

interface DashboardStats {
  totalSKUs: number;
  totalInventory: number;
  packedInventory: number;
  unpackedInventory: number;
  pendingPOs: number;
  delayedPOs: number;
  lowInventoryCount: number;
  outOfStockCount: number;
  amazonInventory: number;
  amazonPacked: number;
  amazonUnpacked: number;
  amazonPendingPOs: number;
  blinkitInventory: number;
  blinkitPacked: number;
  blinkitUnpacked: number;
  blinkitPendingPOs: number;
}

interface LowInventoryItem {
  id: number;
  productName: string;
  asgSku: string;
  packedQty: number;
  unpackedQty: number;
  severity: 'critical' | 'low';
  inventoryDate: string | null;
}

interface MonthlySalesItem {
  month: string;
  Amazon: number;
  Blinkit: number;
}

interface TopProduct {
  name: string;
  sku: string;
  channel: string;
  revenue: number;
  quantity: number;
}

interface ChartData {
  monthly_sales: MonthlySalesItem[];
  top_products: TopProduct[];
  granularity: 'daily' | 'weekly' | 'monthly';
}


function stripBrand(name: string): string {
  return name
    .replace(/^organix\s+mantra\s*/i, '')
    .replace(/^organic\s+mantra\s*/i, '')
    .trim();
}

function formatPeriodLabel(p: string, granularity: 'daily' | 'weekly' | 'monthly'): string {
  if ((granularity === 'daily' || granularity === 'weekly') && p.length === 10) {
    return fmtDayMonth(p);
  }
  return fmtMonthYear(p);
}

function fmtRangeDate(iso: string): string {
  return fmtDate(iso);
}

export default function DashboardPage() {
  const { filterMode, customStart, customEnd, channel } = useFilter();

  const dateRangeLabel = (() => {
    if (filterMode === 'all') return null;
    const { start_date, end_date } = computeDateRange(filterMode as FilterMode, customStart, customEnd);
    if (start_date && end_date) return `${fmtRangeDate(start_date)} – ${fmtRangeDate(end_date)}`;
    if (start_date) return `From ${fmtRangeDate(start_date)}`;
    return null;
  })();

  const [topProductsChannel, setTopProductsChannel] = useState('all');

  // Sync top-products channel selector to global channel filter
  useEffect(() => {
    setTopProductsChannel(channel === 'all' ? 'all' : channel);
  }, [channel]);
  const [isChartLoading, setIsChartLoading] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState<DashboardStats>({
    totalSKUs: 0,
    totalInventory: 0,
    packedInventory: 0,
    unpackedInventory: 0,
    pendingPOs: 0,
    delayedPOs: 0,
    lowInventoryCount: 0,
    outOfStockCount: 0,
    amazonInventory: 0,
    amazonPacked: 0,
    amazonUnpacked: 0,
    amazonPendingPOs: 0,
    blinkitInventory: 0,
    blinkitPacked: 0,
    blinkitUnpacked: 0,
    blinkitPendingPOs: 0,
  });
  const [lowInventoryItems, setLowInventoryItems] = useState<LowInventoryItem[]>([]);
  const [lowStockCounts, setLowStockCounts] = useState({ critical: 0, low: 0 });
  const [chartData, setChartData] = useState<ChartData>({ monthly_sales: [], top_products: [], granularity: 'monthly' });

  const isFirstChartRender = useRef(true);

  // Fetch stats, low stock, AND charts together on mount — single parallel burst
  useEffect(() => {
    const fetchInitial = async () => {
      try {
        const { start_date, end_date } = computeDateRange(filterMode, customStart, customEnd);
        const [statsData, lowStockData, charts]: any[] = await Promise.all([
          api.dashboard.getInventoryStats(),
          api.inventory.getLowStock({ limit: 10 }),
          api.dashboard.getCharts({ start_date, end_date }),
        ]);
        setStats(statsData);
        setLowInventoryItems(lowStockData.items || []);
        setLowStockCounts({
          critical: lowStockData.critical_count || 0,
          low: lowStockData.low_count || 0,
        });
        setChartData({
          monthly_sales: charts.monthly_sales || [],
          top_products: charts.top_products || [],
          granularity: charts.granularity || 'monthly',
        });
      } catch (error) {
        console.error('Error fetching dashboard data:', error);
      } finally {
        setIsLoading(false);
        setIsChartLoading(false);
      }
    };
    fetchInitial();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch charts on filter change (skip first render — handled by mount effect above)
  useEffect(() => {
    if (isFirstChartRender.current) {
      isFirstChartRender.current = false;
      return;
    }
    const { start_date, end_date } = computeDateRange(filterMode, customStart, customEnd);
    if (filterMode === 'custom' && !start_date) return;
    setIsChartLoading(true);
    api.dashboard.getCharts({ start_date, end_date })
      .then((charts: any) => {
        setChartData({
          monthly_sales: charts.monthly_sales || [],
          top_products: charts.top_products || [],
          granularity: charts.granularity || 'monthly',
        });
      })
      .catch((err: any) => console.error('Chart fetch error:', err))
      .finally(() => setIsChartLoading(false));
  }, [filterMode, customStart, customEnd]);

  // Channel-derived KPI values (no extra fetch needed — all fields already in stats)
  // Packed/Unpacked are ASG warehouse totals — no per-channel breakdown exists
  const kpiPacked    = stats.packedInventory;
  const kpiUnpacked  = stats.unpackedInventory;
  const kpiPendingPOs = channel === 'amazon' ? stats.amazonPendingPOs : channel === 'blinkit' ? stats.blinkitPendingPOs : stats.pendingPOs;
  const kpiPendingDesc = channel === 'amazon'
    ? 'Amazon POs pending'
    : channel === 'blinkit'
      ? 'Blinkit POs pending'
      : `${stats.amazonPendingPOs} Amazon · ${stats.blinkitPendingPOs} Blinkit`;

  if (isLoading) {
    return (
      <ProtectedRoute>
        <div className="p-6 space-y-6">
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            <p className="mt-4 text-gray-600">Loading dashboard...</p>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="p-6 space-y-6">
        {/* Page Header */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">
            Inventory overview and platform allocation
          </p>
          <Badge variant="outline" className="text-xs">
            Last updated: {new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}
          </Badge>
        </div>

        {/* Key Performance Indicators - INVENTORY FOCUSED */}
        <StatsGrid columns={4}>
          <StatsCard
            title="Total SKUs"
            value={stats.totalSKUs.toLocaleString('en-IN')}
            icon={Package}
            description="Active products"
          />
          <StatsCard
            title="Packed Inventory"
            value={kpiPacked.toLocaleString('en-IN')}
            icon={PackageCheck}
            description="Ready to ship"
            variant="blue"
          />
          <StatsCard
            title="Unpacked Inventory"
            value={kpiUnpacked.toLocaleString('en-IN')}
            icon={PackageOpen}
            description="Raw stock"
            variant="yellow"
          />
          <StatsCard
            title="Pending POs"
            value={kpiPendingPOs.toLocaleString('en-IN')}
            icon={ClipboardList}
            description={kpiPendingDesc}
            variant={stats.delayedPOs > 0 ? 'orange' : 'default'}
          />
        </StatsGrid>

        {/* Channel Stock + Alert KPIs */}
        <StatsGrid columns={4}>
          <StatsCard
            title="Amazon Stock"
            value={stats.amazonInventory.toLocaleString('en-IN')}
            icon={ShoppingCart}
            description="Sellable units at Amazon (latest)"
            variant="blue"
          />
          <StatsCard
            title="Blinkit Stock"
            value={stats.blinkitInventory.toLocaleString('en-IN')}
            icon={Truck}
            description="Units at Blinkit hub (latest)"
            variant="yellow"
          />
          <StatsCard
            title="Low Stock Alerts"
            value={stats.lowInventoryCount.toLocaleString('en-IN')}
            icon={AlertTriangle}
            description="Unresolved alerts"
            variant={stats.lowInventoryCount > 0 ? 'orange' : 'default'}
          />
          <StatsCard
            title="Out of Stock"
            value={stats.outOfStockCount.toLocaleString('en-IN')}
            icon={XCircle}
            description="ASG SKUs at zero units"
            variant={stats.outOfStockCount > 0 ? 'red' : 'default'}
          />
        </StatsGrid>

        {/* Sales Charts */}
        <div className="space-y-4">
          {isChartLoading && (
            <div className="flex justify-end">
              <div className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            </div>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 1. Sales Performance - Area Chart */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base font-medium">
                    {chartData.granularity === 'daily' ? 'Daily' : chartData.granularity === 'weekly' ? 'Weekly' : 'Monthly'} Sales Performance
                  </CardTitle>
                  {dateRangeLabel && (
                    <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">{dateRangeLabel}</span>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={chartData.monthly_sales}>
                    <defs>
                      <linearGradient id="colorAmazon" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.6}/>
                        <stop offset="95%" stopColor="#93c5fd" stopOpacity={0.05}/>
                      </linearGradient>
                      <linearGradient id="colorBlinkit" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#fbbf24" stopOpacity={0.6}/>
                        <stop offset="95%" stopColor="#fde68a" stopOpacity={0.05}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="month" tick={{ fill: '#6b7280', fontSize: 11 }} tickFormatter={(v) => formatPeriodLabel(v, chartData.granularity)} />
                    <YAxis tick={{ fill: '#6b7280', fontSize: 12 }} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                    <Tooltip labelFormatter={(v) => formatPeriodLabel(v, chartData.granularity)} formatter={(v: number | undefined) => [`₹${Number(v ?? 0).toLocaleString('en-IN')}`, '']} />
                    <Legend />
                    {channel !== 'blinkit' && <Area type="monotone" dataKey="Amazon" stroke="#60a5fa" strokeWidth={2} fillOpacity={1} fill="url(#colorAmazon)" />}
                    {channel !== 'amazon' && <Area type="monotone" dataKey="Blinkit" stroke="#fbbf24" strokeWidth={2} fillOpacity={1} fill="url(#colorBlinkit)" />}
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* 2. Platform Sales Comparison - Bar Chart */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base font-medium">Platform Sales Comparison</CardTitle>
                  {dateRangeLabel && (
                    <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">{dateRangeLabel}</span>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={chartData.monthly_sales}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="month" tick={{ fill: '#6b7280', fontSize: 11 }} tickFormatter={(v) => formatPeriodLabel(v, chartData.granularity)} />
                    <YAxis tick={{ fill: '#6b7280', fontSize: 12 }} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                    <Tooltip labelFormatter={(v) => formatPeriodLabel(v, chartData.granularity)} formatter={(v: number | undefined) => [`₹${Number(v ?? 0).toLocaleString('en-IN')}`, '']} />
                    <Legend />
                    {channel !== 'blinkit' && <Bar dataKey="Amazon" fill="#60a5fa" radius={[4, 4, 0, 0]} />}
                    {channel !== 'amazon' && <Bar dataKey="Blinkit" fill="#fbbf24" radius={[4, 4, 0, 0]} />}
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* 3. Channel Distribution - Pie Chart */}
            <Card className="flex flex-col">
              <CardHeader className="pb-2 shrink-0">
                <CardTitle className="text-base font-medium">Channel Distribution</CardTitle>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col pt-0 pb-4">
                {(() => {
                  const amazonTotal = chartData.monthly_sales.reduce((s, r) => s + r.Amazon, 0);
                  const blinkitTotal = chartData.monthly_sales.reduce((s, r) => s + r.Blinkit, 0);
                  const total = amazonTotal + blinkitTotal;
                  const amazonPct = total > 0 ? Math.round((amazonTotal / total) * 100) : 0;
                  const blinkitPct = total > 0 ? 100 - amazonPct : 0;
                  const distData = channel === 'amazon'
                    ? [{ name: 'Amazon', value: amazonTotal, fill: '#60a5fa' }]
                    : channel === 'blinkit'
                      ? [{ name: 'Blinkit', value: blinkitTotal, fill: '#fbbf24' }]
                      : [
                          { name: 'Amazon', value: amazonTotal, fill: '#60a5fa' },
                          { name: 'Blinkit', value: blinkitTotal, fill: '#fbbf24' },
                        ];
                  return (
                    <div className="flex-1 flex flex-col">
                      <ResponsiveContainer width="100%" height={200}>
                        <PieChart>
                          <Pie
                            data={distData}
                            cx="50%"
                            cy="50%"
                            outerRadius={88}
                            dataKey="value"
                          />
                          <Tooltip formatter={(v: number | undefined) => [`₹${Number(v ?? 0).toLocaleString('en-IN')}`, 'Revenue']} />
                        </PieChart>
                      </ResponsiveContainer>
                      {/* Channel breakdown — no overlap, always readable */}
                      <div className="flex items-center justify-center gap-8 pt-3 border-t mt-auto">
                        {channel !== 'blinkit' && (
                          <div className="flex items-center gap-2.5">
                            <div className="h-3 w-3 rounded-full bg-blue-400 shrink-0" />
                            <div>
                              <p className="text-sm font-bold leading-none">{channel === 'amazon' ? '100' : amazonPct}%</p>
                              <p className="text-xs text-muted-foreground mt-0.5">Amazon</p>
                            </div>
                          </div>
                        )}
                        {channel === 'all' && <div className="h-8 w-px bg-border" />}
                        {channel !== 'amazon' && (
                          <div className="flex items-center gap-2.5">
                            <div className="h-3 w-3 rounded-full bg-yellow-400 shrink-0" />
                            <div>
                              <p className="text-sm font-bold leading-none">{channel === 'blinkit' ? '100' : blinkitPct}%</p>
                              <p className="text-xs text-muted-foreground mt-0.5">Blinkit</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>

            {/* 4. Top Products by Revenue - Horizontal Bar Chart */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-medium">Top Products by Revenue</CardTitle>
                  <select
                    value={topProductsChannel}
                    onChange={(e) => setTopProductsChannel(e.target.value)}
                    className="h-7 text-xs border border-border rounded-md px-2 py-1 bg-background text-foreground cursor-pointer"
                  >
                    <option value="all">All Channels</option>
                    <option value="amazon">Amazon</option>
                    <option value="blinkit">Blinkit</option>
                  </select>
                </div>
              </CardHeader>
              <CardContent>
                {(() => {
                  const filteredTop = (topProductsChannel === 'all'
                    ? chartData.top_products
                    : chartData.top_products.filter(p => (p.channel || '').toLowerCase() === topProductsChannel)
                  ).slice(0, 5).map((p: any) => {
                    const full = stripBrand(p.name);
                    return {
                      ...p,
                      fullName: full,
                      sku: p.sku || '',
                      name: full.length > 18 ? full.slice(0, 18) + '…' : full,
                      fill: (p.channel || '').toLowerCase() === 'amazon' ? '#60a5fa' : '#fbbf24',
                    };
                  });
                  return (
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart data={filteredTop} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 11 }} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                        <YAxis dataKey="name" type="category" width={130} tick={{ fill: '#6b7280', fontSize: 10 }} />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const d = payload[0];
                            return (
                              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 12px', maxWidth: 260, boxShadow: '0 2px 8px rgba(0,0,0,0.10)' }}>
                                <p style={{ fontWeight: 600, fontSize: 13, marginBottom: 4, lineHeight: 1.4, whiteSpace: 'normal', wordBreak: 'break-word' }}>{d.payload.fullName}</p>
                                {d.payload.sku && (
                                  <p style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>SKU: <span style={{ fontFamily: 'monospace', color: '#374151' }}>{d.payload.sku}</span></p>
                                )}
                                <p style={{ fontSize: 13, color: '#6b7280' }}>Revenue: ₹{Number(d.value ?? 0).toLocaleString('en-IN')}</p>
                              </div>
                            );
                          }}
                        />
                        <Bar dataKey="revenue" radius={[0, 4, 4, 0]} name="Revenue" />
                      </BarChart>
                    </ResponsiveContainer>
                  );
                })()}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Low Inventory Alerts */}
        <div>
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-medium flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-500" />
                  Low Inventory Alerts
                  <span className="text-xs font-normal text-muted-foreground">(ASG Warehouse)</span>
                </CardTitle>
                <div className="flex items-center gap-2">
                  {lowStockCounts.critical > 0 && (
                    <Badge className="bg-red-100 text-red-700 border border-red-200 hover:bg-red-100">
                      {lowStockCounts.critical} Critical
                    </Badge>
                  )}
                  {lowStockCounts.low > 0 && (
                    <Badge className="bg-orange-100 text-orange-700 border border-orange-200 hover:bg-orange-100">
                      {lowStockCounts.low} Low
                    </Badge>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {lowInventoryItems.length > 0 && (
                <div className="flex items-center justify-between px-3 pb-2 text-xs text-muted-foreground font-medium border-b mb-2">
                  <span>Product</span>
                  <div className="flex items-center gap-6 text-right">
                    <span className="w-16">Packed</span>
                    <span className="w-16">Unpacked</span>
                    <span className="w-14">Total</span>
                  </div>
                </div>
              )}
              <div className="space-y-2">
                {lowInventoryItems.length > 0 ? (
                  lowInventoryItems.map((item) => (
                    <div
                      key={item.id}
                      className={`flex items-center justify-between p-3 rounded-lg border-l-4 ${
                        item.severity === 'critical'
                          ? 'bg-red-50 border-l-red-500 border border-red-100'
                          : 'bg-orange-50 border-l-orange-400 border border-orange-100'
                      }`}
                    >
                      <div className="min-w-0 flex-1 mr-4">
                        <p className="font-medium text-sm text-gray-900 truncate" title={item.productName}>
                          {item.productName}
                        </p>
                        <p className="text-xs text-gray-500 font-mono">{item.asgSku}</p>
                      </div>
                      <div className="flex items-center gap-6 flex-shrink-0">
                        <div className="text-right w-16">
                          <p className={`text-sm font-bold ${item.packedQty === 0 ? 'text-red-600' : 'text-orange-600'}`}>
                            {item.packedQty}
                          </p>
                          <p className="text-xs text-gray-400">Packed</p>
                        </div>
                        <div className="text-right w-16">
                          <p className="text-sm font-semibold text-gray-700">
                            {item.unpackedQty}
                          </p>
                          <p className="text-xs text-gray-400">Unpacked</p>
                        </div>
                        <div className="text-right w-14">
                          <p className="text-sm font-bold text-gray-900">
                            {item.packedQty + item.unpackedQty}
                          </p>
                          <p className="text-xs text-gray-400">Total</p>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <PackageCheck className="h-8 w-8 mx-auto mb-2 text-green-400" />
                    <p className="text-sm font-medium">All stock levels healthy</p>
                    <p className="text-xs mt-1 text-gray-400">No low packed inventory found</p>
                  </div>
                )}
              </div>

              <Link
                href="/inventory"
                className="mt-4 flex items-center justify-center gap-1 text-sm text-blue-600 hover:text-blue-800"
              >
                View Full Inventory
                <ArrowRight className="h-4 w-4" />
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </ProtectedRoute>
  );
}
