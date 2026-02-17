'use client';

import { useState, useEffect } from 'react';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { StatsCard, StatsGrid } from '@/components/ui/stats-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, AlertCircle, Bell, CheckCircle, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FilterPanel, FilterValues, DEFAULT_FILTER_VALUES } from '@/components/ui/filter-panel';
import { exportToCSV } from '@/lib/export';
import api from '@/lib/api';

const PAGE_SIZE = 20;

interface Alert {
  id: number;
  productName: string;
  asgSku: string;
  channel: string;
  alertType: string;
  severity: string;
  message: string;
  isResolved: boolean;
  createdAt: string | null;
}

export default function LowStockAlertsPage() {
  const [filters, setFilters] = useState<FilterValues>(DEFAULT_FILTER_VALUES);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalAlerts, setTotalAlerts] = useState(0);
  const [resolving, setResolving] = useState<number | null>(null);

  const fetchAlerts = async (doSync = false) => {
    try {
      setIsLoading(true);
      // Auto-generate alerts from inventory data on first load
      if (doSync) {
        await api.alerts.sync().catch(() => {});
      }
      const response = await api.alerts.getAll({ is_resolved: false, page, page_size: PAGE_SIZE }) as any;

      const alertList = response.items || [];
      setTotalAlerts(response.total || alertList.length);

      const transformedAlerts: Alert[] = alertList.map((alert: any) => ({
        id: alert.id,
        productName: alert.product_name || '',
        asgSku: alert.asg_sku || '',
        channel: alert.channel || 'All',
        alertType: alert.alert_type || 'Low Stock',
        severity: alert.severity || 'Medium',
        message: alert.message || '',
        isResolved: alert.is_resolved || false,
        createdAt: alert.created_at || null,
      }));

      setAlerts(transformedAlerts);
    } catch (error) {
      console.error('Error fetching alerts:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAlerts(page === 1);
  }, [page]);

  const handleResolve = async (alertId: number) => {
    try {
      setResolving(alertId);
      await api.alerts.resolve(alertId);
      await fetchAlerts();
    } catch (error) {
      console.error('Error resolving alert:', error);
    } finally {
      setResolving(null);
    }
  };

  // Filter alerts by channel, severity, and date range
  const filteredAlerts = alerts.filter(a => {
    if (filters.channel !== 'all' && a.channel.toLowerCase() !== filters.channel) return false;
    if (filters.status !== 'all' && a.severity.toLowerCase() !== filters.status) return false;
    if (filters.dateFrom && a.createdAt && a.createdAt.slice(0, 10) < filters.dateFrom) return false;
    if (filters.dateTo && a.createdAt && a.createdAt.slice(0, 10) > filters.dateTo) return false;
    return true;
  });

  const getSeverityLevel = (severity: string) => {
    const s = severity.toLowerCase();
    if (s === 'high' || s === 'critical') return 'critical';
    return 'warning';
  };

  const criticalCount = filteredAlerts.filter(a => getSeverityLevel(a.severity) === 'critical').length;
  const warningCount = filteredAlerts.filter(a => getSeverityLevel(a.severity) === 'warning').length;

  if (isLoading) {
    return (
      <ProtectedRoute>
        <div className="p-6 flex items-center justify-center">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-red-600 mb-4"></div>
            <p className="text-muted-foreground">Loading alerts...</p>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="p-6 space-y-6">
        {/* KPI Cards */}
        <StatsGrid columns={3}>
          <StatsCard title="Critical" value={criticalCount} icon={AlertTriangle} description="Immediate action needed" variant="red" />
          <StatsCard title="Warning" value={warningCount} icon={AlertCircle} description="Low stock level" variant="orange" />
          <StatsCard title="Total Alerts" value={totalAlerts} icon={Bell} description="Action required" variant="blue" />
        </StatsGrid>

        {/* Alerts List */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-medium">Inventory Alerts</CardTitle>
              <div className="flex items-center gap-2">
                <FilterPanel
                  values={filters}
                  onChange={(key, value) => setFilters(prev => ({ ...prev, [key]: value }))}
                  onClear={() => setFilters(DEFAULT_FILTER_VALUES)}
                  showChannel
                  showDateRange
                  showStatus
                  statusOptions={[
                    { label: 'All', value: 'all' },
                    { label: 'Critical', value: 'critical' },
                    { label: 'High', value: 'high' },
                    { label: 'Medium', value: 'medium' },
                    { label: 'Low', value: 'low' },
                  ]}
                />
                {filteredAlerts.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    onClick={() => exportToCSV(
                      filteredAlerts.map(a => ({
                        'Product': a.productName,
                        'ASG SKU': a.asgSku,
                        'Channel': a.channel,
                        'Alert Type': a.alertType,
                        'Severity': a.severity,
                        'Message': a.message,
                        'Created At': a.createdAt ?? '',
                      })),
                      'low_stock_alerts'
                    )}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Export
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {filteredAlerts.length > 0 ? (
              <div className="space-y-2">
                {filteredAlerts.map((alert) => {
                  const level = getSeverityLevel(alert.severity);
                  return (
                    <div
                      key={alert.id}
                      className="flex items-center justify-between p-4 rounded-lg border hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`h-2 w-2 rounded-full ${level === 'critical' ? 'bg-red-500' : 'bg-amber-500'}`} />
                        <div>
                          <p className="font-medium">{alert.productName}</p>
                          <code className="text-xs text-muted-foreground">{alert.asgSku}</code>
                          <p className="text-sm text-muted-foreground mt-1">{alert.message}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <Badge variant="outline" className="text-xs">
                          {alert.channel}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={`text-xs ${level === 'critical' ? 'border-red-300 text-red-700' : 'border-amber-300 text-amber-700'}`}
                        >
                          {alert.alertType}
                        </Badge>
                        <Badge
                          className={`text-xs ${level === 'critical' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}
                        >
                          {alert.severity}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-xs"
                          disabled={resolving === alert.id}
                          onClick={() => handleResolve(alert.id)}
                        >
                          <CheckCircle className="h-3.5 w-3.5 mr-1" />
                          {resolving === alert.id ? 'Resolving...' : 'Resolve'}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <Bell className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No inventory alerts at the moment</p>
              </div>
            )}

            {/* Pagination */}
            {totalAlerts > PAGE_SIZE && (
              <div className="flex items-center justify-between mt-4 pt-3 border-t">
                <span className="text-sm text-muted-foreground">
                  Showing {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, totalAlerts)} of {totalAlerts} alerts
                </span>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm font-medium px-2">{page} / {Math.ceil(totalAlerts / PAGE_SIZE)}</span>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0" disabled={page >= Math.ceil(totalAlerts / PAGE_SIZE)} onClick={() => setPage((p) => p + 1)}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </ProtectedRoute>
  );
}
