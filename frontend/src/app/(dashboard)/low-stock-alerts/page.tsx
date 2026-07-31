'use client';

import { useState, useEffect, useCallback } from 'react';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertTriangle,
  AlertCircle,
  Bell,
  ChevronLeft,
  ChevronRight,
  Download,
  PackageX,
  CheckCircle2,
  History,
  RefreshCw,
  CheckCheck,
} from 'lucide-react';
import { exportToCSV } from '@/lib/export';
import { toTitleCase, fmtDate } from '@/lib/format';
import { toast } from 'sonner';
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
  resolvedAt: string | null;
  remarks: string | null;
  createdAt: string | null;
}

interface AlertStats {
  totalAlerts: number;
  unresolvedAlerts: number;
  resolvedAlerts: number;
  severityBreakdown: Record<string, number>;
}

export default function LowStockAlertsPage() {
  const { user } = useAuth();
  const canResolve = user?.role === 'Admin' || user?.role === 'Manager';

  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [stats, setStats] = useState<AlertStats>({ totalAlerts: 0, unresolvedAlerts: 0, resolvedAlerts: 0, severityBreakdown: {} });
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalAlerts, setTotalAlerts] = useState(0);
  const [showResolved, setShowResolved] = useState(false);
  const [showOosOnly, setShowOosOnly] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<string>('all');

  // Resolve dialog
  const [resolveTarget, setResolveTarget] = useState<Alert | null>(null);
  const [remarksInput, setRemarksInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Bulk resolve
  const [isBulkResolving, setIsBulkResolving] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      const s = await (api.alerts as any).getStats() as AlertStats;
      setStats(s);
    } catch {}
  }, []);

  const fetchAlerts = useCallback(async (p: number, resolved: boolean, doSync = false) => {
    try {
      setIsLoading(true);
      if (doSync) {
        await (api.alerts as any).sync().catch(() => {});
      }
      const response = await (api.alerts as any).getAll({ is_resolved: resolved, page: p, page_size: PAGE_SIZE }) as any;
      const alertList = (response.items || []).map((a: any) => ({
        id: a.id,
        productName: a.product_name || '',
        asgSku: a.asg_sku || '',
        channel: a.channel || 'All',
        alertType: a.alert_type || 'Low Stock',
        severity: a.severity || 'Medium',
        message: a.message || '',
        isResolved: a.is_resolved || false,
        resolvedAt: a.resolved_at || null,
        remarks: a.remarks || null,
        createdAt: a.created_at || null,
      }));
      setAlerts(alertList);
      setTotalAlerts(response.total || 0);
    } catch {
      toast.error('Failed to load alerts');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    fetchAlerts(1, false, true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch when tab or page changes
  useEffect(() => {
    fetchAlerts(page, showResolved);
  }, [page, showResolved, fetchAlerts]);

  const handleTabChange = (resolved: boolean) => {
    setShowResolved(resolved);
    setPage(1);
    setSeverityFilter('all');
    setShowOosOnly(false);
  };

  const openResolveDialog = (alert: Alert) => {
    setResolveTarget(alert);
    setRemarksInput('');
  };

  const handleResolve = async () => {
    if (!resolveTarget) return;
    setIsSaving(true);
    try {
      await (api.alerts as any).resolve(resolveTarget.id, remarksInput.trim() || undefined);
      setAlerts(prev => prev.filter(a => a.id !== resolveTarget.id));
      setTotalAlerts(prev => Math.max(0, prev - 1));
      setStats(prev => ({ ...prev, unresolvedAlerts: Math.max(0, prev.unresolvedAlerts - 1), resolvedAlerts: prev.resolvedAlerts + 1 }));
      toast.success(`Alert resolved for ${resolveTarget.productName}`);
      setResolveTarget(null);
    } catch {
      toast.error('Failed to resolve alert');
    } finally {
      setIsSaving(false);
    }
  };

  const handleResolveAll = async () => {
    const unresolved = filteredAlerts.filter(a => !a.isResolved);
    if (unresolved.length === 0) return;
    setIsBulkResolving(true);
    let resolved = 0;
    for (const alert of unresolved) {
      try {
        await (api.alerts as any).resolve(alert.id, 'Bulk resolved');
        resolved++;
      } catch {}
    }
    await fetchStats();
    await fetchAlerts(page, showResolved);
    toast.success(`Resolved ${resolved} alert${resolved !== 1 ? 's' : ''}`);
    setIsBulkResolving(false);
  };

  const getSeverityLevel = (severity: string) => {
    const s = severity.toLowerCase();
    if (s === 'high' || s === 'critical') return 'critical';
    return 'warning';
  };

  const filteredAlerts = alerts.filter(a => {
    if (showOosOnly && a.alertType !== 'Out of Stock') return false;
    if (severityFilter !== 'all' && a.severity.toLowerCase() !== severityFilter) return false;
    return true;
  });

  const totalPages = Math.ceil(totalAlerts / PAGE_SIZE);


  return (
    <ProtectedRoute>
      <div className="p-4 sm:p-6 space-y-6">
        {/* KPI Cards — from stats endpoint, not page-level counts */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="flex items-center gap-3 p-4 bg-card border rounded-xl">
            <div className="flex items-center justify-center h-10 w-10 rounded-full bg-red-100 text-red-600 shrink-0">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Critical</p>
              <p className="text-xl font-bold">{stats.severityBreakdown['High'] || 0}</p>
              <p className="text-xs text-muted-foreground">Immediate action</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-4 bg-card border rounded-xl">
            <div className="flex items-center justify-center h-10 w-10 rounded-full bg-amber-100 text-amber-600 shrink-0">
              <AlertCircle className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Warning</p>
              <p className="text-xl font-bold">{stats.severityBreakdown['Medium'] || 0}</p>
              <p className="text-xs text-muted-foreground">Low stock level</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-4 bg-card border rounded-xl">
            <div className="flex items-center justify-center h-10 w-10 rounded-full bg-blue-100 text-blue-600 shrink-0">
              <Bell className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Unresolved</p>
              <p className="text-xl font-bold">{stats.unresolvedAlerts}</p>
              <p className="text-xs text-muted-foreground">Action required</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-4 bg-card border rounded-xl">
            <div className="flex items-center justify-center h-10 w-10 rounded-full bg-emerald-100 text-emerald-600 shrink-0">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Resolved</p>
              <p className="text-xl font-bold">{stats.resolvedAlerts}</p>
              <p className="text-xs text-muted-foreground">All time</p>
            </div>
          </div>
        </div>

        {/* Alerts List */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-start gap-3">
              <CardTitle className="text-base font-medium">Inventory Alerts</CardTitle>
              <div className="flex items-center gap-2 ml-auto flex-wrap">
                {/* Tab toggle */}
                <div className="flex rounded-md border overflow-hidden">
                  <button
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${!showResolved ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                    onClick={() => handleTabChange(false)}
                  >
                    Unresolved ({stats.unresolvedAlerts})
                  </button>
                  <button
                    className={`px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-1 ${showResolved ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                    onClick={() => handleTabChange(true)}
                  >
                    <History className="h-3 w-3" />
                    Resolved ({stats.resolvedAlerts})
                  </button>
                </div>

                {/* OOS toggle (unresolved tab only) */}
                {!showResolved && (
                  <Button
                    variant={showOosOnly ? 'default' : 'outline'}
                    size="sm"
                    className={`h-8 gap-1.5 ${showOosOnly ? 'bg-red-600 hover:bg-red-700 text-white' : ''}`}
                    onClick={() => setShowOosOnly(v => !v)}
                  >
                    <PackageX className="h-3.5 w-3.5" />
                    Out of Stock Only
                  </Button>
                )}

                {/* Severity filter */}
                <select
                  className="h-8 text-xs border border-border rounded-md px-2 bg-background"
                  value={severityFilter}
                  onChange={e => setSeverityFilter(e.target.value)}
                >
                  <option value="all">All Severities</option>
                  <option value="high">High / Critical</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>

                {/* Sync + Resolve All (unresolved tab only, Admin/Manager) */}
                {!showResolved && canResolve && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5"
                      onClick={() => fetchAlerts(1, false, true)}
                      disabled={isLoading}
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                      Sync
                    </Button>
                    {filteredAlerts.length > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5 text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                        onClick={handleResolveAll}
                        disabled={isBulkResolving}
                      >
                        <CheckCheck className="h-3.5 w-3.5" />
                        {isBulkResolving ? 'Resolving...' : `Resolve All (${filteredAlerts.length})`}
                      </Button>
                    )}
                  </>
                )}

                {/* Export */}
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
                        ...(showResolved ? { 'Resolved At': a.resolvedAt ?? '', 'Remarks': a.remarks ?? '' } : {}),
                      })),
                      showResolved ? 'resolved_alerts' : 'low_stock_alerts'
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
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            ) : filteredAlerts.length > 0 ? (
              <div className="space-y-2">
                {filteredAlerts.map((alert) => {
                  const level = getSeverityLevel(alert.severity);
                  return (
                    <div
                      key={alert.id}
                      className={`flex items-start justify-between p-4 rounded-lg border transition-colors ${
                        alert.isResolved ? 'bg-muted/30 opacity-75' : 'hover:bg-muted/50'
                      }`}
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <div className={`h-2 w-2 rounded-full flex-shrink-0 mt-2 ${
                          alert.isResolved ? 'bg-emerald-500' : level === 'critical' ? 'bg-red-500' : 'bg-amber-500'
                        }`} />
                        <div className="min-w-0">
                          <p className="font-medium text-sm">{toTitleCase(alert.productName)}</p>
                          <code className="text-xs text-muted-foreground">{alert.asgSku}</code>
                          <p className="text-sm text-muted-foreground mt-1">{alert.message}</p>
                          {alert.isResolved && (
                            <p className="text-xs text-emerald-700 mt-1">
                              Resolved {fmtDate(alert.resolvedAt)}
                              {alert.remarks && <span className="text-muted-foreground"> · {alert.remarks}</span>}
                            </p>
                          )}
                          {!alert.isResolved && alert.createdAt && (
                            <p className="text-xs text-muted-foreground mt-1">Created {fmtDate(alert.createdAt)}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                        <Badge variant="outline" className="text-xs hidden sm:inline-flex">{alert.channel}</Badge>
                        <Badge
                          variant="outline"
                          className={`text-xs ${level === 'critical' ? 'border-red-300 text-red-700' : 'border-amber-300 text-amber-700'}`}
                        >
                          {alert.alertType}
                        </Badge>
                        <Badge
                          className={`text-xs ${
                            alert.isResolved
                              ? 'bg-emerald-100 text-emerald-800'
                              : level === 'critical' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {alert.isResolved ? 'Resolved' : alert.severity}
                        </Badge>
                        {!alert.isResolved && canResolve && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs gap-1 text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                            onClick={() => openResolveDialog(alert)}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Resolve
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                {showResolved ? (
                  <>
                    <CheckCircle2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No resolved alerts yet</p>
                  </>
                ) : (
                  <>
                    <Bell className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No inventory alerts at the moment</p>
                    <p className="text-sm mt-1">Click Sync to check current stock levels</p>
                  </>
                )}
              </div>
            )}

            {/* Pagination */}
            {totalAlerts > PAGE_SIZE && (
              <div className="flex items-center justify-between mt-4 pt-3 border-t">
                <span className="text-sm text-muted-foreground">
                  Showing {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, totalAlerts)} of {totalAlerts}
                </span>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm font-medium px-2">{page} / {totalPages}</span>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Resolve Dialog */}
      <Dialog open={resolveTarget !== null} onOpenChange={(open) => { if (!open) setResolveTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Resolve Alert</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {resolveTarget && (
              <>
                <p className="text-sm font-medium">{resolveTarget.productName}</p>
                <p className="text-xs text-muted-foreground">{resolveTarget.message}</p>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Remarks (optional)</label>
                  <Textarea
                    placeholder="e.g. Restocked 500 units, supplier delivered..."
                    value={remarksInput}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setRemarksInput(e.target.value)}
                    rows={3}
                    className="text-sm resize-none"
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveTarget(null)} disabled={isSaving}>Cancel</Button>
            <Button
              onClick={handleResolve}
              disabled={isSaving}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {isSaving ? 'Saving...' : 'Mark Resolved'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ProtectedRoute>
  );
}
