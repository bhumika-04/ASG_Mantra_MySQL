'use client';

import { useState, useEffect, useMemo } from 'react';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { StatsCard, StatsGrid } from '@/components/ui/stats-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataGrid, GridColumn, useDataGrid, ViewOptionsButton } from '@/components/ui/data-grid';
import { FilterBar } from '@/components/ui/filter-bar';
import { exportToCSV } from '@/lib/export';
import {
  Package,
  PackageCheck,
  PackageOpen,
  ClipboardList,
  AlertTriangle,
  ArrowRight,
  Download,
  Search,
} from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
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
import { FilterPanel, FilterValues, DEFAULT_FILTER_VALUES } from '@/components/ui/filter-panel';

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
  channel: string;
  currentStock: number;
  toPackQty: number;
}

interface MonthlySalesItem {
  month: string;
  Amazon: number;
  Blinkit: number;
}

interface TopProduct {
  name: string;
  channel: string;
  revenue: number;
  quantity: number;
}

interface ChartData {
  monthly_sales: MonthlySalesItem[];
  top_products: TopProduct[];
}

interface ProductOverviewItem {
  id: number;
  productName: string;
  asgSku: string;
  amazonId: string | null;
  blinkitId: string | null;
  amazonStock: number;
  blinkitStock: number;
  totalStock: number;
  packedQty: number;
  unpackedQty: number;
  status: string;
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

export default function DashboardPage() {
  const [topProductsChannel, setTopProductsChannel] = useState('all');
  const [chart1Period, setChart1Period] = useState('6months');
  const [chart2Period, setChart2Period] = useState('6months');
  const [chart3Period, setChart3Period] = useState('6months');
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
  const [chartData, setChartData] = useState<ChartData>({ monthly_sales: [], top_products: [] });
  const [productOverview, setProductOverview] = useState<ProductOverviewItem[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [productChannel, setProductChannel] = useState('all');

  // Fetch dashboard data from API
  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        // Fetch inventory-focused stats using centralized API client
        const statsData: any = await api.dashboard.getInventoryStats();
        setStats(statsData);

        // Fetch low inventory items
        const lowStockData: any = await api.inventory.getLowStock({ limit: 5 });
        setLowInventoryItems(lowStockData.items || []);

        // Fetch chart data
        const charts: any = await api.dashboard.getCharts();
        setChartData({
          monthly_sales: charts.monthly_sales || [],
          top_products: charts.top_products || []
        });

        // Fetch product overview (all products for mapping view)
        const productData: any = await api.dashboard.getProductOverview({ page_size: 100 });
        setProductOverview(productData.items || []);

      } catch (error) {
        console.error('Error fetching dashboard data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchDashboardData();
  }, []);

  // Filter product overview client-side
  const filteredProductOverview = useMemo(() => {
    let filtered = [...productOverview];

    if (productSearch) {
      const term = productSearch.toLowerCase();
      filtered = filtered.filter(p =>
        (p.productName || '').toLowerCase().includes(term) ||
        (p.asgSku || '').toLowerCase().includes(term) ||
        (p.amazonId || '').toLowerCase().includes(term) ||
        (p.blinkitId || '').toLowerCase().includes(term)
      );
    }

    if (productChannel === 'amazon') {
      filtered = filtered.map(p => ({
        ...p,
        totalStock: p.amazonStock,
        status: p.amazonStock === 0 ? 'Out of Stock' : 'Healthy',
      }));
    } else if (productChannel === 'blinkit') {
      filtered = filtered.map(p => ({
        ...p,
        totalStock: p.blinkitStock,
        status: p.blinkitStock === 0 ? 'Out of Stock' : 'Healthy',
      }));
    }

    return filtered;
  }, [productOverview, productSearch, productChannel]);

  // Product overview grid columns
  const productColumns: GridColumn<ProductOverviewItem>[] = [
    {
      id: 'asgSku',
      header: 'ASG SKU',
      accessorKey: 'asgSku',
      sortable: true,
      width: 180,
      minWidth: 140,
      cell: (row) => <code className="text-xs bg-muted px-1.5 py-0.5 rounded whitespace-nowrap">{row.asgSku || '—'}</code>,
    },
    {
      id: 'productName',
      header: 'Product Name',
      accessorKey: 'productName',
      sortable: true,
      width: 380,
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
      id: 'amazonId',
      header: 'Amazon ASIN',
      accessorKey: 'amazonId',
      sortable: true,
      width: 140,
      minWidth: 110,
      cell: (row) => row.amazonId
        ? <code className="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded border border-blue-200">{row.amazonId}</code>
        : <span className="text-muted-foreground text-xs">—</span>,
    },
    {
      id: 'blinkitId',
      header: 'Blinkit ID',
      accessorKey: 'blinkitId',
      sortable: true,
      width: 120,
      minWidth: 90,
      cell: (row) => row.blinkitId
        ? <code className="text-xs bg-yellow-50 text-yellow-700 px-1.5 py-0.5 rounded border border-yellow-200">{row.blinkitId}</code>
        : <span className="text-muted-foreground text-xs">—</span>,
    },
    {
      id: 'amazonStock',
      header: 'Amazon Stock',
      accessorKey: 'amazonStock',
      sortable: true,
      width: 120,
      minWidth: 90,
      align: 'right',
      cell: (row) => (
        <span className={row.amazonStock > 0 ? 'text-blue-600 font-semibold text-xs' : 'text-muted-foreground text-xs'}>
          {row.amazonStock.toLocaleString()}
        </span>
      ),
    },
    {
      id: 'blinkitStock',
      header: 'Blinkit Stock',
      accessorKey: 'blinkitStock',
      sortable: true,
      width: 120,
      minWidth: 90,
      align: 'right',
      cell: (row) => (
        <span className={row.blinkitStock > 0 ? 'text-yellow-600 font-semibold text-xs' : 'text-muted-foreground text-xs'}>
          {row.blinkitStock.toLocaleString()}
        </span>
      ),
    },
    {
      id: 'totalStock',
      header: 'Total',
      accessorKey: 'totalStock',
      sortable: true,
      width: 100,
      minWidth: 80,
      align: 'right',
      cell: (row) => (
        <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded font-semibold text-xs border border-emerald-200">
          {row.totalStock.toLocaleString()}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      accessorKey: 'status',
      sortable: true,
      width: 120,
      minWidth: 100,
      align: 'center',
      cell: (row) => (
        <Badge
          variant="outline"
          className={
            row.status === 'Healthy'
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : 'bg-red-50 text-red-700 border-red-200'
          }
        >
          {row.status}
        </Badge>
      ),
    },
  ];

  const productGridState = useDataGrid(productColumns);

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
            Last updated: {new Date().toLocaleTimeString()}
          </Badge>
        </div>

        {/* Key Performance Indicators - INVENTORY FOCUSED */}
        <StatsGrid columns={4}>
          <StatsCard
            title="Total SKUs"
            value={stats.totalSKUs.toLocaleString()}
            icon={Package}
            description="Active products"
          />
          <StatsCard
            title="Packed Inventory"
            value={stats.packedInventory.toLocaleString()}
            icon={PackageCheck}
            description="Ready to ship"
            variant="blue"
          />
          <StatsCard
            title="Unpacked Inventory"
            value={stats.unpackedInventory.toLocaleString()}
            icon={PackageOpen}
            description="Raw stock"
            variant="yellow"
          />
          <StatsCard
            title="Pending POs"
            value={stats.pendingPOs.toLocaleString()}
            icon={ClipboardList}
            description={`${stats.delayedPOs} delayed`}
            variant={stats.delayedPOs > 0 ? 'orange' : 'default'}
          />
        </StatsGrid>

        {/* Sales Charts - 4 charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 1. Sales Performance - Area Chart */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-medium">Monthly Sales Performance</CardTitle>
                <select value={chart1Period} onChange={(e) => setChart1Period(e.target.value)} className="h-7 text-xs border border-border rounded-md px-2 py-1 bg-background text-foreground cursor-pointer">
                  {TIME_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={filterMonthly(chartData.monthly_sales, chart1Period)}>
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
                  <XAxis dataKey="month" tick={{ fill: '#6b7280', fontSize: 12 }} />
                  <YAxis tick={{ fill: '#6b7280', fontSize: 12 }} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number | undefined) => [`₹${Number(v ?? 0).toLocaleString()}`, '']} />
                  <Legend />
                  <Area type="monotone" dataKey="Amazon" stroke="#60a5fa" strokeWidth={2} fillOpacity={1} fill="url(#colorAmazon)" />
                  <Area type="monotone" dataKey="Blinkit" stroke="#fbbf24" strokeWidth={2} fillOpacity={1} fill="url(#colorBlinkit)" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* 2. Platform Sales Comparison - Bar Chart */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-medium">Platform Sales Comparison</CardTitle>
                <select value={chart2Period} onChange={(e) => setChart2Period(e.target.value)} className="h-7 text-xs border border-border rounded-md px-2 py-1 bg-background text-foreground cursor-pointer">
                  {TIME_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={filterMonthly(chartData.monthly_sales, chart2Period)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="month" tick={{ fill: '#6b7280', fontSize: 12 }} />
                  <YAxis tick={{ fill: '#6b7280', fontSize: 12 }} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number | undefined) => [`₹${Number(v ?? 0).toLocaleString()}`, '']} />
                  <Legend />
                  <Bar dataKey="Amazon" fill="#60a5fa" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Blinkit" fill="#fbbf24" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* 3. Channel Distribution - Pie Chart */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-medium">Channel Distribution</CardTitle>
                <select value={chart3Period} onChange={(e) => setChart3Period(e.target.value)} className="h-7 text-xs border border-border rounded-md px-2 py-1 bg-background text-foreground cursor-pointer">
                  {TIME_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </CardHeader>
            <CardContent>
              {(() => {
                const filtered3 = filterMonthly(chartData.monthly_sales, chart3Period);
                const amazonTotal = filtered3.reduce((s, r) => s + r.Amazon, 0);
                const blinkitTotal = filtered3.reduce((s, r) => s + r.Blinkit, 0);
                const total = amazonTotal + blinkitTotal;
                const distData = [
                  { name: 'Amazon', value: amazonTotal, color: '#60a5fa' },
                  { name: 'Blinkit', value: blinkitTotal, color: '#fbbf24' },
                ];
                return (
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie
                        data={distData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, value }) => `${name}: ${total > 0 ? Math.round((value / total) * 100) : 0}%`}
                        outerRadius={90}
                        dataKey="value"
                      >
                        {distData.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number | undefined) => [`₹${Number(v ?? 0).toLocaleString()}`, 'Revenue']} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
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
                  : chartData.top_products.filter(p => p.channel.toLowerCase() === topProductsChannel)
                ).slice(0, 5);
                return (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={filteredTop} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 11 }} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                      <YAxis dataKey="name" type="category" width={110} tick={{ fill: '#6b7280', fontSize: 10 }} />
                      <Tooltip formatter={(v: number | undefined) => [`₹${Number(v ?? 0).toLocaleString()}`, 'Revenue']} />
                      <Bar dataKey="revenue" radius={[0, 4, 4, 0]} name="Revenue">
                        {filteredTop.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.channel === 'Amazon' ? '#60a5fa' : '#fbbf24'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                );
              })()}
            </CardContent>
          </Card>
        </div>

        {/* Product Mapping & Stock Overview */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-medium">Product Mapping & Stock Overview</CardTitle>
              <div className="flex items-center gap-2">
                <select
                  value={productChannel}
                  onChange={(e) => setProductChannel(e.target.value)}
                  className="h-7 text-xs border border-border rounded-md px-2 py-1 bg-background text-foreground cursor-pointer"
                >
                  <option value="all">All Channels</option>
                  <option value="amazon">Amazon</option>
                  <option value="blinkit">Blinkit</option>
                </select>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => exportToCSV(
                    filteredProductOverview.map(p => ({
                      'ASG SKU': p.asgSku || '',
                      'Product Name': p.productName || '',
                      'Amazon ASIN': p.amazonId || '',
                      'Blinkit ID': p.blinkitId || '',
                      'Amazon Stock': p.amazonStock,
                      'Blinkit Stock': p.blinkitStock,
                      'Total Stock': p.totalStock,
                      'Status': p.status,
                    })),
                    'product_mapping_overview'
                  )}
                >
                  <Download className="h-3.5 w-3.5 mr-1" />
                  Export
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="mb-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search by product name, SKU, ASIN, or Blinkit ID..."
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-md bg-background"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mb-2">
              Showing {filteredProductOverview.length} of {productOverview.length} products
            </p>
            {filteredProductOverview.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Package className="h-10 w-10 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No products found</p>
              </div>
            ) : (
              <DataGrid data={filteredProductOverview} gridState={productGridState} />
            )}
          </CardContent>
        </Card>

        {/* Low Inventory Alerts */}
        <div>
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-medium flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-500" />
                  Low Inventory Alerts
                </CardTitle>
                <Badge variant="secondary">{stats.lowInventoryCount}</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {lowInventoryItems.length > 0 ? (
                  lowInventoryItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-3 bg-yellow-50 rounded-lg border border-yellow-100"
                    >
                      <div>
                        <p className="font-medium text-sm text-gray-900 truncate max-w-[180px]">
                          {item.productName}
                        </p>
                        <p className="text-xs text-gray-500">{item.asgSku}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-yellow-600">
                          Stock: {item.currentStock}
                        </p>
                        <p className="text-xs text-orange-500 font-medium">
                          To Pack: {item.toPackQty}
                        </p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <p className="text-sm">No pending packing orders</p>
                    <p className="text-xs mt-1">All POs are fully packed</p>
                  </div>
                )}
              </div>

              <Link
                href="/low-stock-alerts"
                className="mt-4 flex items-center justify-center gap-1 text-sm text-blue-600 hover:text-blue-800"
              >
                View All Alerts
                <ArrowRight className="h-4 w-4" />
              </Link>
            </CardContent>
          </Card>
        </div>


      </div>
    </ProtectedRoute>
  );
}
